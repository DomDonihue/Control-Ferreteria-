-- =====================================================================
-- Control Ferretería — Cotización Obras: evaluación del Director + orden de compra
-- =====================================================================
--
-- Las 3 cotizaciones se comparan (sin margen: el sistema solo muestra la
-- diferencia) y la decisión la toma el Director de Obras:
--
--   emitida --(ITO: "Enviar al Director")--> evaluacion
--        evaluacion --(Director: Aprobar compra a Hevia)--> solicitud_creada
--        evaluacion --(Director: Devolver al ITO, con motivo)--> emitida
--        evaluacion --(Director: Rechazar, con motivo)--> rechazada
--
-- Al APROBAR la compra a Hevia, en una sola operación:
--   * se genera la ORDEN DE COMPRA (OC-AAAA-NNN) a nombre de la unidad que pidió
--     la cotización;
--   * se crea su solicitud ya APROBADA (con los precios de Hevia) para que siga
--     con guías de despacho y factura, que se descuenta del convenio.
--
-- Flete: las cotizaciones externas pueden llevar un flete (neto) aparte; el de
-- Hevia va incluido. La comparación usa productos + flete.
--
-- Solo el ITO envía a evaluación; solo el Director (o el Administrador) decide.
-- Requiere haber corrido antes cotizaciones-obras.sql y cotizaciones-borrador.sql.
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase y publicar la
-- app nueva enseguida.
-- =====================================================================

begin;

-- 1) Columnas ----------------------------------------------------------------
alter table proceso_cotizacion_oferta add column if not exists flete numeric not null default 0;
alter table proceso_cotizacion_oferta drop constraint if exists oferta_flete_check;
alter table proceso_cotizacion_oferta add constraint oferta_flete_check check (flete >= 0);

alter table proceso_cotizacion add column if not exists motivo_devolucion text;
alter table proceso_cotizacion add column if not exists decidido_por uuid references perfiles(id);
alter table proceso_cotizacion add column if not exists decidido_en  timestamptz;
alter table proceso_cotizacion add column if not exists nota_decision text;

-- (la orden de compra se guarda en la solicitud que se crea)
alter table solicitud add column if not exists n_orden_compra text;
alter table solicitud add column if not exists fecha_oc date;

-- 2) Estados -------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.proceso_cotizacion'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%solicitud_creada%'
  loop
    execute format('alter table public.proceso_cotizacion drop constraint %I', c.conname);
  end loop;
end $$;

alter table proceso_cotizacion add constraint proceso_cotizacion_estado_check
  check (estado in ('preparacion','borrador','emitida','evaluacion','solicitud_creada','rechazada'));

-- 3) Reglas de orden (valen para todos, incluso por API) ----------------------
create or replace function public.fn_validar_proceso()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_actual();
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'borrador' then
      -- Enviar al ITO: solo desde el borrador privado, con productos y las 2 externas.
      if old.estado <> 'preparacion' or v_rol not in ('admin', 'admin_ito', 'solicitante_obras') then
        raise exception 'Cambio de estado no permitido.';
      end if;
      if jsonb_array_length(new.items) = 0 then
        raise exception 'Agrega al menos un producto antes de enviar al ITO.';
      end if;
      if (select count(*) from proceso_cotizacion_oferta where proceso_id = new.id and slot in (2, 3)) < 2 then
        raise exception 'Faltan las 2 cotizaciones externas para enviar al ITO.';
      end if;

    elsif new.estado = 'emitida' then
      if old.estado = 'borrador' then
        if v_rol not in ('admin', 'admin_ito') then
          raise exception 'Solo el ITO puede emitir la solicitud de cotización.';
        end if;
        if (select count(*) from proceso_cotizacion_oferta where proceso_id = new.id and slot in (2, 3)) < 2 then
          raise exception 'Faltan las 2 cotizaciones externas para poder emitir.';
        end if;
        new.fecha_envio := coalesce(new.fecha_envio, current_date);
        new.emitida_por := auth.uid();
      elsif old.estado = 'evaluacion' then
        -- Devolver al ITO: lo hace el Director, con motivo.
        if v_rol not in ('admin', 'lector_operativo') then
          raise exception 'Solo el Director puede devolver una cotización en evaluación.';
        end if;
        if coalesce(btrim(new.motivo_devolucion), '') = '' then
          raise exception 'La devolución necesita un motivo.';
        end if;
      else
        raise exception 'Cambio de estado no permitido.';
      end if;

    elsif new.estado = 'evaluacion' then
      if old.estado <> 'emitida' or v_rol not in ('admin', 'admin_ito') then
        raise exception 'Solo el ITO puede enviar la cotización a evaluación del Director.';
      end if;
      if (select count(*) from proceso_cotizacion_oferta where proceso_id = new.id) < 3 then
        raise exception 'Se necesitan las 3 cotizaciones registradas para enviar a evaluación.';
      end if;
      if exists (select 1 from jsonb_array_elements(new.items) it
                 cross join proceso_cotizacion_oferta o
                 where o.proceso_id = new.id
                   and coalesce((o.precios ->> (it->>'id'))::numeric, 0) <= 0) then
        raise exception 'Cada cotización necesita el precio de todos los productos.';
      end if;
      new.motivo_devolucion := null;

    elsif new.estado = 'solicitud_creada' then
      if old.estado <> 'evaluacion' or v_rol not in ('admin', 'lector_operativo') then
        raise exception 'Solo el Director aprueba la compra.';
      end if;
      new.decidido_por := coalesce(new.decidido_por, auth.uid());
      new.decidido_en  := coalesce(new.decidido_en, now());

    elsif new.estado = 'rechazada' then
      if old.estado <> 'evaluacion' or v_rol not in ('admin', 'lector_operativo') then
        raise exception 'Solo el Director puede rechazar la cotización.';
      end if;
      if coalesce(btrim(new.nota_decision), '') = '' then
        raise exception 'El rechazo necesita un motivo.';
      end if;
      new.decidido_por := coalesce(new.decidido_por, auth.uid());
      new.decidido_en  := coalesce(new.decidido_en, now());

    else
      raise exception 'Cambio de estado no permitido.';
    end if;
  end if;
  if old.estado not in ('preparacion', 'borrador') and new.items is distinct from old.items then
    raise exception 'Una solicitud de cotización ya emitida no puede cambiar sus productos.';
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_proceso on proceso_cotizacion;
create trigger trg_validar_proceso
  before update on proceso_cotizacion
  for each row execute function public.fn_validar_proceso();

-- 4) Decisión del Director ----------------------------------------------------
-- p_decision: 'aprobar' | 'devolver' | 'rechazar'. devolver y rechazar piden motivo;
-- aprobar acepta una nota opcional. Aprobar genera la orden de compra y crea la
-- solicitud ya aprobada, todo en la misma transacción.
create or replace function public.decidir_cotizacion(p_id uuid, p_decision text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rol  text := public.rol_actual();
  p      proceso_cotizacion%rowtype;
  v_sol  uuid;
  v_n    integer;
  v_anio integer := extract(year from now())::int;
  v_oc   text;
  v_corr text;
begin
  if v_rol not in ('admin', 'lector_operativo') then
    raise exception 'Solo el Director de Obras decide sobre las cotizaciones.';
  end if;

  select * into p from proceso_cotizacion where id = p_id for update;
  if not found then raise exception 'La cotización no existe.'; end if;
  if p.estado <> 'evaluacion' then
    raise exception 'La cotización no está en evaluación (estado actual: %).', p.estado;
  end if;

  if p_decision = 'devolver' then
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'La devolución necesita un motivo.'; end if;
    update proceso_cotizacion set estado = 'emitida', motivo_devolucion = btrim(p_motivo) where id = p_id;
    return jsonb_build_object('estado', 'emitida');

  elsif p_decision = 'rechazar' then
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'El rechazo necesita un motivo.'; end if;
    update proceso_cotizacion
       set estado = 'rechazada', nota_decision = btrim(p_motivo),
           decidido_por = auth.uid(), decidido_en = now()
     where id = p_id;
    return jsonb_build_object('estado', 'rechazada');

  elsif p_decision = 'aprobar' then
    if (select count(*) from proceso_cotizacion_oferta where proceso_id = p.id) < 3
       or exists (select 1 from jsonb_array_elements(p.items) it
                  cross join proceso_cotizacion_oferta o
                  where o.proceso_id = p.id
                    and coalesce((o.precios ->> (it->>'id'))::numeric, 0) <= 0) then
      raise exception 'Las 3 cotizaciones deben estar completas para aprobar la compra.';
    end if;

    -- N° de orden de compra: OC-AAAA-NNN
    insert into correlativo_contador (clave, ultimo) values ('OC-' || v_anio, 1)
    on conflict (clave) do update set ultimo = correlativo_contador.ultimo + 1
    returning ultimo into v_n;
    v_oc := 'OC-' || v_anio || '-' || lpad(v_n::text, 3, '0');

    -- La solicitud nace aprobada: la aprobación del Director es la de esta decisión.
    insert into solicitud (unidad_id, unidad_interna, solicitante, motivo, ubicacion, fecha_solicitud,
                           tipo, estado, proceso_cotizacion_id, aprobado_por)
    values (p.unidad_id, p.unidad_interna, p.solicitante,
            coalesce(nullif(btrim(p.motivo), ''), 'Compra fuera de catálogo según cotización ' || coalesce(p.correlativo, '')),
            p.ubicacion, current_date, 'operaciones', 'aprobada', p.id, auth.uid())
    returning id into v_sol;

    -- Productos con los precios del proveedor del contrato (Hevia, flete incluido).
    insert into solicitud_detalle (solicitud_id, articulo_id, descripcion_libre, unidad_medida_libre,
                                   cantidad_solicitada, precio_unitario_neto)
    select v_sol, null, it->>'producto', nullif(btrim(it->>'unidad'), ''),
           (it->>'cantidad')::numeric, (o.precios ->> (it->>'id'))::numeric
    from jsonb_array_elements(p.items) it
    join proceso_cotizacion_oferta o on o.proceso_id = p.id and o.slot = 1;

    update solicitud set n_orden_compra = v_oc, fecha_oc = current_date where id = v_sol;
    select correlativo into v_corr from solicitud where id = v_sol;

    update proceso_cotizacion
       set estado = 'solicitud_creada', nota_decision = nullif(btrim(p_motivo), ''),
           decidido_por = auth.uid(), decidido_en = now()
     where id = p_id;
    return jsonb_build_object('estado', 'solicitud_creada', 'solicitud_id', v_sol, 'oc', v_oc, 'solicitud', v_corr);

  else
    raise exception 'Decisión no válida.';
  end if;
end $$;

revoke all on function public.decidir_cotizacion(uuid, text, text) from public, anon;
grant execute on function public.decidir_cotizacion(uuid, text, text) to authenticated;

commit;

-- =====================================================================
-- PRUEBA
--   1. Como ITO: una cotización con las 3 completas > "Enviar al Director".
--   2. Como Director: Cotización Obras > la abre > "Aprobar compra a Hevia".
--      Se crea la solicitud aprobada y la orden de compra OC-AAAA-NNN.
--   3. En el expediente de esa solicitud: "Descargar orden de compra (PDF)".
-- =====================================================================
