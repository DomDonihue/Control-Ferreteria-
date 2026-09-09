-- =====================================================================
-- Control Ferretería — PUNTO 1 del plan de mejoras
-- Anulación de documentos (en vez de borrado) + Bitácora de movimientos
-- =====================================================================
--
-- QUÉ RESUELVE
--   1. factura / guia_despacho / nota_credito dejan de BORRARSE: se ANULAN
--      con motivo obligatorio. La fila y toda su historia quedan.
--   2. Al ANULAR una FACTURA se revierte su descuento del convenio con un
--      movimiento NUEVO (tipo 'reverso'). El movimiento original NO se
--      borra: se marca 'anulado'. El libro `movimiento_saldo` queda
--      append-only (nunca se borra ni se reescribe una fila pasada).
--   3. Tabla `bitacora`: registro inmutable de quién hizo qué, cuándo y
--      por qué (crear / editar / anular / reversar convenio).
--   4. Anular una factura corre dentro de UNA función en el servidor
--      (transacción atómica). La app solo llama rpc() y lee el saldo.
--
-- Correr UNA vez en el SQL Editor de Supabase.
-- Requiere public.rol_actual() (ya está en el README).
--
-- ---------------------------------------------------------------------
-- ANTES DE CORRER EL BLOQUE 4: pásame el resultado de estas 3 consultas.
-- El bloque 4 toca el saldo del convenio y necesito ver cómo está armado
-- hoy para no descuadrarlo.
--
--   -- a) definición de la vista del Resumen
--   select pg_get_viewdef('public.resumen_convenio', true);
--
--   -- b) el trigger/función que hoy descuenta del convenio al insertar en `compra`
--   select pg_get_functiondef(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'fn_registrar_movimiento_compra';
--
--   -- c) constraint de tipo y columnas actuales de movimiento_saldo
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.movimiento_saldo'::regclass;
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='movimiento_saldo' order by ordinal_position;
-- =====================================================================

begin;

-- =====================================================================
-- BLOQUE 1 — Columnas de anulación en los documentos del expediente
-- (seguro de correr ya)
-- =====================================================================
alter table factura       add column if not exists anulado        boolean not null default false;
alter table factura       add column if not exists anulado_por    uuid references perfiles(id);
alter table factura       add column if not exists anulado_motivo text;
alter table factura       add column if not exists anulado_en     timestamptz;

alter table guia_despacho add column if not exists anulado        boolean not null default false;
alter table guia_despacho add column if not exists anulado_por    uuid references perfiles(id);
alter table guia_despacho add column if not exists anulado_motivo text;
alter table guia_despacho add column if not exists anulado_en     timestamptz;

alter table nota_credito  add column if not exists anulado        boolean not null default false;
alter table nota_credito  add column if not exists anulado_por    uuid references perfiles(id);
alter table nota_credito  add column if not exists anulado_motivo text;
alter table nota_credito  add column if not exists anulado_en     timestamptz;


-- =====================================================================
-- BLOQUE 2 — Bitácora (registro inmutable)
-- =====================================================================
create table if not exists bitacora (
  id           bigint generated always as identity primary key,
  ocurrido_en  timestamptz not null default now(),
  actor_id     uuid references perfiles(id),
  actor_nombre text,            -- copia del nombre: el registro sobrevive aunque se borre el perfil
  entidad      text not null,   -- 'factura' | 'guia_despacho' | 'nota_credito' | 'solicitud' | 'convenio'
  entidad_id   uuid,
  solicitud_id uuid references solicitud(id) on delete set null,
  accion       text not null,   -- 'crear' | 'editar' | 'anular' | 'cambiar_estado' | 'descontar_convenio' | 'reversar_convenio'
  motivo       text,
  detalle      jsonb,           -- {antes:{...}, despues:{...}} o datos del movimiento
  monto        numeric          -- impacto en $ cuando aplica
);
create index if not exists bitacora_solicitud_idx on bitacora(solicitud_id);
create index if not exists bitacora_entidad_idx   on bitacora(entidad, entidad_id);
create index if not exists bitacora_fecha_idx     on bitacora(ocurrido_en desc);

alter table bitacora enable row level security;
-- Lectura: solo los roles de control -> Administrador, Director de Obras y DAF.
-- (El ITO/admin_ito NO la ve: es quien ejecuta los movimientos, no quien los
--  audita. El Alcalde solo ve el Resumen. El solicitante, nada.)
-- Escritura: NADIE directo — solo los triggers 'security definer' de abajo.
drop policy if exists "bitacora lectura" on bitacora;
create policy "bitacora lectura" on bitacora for select
  using (public.rol_actual() in ('admin','lector_operativo','lector_pagos'));
grant select on bitacora to authenticated;
revoke insert, update, delete on bitacora from authenticated;

-- nombre del actor actual (para desnormalizar en la bitácora)
create or replace function public._actor_nombre()
returns text language sql stable security definer set search_path = public
as $$ select nombre from public.perfiles where id = auth.uid() $$;


-- =====================================================================
-- BLOQUE 3 — Triggers de bitácora sobre los documentos del expediente
-- =====================================================================
create or replace function public.fn_bitacora_doc()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entidad text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, detalle, monto)
    values (auth.uid(), public._actor_nombre(), v_entidad, new.id, new.solicitud_id, 'crear',
            to_jsonb(new), new.monto_bruto);
    return new;

  elsif tg_op = 'UPDATE' then
    if (new.anulado is true) and (old.anulado is distinct from true) then
      insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, motivo, detalle, monto)
      values (auth.uid(), public._actor_nombre(), v_entidad, new.id, new.solicitud_id, 'anular',
              new.anulado_motivo,
              jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new)),
              new.monto_bruto);
    else
      insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, detalle)
      values (auth.uid(), public._actor_nombre(), v_entidad, new.id, new.solicitud_id, 'editar',
              jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new)));
    end if;
    return new;
  end if;
  return null;
end $$;

drop trigger if exists trg_bitacora_factura      on factura;
drop trigger if exists trg_bitacora_guia         on guia_despacho;
drop trigger if exists trg_bitacora_nota_credito on nota_credito;
create trigger trg_bitacora_factura      after insert or update on factura
  for each row execute function public.fn_bitacora_doc('factura');
create trigger trg_bitacora_guia         after insert or update on guia_despacho
  for each row execute function public.fn_bitacora_doc('guia_despacho');
create trigger trg_bitacora_nota_credito after insert or update on nota_credito
  for each row execute function public.fn_bitacora_doc('nota_credito');

-- Cerrar la puerta de atrás: sin política de DELETE, nadie borra vía API.
-- (Un admin real todavía puede desde el SQL Editor si hiciera falta una
--  corrección extrema, y eso queda en los logs de Postgres.)
drop policy if exists "factura elimina" on factura;
drop policy if exists "guia elimina"    on guia_despacho;
drop policy if exists "nc elimina"      on nota_credito;


-- =====================================================================
-- BLOQUE 4 — Libro append-only + anular_factura() con reverso del saldo
-- >>> REVISAR CON EL DUMP DEL ENCABEZADO ANTES DE CORRER <<<
-- =====================================================================

-- 4.1 trazabilidad en el libro
alter table movimiento_saldo add column if not exists creado_por uuid references perfiles(id);
alter table movimiento_saldo add column if not exists motivo     text;
alter table movimiento_saldo add column if not exists factura_id uuid references factura(id);
alter table movimiento_saldo add column if not exists reversa_de bigint;   -- id del movimiento que este reverso corrige
alter table movimiento_saldo add column if not exists anulado    boolean not null default false;

-- 4.2 ampliar los tipos permitidos. Si tu trigger de compra usa otro
--     nombre para el egreso (p.ej. 'compra' o 'salida'), déjalo en la lista.
alter table movimiento_saldo drop constraint if exists movimiento_saldo_tipo_check;
alter table movimiento_saldo add constraint movimiento_saldo_tipo_check
  check (tipo in ('apertura','compra','egreso','nota_credito','reverso','ajuste'));

-- 4.3 poder ubicar el descuento de cada factura (hoy se enlaza por
--     compra.n_oc = 'FACT '||numero). Se rellena factura_id hacia atrás.
alter table compra add column if not exists anulado boolean not null default false;

update movimiento_saldo m
set factura_id = f.id
from compra c
join factura f on f.solicitud_id = c.solicitud_id and ('FACT '||f.numero) = c.n_oc
where m.compra_id = c.id and m.factura_id is null;

-- 4.4 FUNCIÓN: anular una factura, todo en una transacción.
--     Convención del libro (ver recalcularSaldoContrato en app.js):
--       apertura  -> monto = +tope,           saldo = monto
--       egreso    -> monto = -monto_bruto,     saldo = saldo_previo + monto
--       reverso   -> monto = +monto_bruto,     saldo = saldo_previo + monto  (devuelve saldo)
create or replace function public.anular_factura(p_factura_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rol      text := public.rol_actual();
  v_f        factura%rowtype;
  v_contrato uuid;
  v_saldo    numeric;
  v_mov_orig bigint;
  v_nuevo    bigint;
begin
  if v_rol not in ('admin','admin_ito') then
    raise exception 'Sin permiso para anular facturas';
  end if;
  if coalesce(btrim(p_motivo),'') = '' then
    raise exception 'El motivo de la anulación es obligatorio';
  end if;

  select * into v_f from factura where id = p_factura_id for update;
  if not found     then raise exception 'La factura no existe'; end if;
  if v_f.anulado   then raise exception 'La factura ya estaba anulada'; end if;

  -- 1) marcar la factura (dispara el trigger de bitácora -> 'anular')
  update factura
     set anulado = true, anulado_por = auth.uid(),
         anulado_motivo = p_motivo, anulado_en = now()
   where id = p_factura_id;

  -- 2) ubicar el descuento en el libro (por factura_id o por la compra 'FACT n')
  select coalesce(m.contrato_id, c.contrato_id), m.id
    into v_contrato, v_mov_orig
  from movimiento_saldo m
  left join compra c on c.id = m.compra_id
  where m.factura_id = p_factura_id
     or (c.solicitud_id = v_f.solicitud_id and c.n_oc = 'FACT '||v_f.numero)
  order by m.id desc
  limit 1;

  if v_contrato is null then
    -- la factura nunca se descontó del convenio: queda anulada, sin reverso
    insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, motivo, monto)
    values (auth.uid(), public._actor_nombre(), 'convenio', p_factura_id, v_f.solicitud_id,
            'reversar_convenio', p_motivo, 0);
    return jsonb_build_object('reversado', false);
  end if;

  -- 3) bloquear los movimientos del contrato y tomar el último saldo
  perform 1 from movimiento_saldo where contrato_id = v_contrato for update;
  select saldo_resultante into v_saldo
    from movimiento_saldo where contrato_id = v_contrato
   order by id desc limit 1;

  -- 4) movimiento NUEVO de reverso (+monto_bruto). El original NO se borra.
  insert into movimiento_saldo(contrato_id, compra_id, factura_id, tipo, monto,
         saldo_resultante, reversa_de, motivo, creado_por, fecha)
  values (v_contrato, null, p_factura_id, 'reverso', v_f.monto_bruto,
          coalesce(v_saldo,0) + v_f.monto_bruto, v_mov_orig, p_motivo, auth.uid(), current_date)
  returning id into v_nuevo;

  update movimiento_saldo set anulado = true where id = v_mov_orig;
  update compra set anulado = true
   where id = (select compra_id from movimiento_saldo where id = v_mov_orig);

  -- 5) bitácora del impacto en el convenio
  insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, motivo, monto, detalle)
  values (auth.uid(), public._actor_nombre(), 'convenio', p_factura_id, v_f.solicitud_id,
          'reversar_convenio', p_motivo, v_f.monto_bruto,
          jsonb_build_object('movimiento_original', v_mov_orig, 'movimiento_reverso', v_nuevo));

  return jsonb_build_object('reversado', true,
                            'saldo', coalesce(v_saldo,0) + v_f.monto_bruto,
                            'movimiento_reverso', v_nuevo);
end $$;

grant execute on function public.anular_factura(uuid, text) to authenticated;

-- 4.5 (OPCIONAL — solo si tras una prueba el Resumen NO refleja el reverso)
--     Redefinir la vista para que ignore lo anulado y sume los reversos.
--     Ajusta los nombres de columna a los que devuelva pg_get_viewdef.
--
-- create or replace view resumen_convenio as
-- select
--   c.id                                        as contrato_id,
--   c.proveedor,
--   c.monto_tope_anual                          as tope_anual,
--   coalesce(-sum(m.monto) filter (where m.tipo <> 'apertura'), 0) as comprometido,
--   c.monto_tope_anual + coalesce(sum(m.monto) filter (where m.tipo <> 'apertura'), 0) as saldo_disponible,
--   round(100.0 * coalesce(-sum(m.monto) filter (where m.tipo <> 'apertura'),0)
--         / nullif(c.monto_tope_anual,0), 1)    as porcentaje_usado
-- from contrato c
-- left join movimiento_saldo m on m.contrato_id = c.id
-- where c.estado = 'vigente'
-- group by c.id, c.proveedor, c.monto_tope_anual;

commit;

-- =====================================================================
-- PRUEBA DESPUÉS DE CORRER
--   1. Registra una factura de prueba en un expediente -> baja el saldo.
--   2. select public.anular_factura('<uuid-de-esa-factura>', 'prueba: dígito mal ingresado');
--   3. El saldo del Resumen debe volver a su valor anterior.
--   4. select * from bitacora order by id desc limit 5;  -> ves 'crear' y 'anular' + 'reversar_convenio'.
--   5. select id, tipo, monto, saldo_resultante, anulado from movimiento_saldo
--      where contrato_id = '<uuid-contrato>' order by id;  -> el egreso queda con anulado=true
--      y hay una fila 'reverso' nueva. Nada se borró.
-- =====================================================================
