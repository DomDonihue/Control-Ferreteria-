-- =====================================================================
-- Control Ferretería — Correlativo automático de solicitudes
-- =====================================================================
--
-- Dos series independientes, que reinician cada año:
--   SM-2026-001, SM-2026-002 ...  solicitudes de materiales (normales y
--                                  especiales / fuera de catálogo)
--   OP-2026-001, OP-2026-002 ...  solicitudes de operaciones (ITO)
--
-- Se guarda en solicitud.correlativo (texto). Un trigger lo asigna solo al
-- crear la solicitud, de forma segura aunque dos personas ingresen a la vez.
-- Las solicitudes que ya existen sin correlativo se numeran en orden de
-- creación.
--
-- Es idempotente: se puede correr más de una vez sin problema.
-- Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

begin;

alter table solicitud add column if not exists correlativo text;

create table if not exists correlativo_contador (
  clave  text primary key,
  ultimo integer not null default 0
);
alter table correlativo_contador enable row level security;
-- sin políticas: solo lo toca la función (security definer), nadie desde la app.

create or replace function public.fn_siguiente_correlativo(p_tipo text, p_anio int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pref text := case when p_tipo = 'operaciones' then 'OP' else 'SM' end;
  v_n    integer;
begin
  insert into correlativo_contador(clave, ultimo)
  values (v_pref || '-' || p_anio, 1)
  on conflict (clave) do update set ultimo = correlativo_contador.ultimo + 1
  returning ultimo into v_n;

  return v_pref || '-' || p_anio || '-' || lpad(v_n::text, 3, '0');
end $$;

create or replace function public.fn_asignar_correlativo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.correlativo is null or btrim(new.correlativo) = '' then
    new.correlativo := public.fn_siguiente_correlativo(
      new.tipo, extract(year from coalesce(new.creado_en, now()))::int);
  end if;
  return new;
end $$;

drop trigger if exists trg_asignar_correlativo on solicitud;
create trigger trg_asignar_correlativo
  before insert on solicitud
  for each row execute function public.fn_asignar_correlativo();

-- Numera las solicitudes que ya existen sin correlativo, en orden de creación.
do $$
declare r record;
begin
  for r in
    select id, tipo, extract(year from creado_en)::int as anio
    from solicitud
    where correlativo is null or btrim(correlativo) = ''
    order by creado_en, id
  loop
    update solicitud set correlativo = public.fn_siguiente_correlativo(r.tipo, r.anio)
    where id = r.id;
  end loop;
end $$;

commit;

-- =====================================================================
-- PRUEBA
--   Ingresa una solicitud de materiales -> SM-AAAA-001 (o el siguiente).
--   Ingresa una de operaciones          -> OP-AAAA-001 (serie aparte).
--   select correlativo, tipo, creado_en from solicitud order by creado_en;
-- =====================================================================
