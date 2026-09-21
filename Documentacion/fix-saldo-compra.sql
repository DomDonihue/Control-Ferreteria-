-- =====================================================================
-- Control Ferretería — Arregla el cálculo de saldo al registrar una compra
-- =====================================================================
--
-- Error visto al guardar una factura:
--   "No se pudo descontar del convenio: null value in column
--    'saldo_resultante' of relation 'movimiento_saldo' violates
--    not-null constraint"
--
-- Causa: el trigger que crea el movimiento al insertar en `compra`
-- calculaba el saldo encadenando desde el último `saldo_resultante`
-- guardado. Si esa cadena se corta (por ejemplo tras un reverso de
-- anulación), el cálculo da null y la inserción falla.
--
-- Esta versión recalcula el saldo SIEMPRE desde cero con la misma
-- fórmula que usa la vista resumen_convenio y la función anular_factura:
--   saldo = monto_tope_anual + suma(monto) de todos los movimientos
--           que no sean 'apertura'.
-- Así nunca depende de un valor previo que pueda faltar.
--
-- Es idempotente (create or replace). Correr UNA vez en el SQL Editor.
-- =====================================================================

begin;

create or replace function public.fn_registrar_movimiento_compra()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_saldo numeric;
begin
  select ct.monto_tope_anual
       + coalesce(sum(m.monto) filter (where m.tipo <> 'apertura'), 0)
    into v_saldo
  from contrato ct
  left join movimiento_saldo m on m.contrato_id = ct.id
  where ct.id = new.contrato_id
  group by ct.monto_tope_anual;

  insert into movimiento_saldo(contrato_id, compra_id, tipo, monto, saldo_resultante, creado_por, fecha)
  values (new.contrato_id, new.id, 'compra', -new.monto_total,
          coalesce(v_saldo, 0) - new.monto_total, new.creado_por, current_date);

  return new;
end $$;

commit;

-- =====================================================================
-- PRUEBA
--   Guarda una factura nueva: debe descontarse del convenio sin error,
--   y el saldo en el Resumen debe quedar correcto.
-- =====================================================================
