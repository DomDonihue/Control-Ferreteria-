-- =====================================================================
-- Control Ferretería — Endurecimiento de seguridad
-- =====================================================================
--
-- 1. FIRMAS: solo las leen los roles que generan PDF (hasta ahora las podía
--    leer cualquier usuario autenticado, incluso uno "pendiente").
-- 2. ARCHIVOS (memos, especiales, guias, facturas): los depósitos pasan a
--    PRIVADOS. La app los abre con enlaces temporales; cada rol solo lee lo
--    que le corresponde. Se eliminan las políticas de lectura antiguas.
-- 3. PRECIO de artículos: solo el Administrador lo cambia (antes la base
--    dejaba al ITO editarlo por API aunque la pantalla no se lo mostrara).
-- 4. CONVENIO: el descuento de una factura lo hace la función
--    descontar_factura() con el monto de la factura ya registrada. Se quita al
--    ITO el permiso de crear, editar o borrar compras y movimientos de saldo
--    directamente (lo que permitía fabricar o alterar el saldo del convenio).
-- 5. Montos no negativos en facturas y guías (solo para filas nuevas).
--
-- Orden recomendado: publicar primero la versión nueva de la app (abre los
-- archivos con enlaces temporales y llama a descontar_factura), y DESPUÉS
-- correr este script. Es idempotente: se puede correr de nuevo.
-- Correr UNA vez en el SQL Editor de Supabase. Al final revisa los avisos
-- (NOTICE): lista las políticas antiguas que se eliminaron o que hay que
-- revisar a mano.
--
-- Pendiente en el panel de Supabase (no se puede hacer por SQL):
--   Authentication > Sign In / Providers > desactivar "Allow new users to
--   sign up". Los usuarios los crea el Administrador.
-- =====================================================================

begin;

-- 1) FIRMAS ------------------------------------------------------------
drop policy if exists "firmas lectura autenticada" on storage.objects;
drop policy if exists "firmas lectura por rol" on storage.objects;
create policy "firmas lectura por rol" on storage.objects for select
  using (bucket_id = 'firmas'
         and public.rol_actual() in ('admin', 'admin_ito', 'lector_operativo', 'lector_pagos'));

-- 2) ARCHIVOS ----------------------------------------------------------
update storage.buckets set public = false
where id in ('memos', 'especiales', 'guias', 'facturas');

-- Políticas de lectura antiguas de esos depósitos: se eliminan las de solo
-- lectura; las que sirven para todo (ALL) se avisan para revisarlas a mano.
do $$
declare r record;
begin
  for r in
    select policyname, cmd
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not in ('archivos lectura por rol', 'firmas lectura por rol')
      and coalesce(qual, '') ~* '(memos|especiales|guias|facturas)'
  loop
    if r.cmd = 'SELECT' then
      execute format('drop policy %I on storage.objects', r.policyname);
      raise notice 'Eliminada política de lectura antigua: %', r.policyname;
    elsif r.cmd = 'ALL' then
      raise notice 'REVISAR A MANO (política ALL que también da lectura): %', r.policyname;
    end if;
  end loop;
end $$;

drop policy if exists "archivos lectura por rol" on storage.objects;
create policy "archivos lectura por rol" on storage.objects for select using (
  bucket_id in ('memos', 'especiales', 'guias', 'facturas') and (
    public.rol_actual() in ('admin', 'admin_ito', 'lector_operativo', 'lector_pagos')
    -- quien pidió algo puede leer lo que subió él mismo
    or (public.rol_actual() in ('solicitante', 'solicitante_obras')
        and (storage.foldername(name))[1] = auth.uid()::text)
    -- Obras ve las cotizaciones de su proceso (las sube también el ITO)
    or (public.rol_actual() = 'solicitante_obras' and bucket_id = 'memos')
  )
);

-- 3) PRECIO DE ARTÍCULOS: solo el Administrador -------------------------
create or replace function public.fn_proteger_precio_articulo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_actual();
begin
  if v_rol is not null and v_rol <> 'admin' then
    if tg_op = 'INSERT' and new.precio_neto is not null then
      raise exception 'Solo el Administrador puede fijar el precio de un artículo.';
    end if;
    if tg_op = 'UPDATE' and new.precio_neto is distinct from old.precio_neto then
      raise exception 'Solo el Administrador puede cambiar el precio de un artículo.';
    end if;
  end if;
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'articulo' and column_name = 'precio_neto') then
    drop trigger if exists trg_proteger_precio_articulo on public.articulo;
    create trigger trg_proteger_precio_articulo
      before insert or update on public.articulo
      for each row execute function public.fn_proteger_precio_articulo();
  else
    raise notice 'articulo.precio_neto no existe todavía: corre antes cargar-precios.sql y vuelve a correr este script.';
  end if;
end $$;

-- 4) CONVENIO: descuento por función, sin escritura directa ---------------
create or replace function public.descontar_factura(p_factura_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rol    text := public.rol_actual();
  v_f      factura%rowtype;
  v_c      contrato%rowtype;
  v_compra uuid;
begin
  if v_rol not in ('admin', 'admin_ito') then
    raise exception 'Sin permiso para descontar facturas del convenio';
  end if;

  select * into v_f from factura where id = p_factura_id for update;
  if not found   then raise exception 'La factura no existe'; end if;
  if v_f.anulado then raise exception 'La factura está anulada'; end if;

  if exists (select 1 from compra c
             where c.solicitud_id = v_f.solicitud_id
               and c.n_oc = 'FACT ' || v_f.numero
               and coalesce(c.anulado, false) = false) then
    return jsonb_build_object('descontado', false, 'motivo', 'La factura ya estaba descontada');
  end if;

  select * into v_c from contrato where estado = 'vigente' order by creado_en desc limit 1;
  if not found or coalesce(v_c.monto_tope_anual, 0) = 0 then
    raise exception 'No hay un contrato vigente con monto tope anual cargado';
  end if;

  -- el monto sale de la factura registrada, no de lo que mande el navegador
  insert into compra (contrato_id, solicitud_id, n_oc, monto_total, creado_por)
  values (v_c.id, v_f.solicitud_id, 'FACT ' || v_f.numero, v_f.monto_bruto, auth.uid())
  returning id into v_compra;

  return jsonb_build_object('descontado', true, 'compra_id', v_compra, 'monto', v_f.monto_bruto);
end $$;

grant execute on function public.descontar_factura(uuid) to authenticated;

-- compra: nadie la escribe directo (solo descontar_factura / anular_factura)
drop policy if exists "cf compra crea"    on compra;
drop policy if exists "cf compra edita"   on compra;
drop policy if exists "cf compra elimina" on compra;

-- movimiento_saldo: solo el Administrador crea la "apertura" de un convenio nuevo
drop policy if exists "cf movimiento crea"    on movimiento_saldo;
drop policy if exists "cf movimiento edita"   on movimiento_saldo;
drop policy if exists "cf movimiento elimina" on movimiento_saldo;
drop policy if exists "cf movimiento apertura admin" on movimiento_saldo;
create policy "cf movimiento apertura admin" on movimiento_saldo for insert
  with check (public.rol_actual() = 'admin' and tipo = 'apertura');

-- 5) Montos no negativos (solo filas nuevas; no toca lo ya registrado) ------
alter table factura drop constraint if exists factura_montos_no_negativos;
alter table factura add constraint factura_montos_no_negativos
  check (monto_neto >= 0 and iva >= 0 and monto_bruto >= 0) not valid;

alter table guia_despacho drop constraint if exists guia_montos_no_negativos;
alter table guia_despacho add constraint guia_montos_no_negativos
  check (monto_neto >= 0 and iva >= 0 and monto_bruto >= 0) not valid;

commit;

-- =====================================================================
-- PRUEBA
--   * Como ITO: registra una factura en una solicitud: el saldo del Resumen
--     baja (ahora lo hace descontar_factura).
--   * Como ITO: intentar cambiar el precio de un artículo por API -> error.
--   * Como solicitante: abrir un documento propio -> funciona; el de otra
--     persona -> no se abre.
--   * Luego corre auditoria-politicas.sql y revisa que no queden hallazgos.
-- =====================================================================
