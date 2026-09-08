# Control Ferretería — frontend

App mínima (sin build, sin npm) conectada a Supabase. Sirve para que el
Encargado de Operaciones, las unidades solicitantes, el Director de
Obras, la DAF y el Alcalde entren cada uno a lo que les corresponde
según su rol (definido en `perfiles`, ver `kardex_ferreteria_schema.sql`).

## 1. Configurar Supabase

1. Ya corriste `kardex_ferreteria_schema.sql` y `kardex_ferreteria_seed.sql`
   en el SQL Editor de tu proyecto.
2. En Supabase → **Project Settings → API**, copia:
   - **Project URL**
   - **anon public key**
3. Pégalos en `config.js` (reemplaza los dos valores de ejemplo).

## 2. Subir esto a GitHub

```bash
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/DomDonihue/Control-Ferreteria-.git
git push -u origin main
```

(Crea antes el repositorio vacío en github.com — sin README ni
.gitignore, para que no choque con este push.)

## 3. Publicarlo gratis con GitHub Pages

1. En el repo, ve a **Settings → Pages**.
2. En "Build and deployment" elige **Deploy from a branch**, rama
   `main`, carpeta `/ (root)`.
3. Guarda. En un par de minutos queda publicado en
   `https://github.com/DomDonihue/Control-Ferreteria-.git`.

Cada vez que subas un cambio (`git push`), el sitio se actualiza solo.

## 4. Crear tu primer usuario y entrar

1. Supabase → **Authentication → Users → Add user** (o "Invite"),
   con tu correo. Fíjale una clave.
2. Copia el UUID que le asignó Supabase.
3. En el SQL Editor:
   ```sql
   insert into perfiles (id, nombre, rol)
   values ('<ese-uuid>', 'Tu nombre', 'admin');
   ```
   (`admin` = administrador total. Los demás perfiles ya no hace falta
   crearlos a mano: entran una vez y quedan como `pendiente`, y tú les
   asignas rol y unidad desde la pestaña **Usuarios**.)
4. Entra al sitio publicado con ese correo y esa clave.

Repite el paso 1-3 para el resto de las personas (Leonardo Galaz como
`lector_pagos`, Boris Acuña como `lector_ejecutivo`, el Director de
Obras como `lector_operativo`, y cada solicitante con su
`unidad_id` correspondiente) — están las plantillas comentadas en
`kardex_ferreteria_seed.sql`.

## Roles

| Rol | Para quién | Qué puede |
|---|---|---|
| `admin` | Administrador de la plataforma | **todo**: administra usuarios (rol + unidad), catálogo de artículos, y además todo lo operativo |
| `admin_ito` | Encargado de Operaciones (ITO) | operación: crear solicitudes, **aprobar/rechazar**, generar compras. NO administra usuarios ni catálogo |
| `solicitante` | Unidades solicitantes | crear solicitudes de su unidad y ver las suyas |
| `lector_operativo` | Director de Obras | ver solicitudes y compras |
| `lector_pagos` | DAF | ver compras |
| `lector_ejecutivo` | Alcalde | ver el resumen |
| `pendiente` | recién ingresados | nada, hasta que `admin` le asigne rol |

## Qué hace cada pantalla

| Pestaña | Quién la ve | Qué permite |
|---|---|---|
| Resumen | todos | tope, comprometido, saldo disponible, % usado |
| Nueva solicitud | solicitante, admin_ito, admin | armar una solicitud con varios artículos |
| Solicitud especial | admin_ito, admin | material fuera de catálogo: justificación → cotización → decreto/OC de Mercado Público |
| Solicitudes | admin, admin_ito, solicitante, lector_operativo | listar; admin_ito/admin pueden aprobar/rechazar |
| Compras | admin, admin_ito, lector_operativo, lector_pagos | admin_ito/admin generan la compra desde una solicitud aprobada; el resto solo mira |
| Catálogo | **admin** | alta y edición de artículos (tabla `articulo`) |
| Usuarios | **admin** | asignar rol y unidad a cada persona (edita la tabla `perfiles`) |

## ¿Esto lo controla la base de datos?

**Sí, y esa es la parte que manda.** Las pestañas de `app.js` solo deciden
qué se *muestra*; quien realmente autoriza o rechaza cada lectura y cada
escritura es la **RLS de Supabase**. Por eso, al separar `admin` (total)
de `admin_ito` (operación), hay que ajustar también las políticas: si no,
un ITO podría igual escribir en `perfiles` o `articulo` llamando la API
directo, aunque no vea la pestaña.

## Pestañas "Usuarios" y "Catálogo" — RLS

`perfiles` ya es la tabla de usuarios (`id` = UUID de Authentication,
`nombre`, `rol`, `unidad_id`). No hay tabla nueva. Al primer ingreso la
app crea un perfil `pendiente`; el `admin` le asigna rol + unidad desde
**Usuarios** y queda guardado con un `update` sobre `perfiles`. El
**Catálogo** hace `insert`/`update` sobre `articulo`.

Cargar **una vez** en el **SQL Editor** (la función `security definer`
evita la recursión de RLS al leer el propio rol):

```sql
-- El CHECK original de perfiles.rol no conoce 'admin' ni 'pendiente':
-- hay que ampliarlo o fallan el alta automática y el update a admin.
alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol in ('admin','admin_ito','solicitante',
                 'lector_operativo','lector_pagos','lector_ejecutivo','pendiente'));

alter table perfiles enable row level security;
alter table articulo enable row level security;

create or replace function public.rol_actual()
returns text language sql stable security definer set search_path = public
as $$ select rol from public.perfiles where id = auth.uid() $$;

-- PERFILES: cada quien ve el suyo y puede crearse uno "pendiente"
drop policy if exists "perfil propio ver"   on perfiles;
drop policy if exists "perfil propio crear" on perfiles;
create policy "perfil propio ver"   on perfiles for select using (auth.uid() = id);
create policy "perfil propio crear" on perfiles for insert
  with check (auth.uid() = id and rol = 'pendiente');

-- PERFILES: solo 'admin' ve y edita todos
drop policy if exists "admin ve perfiles"    on perfiles;
drop policy if exists "admin edita perfiles" on perfiles;
create policy "admin ve perfiles"    on perfiles for select using (public.rol_actual() = 'admin');
create policy "admin edita perfiles" on perfiles for update
  using (public.rol_actual() = 'admin') with check (public.rol_actual() = 'admin');

-- ARTICULO: todos los autenticados lo leen (para armar solicitudes);
-- solo 'admin' lo modifica
drop policy if exists "articulo lectura"  on articulo;
drop policy if exists "articulo admin"    on articulo;
create policy "articulo lectura" on articulo for select using (auth.role() = 'authenticated');
create policy "articulo admin"   on articulo for all
  using (public.rol_actual() = 'admin') with check (public.rol_actual() = 'admin');

-- CLAVE PROVISORIA: marca en el perfil + función para que el usuario
-- desmarque su propia bandera al cambiar la clave (sin poder tocar rol/unidad).
alter table perfiles add column if not exists debe_cambiar_clave boolean not null default true;

create or replace function public.marcar_clave_cambiada()
returns void language sql security definer set search_path = public
as $$ update public.perfiles set debe_cambiar_clave = false where id = auth.uid() $$;
grant execute on function public.marcar_clave_cambiada() to authenticated;
```

### Cómo funciona la clave provisoria

1. Creas el usuario en **Authentication → Users → Add user** con un correo y una
   **clave provisoria** (marca *Auto Confirm User*). Le pasas esa clave a la persona.
2. `debe_cambiar_clave` viene en `true` por defecto (o lo activas después con el
   botón **"Pedir cambio"** de la pestaña Usuarios).
3. Al ingresar, el sistema le muestra *"Cambia tu clave provisoria"* y no lo deja
   avanzar hasta que define una nueva (mínimo 6 caracteres). Ahí llama
   `supabase.auth.updateUser({ password })` y luego `rpc('marcar_clave_cambiada')`.
4. Después puede volver a cambiarla cuando quiera desde la pestaña **Cambiar clave**.

Si algún usuario existente ya tenía su clave definitiva, quítale la marca con:
`update perfiles set debe_cambiar_clave = false where id = '<uuid>';`

Las políticas que ya trae `kardex_ferreteria_schema.sql` para que
`admin_ito` apruebe solicitudes y genere compras **se dejan como están**
— ese es el trabajo operativo del ITO. Si quieres que `admin` también
pueda hacerlo por API (además de por pantalla), agrega en esas políticas
`or public.rol_actual() = 'admin'`.

(Si ya tenías una política de "ver su propio perfil" con otro nombre, el
`drop policy if exists` no la toca; bórrala tú si queda duplicada.)

## Ajustes en Supabase para el formulario de "Nueva solicitud"

El formulario pide: quién solicita, motivo, dirección de la obra o
problemática, un adjunto (memo / oficio / informe / foto) y los
productos del catálogo. Para que guarde todo hay que preparar Supabase
una sola vez:

1. **SQL Editor** — dos columnas nuevas en `solicitud`:
   ```sql
   alter table solicitud add column if not exists ubicacion text;
   alter table solicitud add column if not exists memo_url  text;
   ```
   `ubicacion` es obligatoria en el formulario: sin esta columna, enviar
   una solicitud dará error.

2. **Storage → New bucket**, nombre `memos`, marcado como **Public**
   (así el enlace "documento" del listado abre directo). Solo hace falta
   si se van a subir adjuntos.

`solicitante` y `motivo` ya existían en la tabla, no requieren cambios.
La solicitud ya **no lleva precios**: solo material y cantidad. Los montos
llegan después en la guía de despacho y en la factura.

## Expediente por solicitud (hoja → guías → factura)

Flujo:

1. El **ITO** ingresa la solicitud (material, motivo, dirección, adjunto).
2. El **Director de Obras** le da el visto bueno en la pestaña *Solicitudes*
   (aprobar / rechazar). Antes esto lo hacía el ITO; ahora es el Director.
3. Aprobada, el ITO entra a **Expedientes → Abrir** y descarga la
   **hoja de solicitud (PDF)** estilo cotización para enviarla por correo
   a la empresa. Marca la solicitud como *enviada*.
4. Cuando llega el material, registra la(s) **guía(s) de despacho**
   (N°, fecha, fecha de ingreso, neto, IVA 19 %, bruto, adjunto). Puede
   haber varias guías por una misma solicitud (despachos parciales).
5. Al final registra **una factura** (N°, fecha, montos, fecha de pago,
   adjunto). El expediente queda con todo el respaldo para transparencia.

Preparar Supabase **una vez** (SQL Editor):

```sql
-- Estados nuevos del flujo
alter table solicitud drop constraint if exists solicitud_estado_check;
alter table solicitud add constraint solicitud_estado_check
  check (estado in ('pendiente','aprobada','rechazada','enviada',
                    'recibida','facturada','cerrada'));

-- Correlativo opcional para la hoja (si lo quieres numerado)
alter table solicitud add column if not exists n_solicitud bigint;

-- GUÍAS DE DESPACHO (varias por solicitud)
create table if not exists guia_despacho (
  id            uuid primary key default gen_random_uuid(),
  solicitud_id  uuid not null references solicitud(id) on delete cascade,
  numero        text not null,
  fecha         date not null,
  fecha_ingreso date not null default current_date,
  monto_neto    numeric not null default 0,
  iva           numeric not null default 0,
  monto_bruto   numeric not null default 0,
  archivo_url   text,
  observacion   text,
  creado_por    uuid references perfiles(id),
  creado_en     timestamptz not null default now()
);

-- FACTURA (una por solicitud). Si la tabla ya existe, solo agrega columnas.
create table if not exists factura (
  id            uuid primary key default gen_random_uuid(),
  solicitud_id  uuid references solicitud(id) on delete cascade,
  creado_en     timestamptz not null default now()
);
alter table factura add column if not exists numero      text;
alter table factura add column if not exists fecha       date;
alter table factura add column if not exists monto_neto  numeric default 0;
alter table factura add column if not exists iva         numeric default 0;
alter table factura add column if not exists monto_bruto numeric default 0;
alter table factura add column if not exists fecha_pago  date;
alter table factura add column if not exists archivo_url text;
alter table factura add column if not exists creado_por  uuid references perfiles(id);

-- RLS
alter table guia_despacho enable row level security;
alter table factura       enable row level security;

drop policy if exists "guia lectura" on guia_despacho;
drop policy if exists "guia escribe"  on guia_despacho;
drop policy if exists "guia crea"     on guia_despacho;
drop policy if exists "guia edita"    on guia_despacho;
drop policy if exists "guia elimina"  on guia_despacho;
create policy "guia lectura" on guia_despacho for select using (auth.role() = 'authenticated');
create policy "guia crea"    on guia_despacho for insert with check (public.rol_actual() in ('admin','admin_ito'));
create policy "guia edita"   on guia_despacho for update
  using (public.rol_actual() in ('admin','admin_ito')) with check (public.rol_actual() in ('admin','admin_ito'));
create policy "guia elimina" on guia_despacho for delete using (public.rol_actual() = 'admin'); -- solo admin borra

drop policy if exists "factura lectura" on factura;
drop policy if exists "factura escribe"  on factura;
drop policy if exists "factura crea"     on factura;
drop policy if exists "factura edita"    on factura;
drop policy if exists "factura elimina"  on factura;
create policy "factura lectura" on factura for select using (auth.role() = 'authenticated');
create policy "factura crea"    on factura for insert with check (public.rol_actual() in ('admin','admin_ito'));
create policy "factura edita"   on factura for update
  using (public.rol_actual() in ('admin','admin_ito')) with check (public.rol_actual() in ('admin','admin_ito'));
create policy "factura elimina" on factura for delete using (public.rol_actual() = 'admin'); -- solo admin borra

-- Aprobación por el Director de Obras (rol lector_operativo)
drop policy if exists "director aprueba solicitud" on solicitud;
create policy "director aprueba solicitud" on solicitud for update
  using (public.rol_actual() in ('admin','lector_operativo'))
  with check (public.rol_actual() in ('admin','lector_operativo'));

-- COMPRA: la usa guardarFactura() para descontar del convenio (dispara el
-- trigger trg_compra_movimiento), y también se borra/edita al corregir o
-- eliminar una factura. admin y admin_ito pueden crear/editar/borrar.
alter table compra enable row level security;
drop policy if exists "cf compra lee"     on compra;
drop policy if exists "cf compra crea"    on compra;
drop policy if exists "cf compra edita"   on compra;
drop policy if exists "cf compra elimina" on compra;
create policy "cf compra lee"     on compra for select using (auth.role() = 'authenticated');
create policy "cf compra crea"    on compra for insert with check (public.rol_actual() in ('admin','admin_ito'));
create policy "cf compra edita"   on compra for update
  using (public.rol_actual() in ('admin','admin_ito')) with check (public.rol_actual() in ('admin','admin_ito'));
create policy "cf compra elimina" on compra for delete using (public.rol_actual() in ('admin','admin_ito'));

-- MOVIMIENTO_SALDO: la llena el trigger trg_compra_movimiento al insertar en
-- compra, corriendo como el usuario que hizo la acción — también necesita RLS.
-- update/delete además los usa recalcularSaldoContrato() al corregir/borrar facturas.
alter table movimiento_saldo enable row level security;
drop policy if exists "cf movimiento lee"     on movimiento_saldo;
drop policy if exists "cf movimiento crea"    on movimiento_saldo;
drop policy if exists "cf movimiento edita"   on movimiento_saldo;
drop policy if exists "cf movimiento elimina" on movimiento_saldo;
create policy "cf movimiento lee"     on movimiento_saldo for select using (auth.role() = 'authenticated');
create policy "cf movimiento crea"    on movimiento_saldo for insert with check (public.rol_actual() in ('admin','admin_ito'));
create policy "cf movimiento edita"   on movimiento_saldo for update
  using (public.rol_actual() in ('admin','admin_ito')) with check (public.rol_actual() in ('admin','admin_ito'));
create policy "cf movimiento elimina" on movimiento_saldo for delete using (public.rol_actual() in ('admin','admin_ito'));

-- Semilla de "apertura": el trigger de compra necesita un movimiento previo
-- del que partir; si un contrato vigente no tiene ninguno, la primera
-- factura falla con "saldo_resultante ... violates not-null constraint".
-- Corre esto una vez para dejar sembrado el/los contrato(s) vigentes que
-- ya existan (la app ya siembra esto sola para los contratos nuevos):
insert into movimiento_saldo (contrato_id, compra_id, tipo, monto, saldo_resultante)
select c.id, null, 'apertura', c.monto_tope_anual, c.monto_tope_anual
from contrato c
where c.estado = 'vigente'
  and not exists (select 1 from movimiento_saldo m where m.contrato_id = c.id);

-- CONTRATO / datos de la ferretería: lo lee todo autenticado (el Resumen),
-- solo 'admin' lo edita desde la pestaña "Convenio / ferretería"
alter table contrato enable row level security;
drop policy if exists "contrato lectura" on contrato;
drop policy if exists "contrato admin"   on contrato;
create policy "contrato lectura" on contrato for select using (auth.role() = 'authenticated');
create policy "contrato admin"   on contrato for all
  using (public.rol_actual() = 'admin') with check (public.rol_actual() = 'admin');
```

Y en **Storage → New bucket** crea dos buckets **públicos**: `guias` y
`facturas` (además del `memos` que ya tienes), con la misma política de
lectura pública / subida autenticada:

```sql
insert into storage.buckets (id, name, public) values
  ('guias','guias',true), ('facturas','facturas',true)
on conflict (id) do nothing;

drop policy if exists "docs lectura" on storage.objects;
drop policy if exists "docs subir"   on storage.objects;
create policy "docs lectura" on storage.objects for select
  using (bucket_id in ('memos','guias','facturas','especiales'));
create policy "docs subir" on storage.objects for insert
  with check (bucket_id in ('memos','guias','facturas','especiales') and auth.role() = 'authenticated');
```

## Formulario Único de Solicitud de Materiales (Anexo A)

La pestaña **"Nueva solicitud"** es el Formulario Único del Manual: identificación,
descripción/justificación técnica (5 campos), tabla de materiales (material,
cantidad, unidad, valor referencial), respaldos adjuntos, y situaciones
especiales (CDP negativo / producto fuera de catálogo). Si se marca **"fuera de
catálogo"**, la solicitud entra como `tipo='especial'` y en su expediente
aparecen los adjuntos de **Justificación Unidad Jurídica** y **Justificación DAF**
(y, si hay CDP negativo, los 4 respaldos del punto 8). Ya no hay pestaña
"Solicitud especial" aparte — es la misma.

**Autocompletar desde el PDF:** el formulario tiene un campo para cargar el
*Formulario Único editable* (`Documentacion/Formulario_Unico_Solicitud_Materiales_DOM_editable.pdf`).
Con `pdf-lib` (cargado en `index.html`) se leen sus campos AcroForm y se llena la
pantalla; el usuario revisa y corrige antes de enviar.

Correr **una vez** en el SQL Editor:

```sql
-- FORMULARIO ÚNICO: campos nuevos en solicitud
alter table solicitud add column if not exists correlativo               text;
alter table solicitud add column if not exists contacto                  text;
alter table solicitud add column if not exists supervisor                text;
alter table solicitud add column if not exists descripcion_requerimiento text;
alter table solicitud add column if not exists situacion_actual          text;
alter table solicitud add column if not exists trabajo_ejecutar          text;
alter table solicitud add column if not exists beneficio_publico         text;
alter table solicitud add column if not exists resp_fotografico          boolean default false;
alter table solicitud add column if not exists num_fotos                 integer;
alter table solicitud add column if not exists resp_informe_tecnico      boolean default false;
alter table solicitud add column if not exists resp_presupuesto          boolean default false;
alter table solicitud add column if not exists resp_otro                 boolean default false;
alter table solicitud add column if not exists resp_otro_texto           text;
alter table solicitud add column if not exists cdp_negativo              boolean default false;
-- adjuntos de la solicitud (sección 4)
alter table solicitud add column if not exists formulario_url               text;
-- adjuntos de la solicitud especial / CDP negativo
alter table solicitud add column if not exists just_juridica_url            text;
alter table solicitud add column if not exists just_daf_url                 text;
alter table solicitud add column if not exists cdp_negativo_url             text;
alter table solicitud add column if not exists just_reforzada_url           text;
alter table solicitud add column if not exists pronunciamiento_juridica_url text;
alter table solicitud add column if not exists resp_fotografico_url         text;

-- FORMULARIO ÚNICO: detalle de materiales — solo material y cantidad
-- (los valores llegan en las guías de despacho, no en la solicitud)
alter table solicitud_detalle add column if not exists unidad_medida_libre text;
```

## Solicitud especial (material fuera de catálogo) + notas de crédito

También se agregó **editar/eliminar factura** (para errores de digitación) y
**notas de crédito** (para correcciones reales del proveedor) — eliminar queda
restringido a `admin`.

Correr **una vez** en el SQL Editor:

```sql
-- SOLICITUD: tipo especial + campos de Mercado Público
alter table solicitud add column if not exists tipo text default 'normal';
alter table solicitud drop constraint if exists solicitud_tipo_check;
alter table solicitud add constraint solicitud_tipo_check check (tipo in ('normal','especial'));

alter table solicitud add column if not exists justificacion_especial text;
alter table solicitud add column if not exists n_decreto      text;
alter table solicitud add column if not exists fecha_decreto  date;
alter table solicitud add column if not exists decreto_url    text;
alter table solicitud add column if not exists n_orden_compra text;
alter table solicitud add column if not exists fecha_oc       date;
alter table solicitud add column if not exists oc_url         text;

-- SOLICITUD_DETALLE: ítems sin artículo de catálogo (texto libre)
alter table solicitud_detalle alter column articulo_id drop not null;
alter table solicitud_detalle add column if not exists descripcion_libre text;

-- COTIZACION (una o varias por solicitud especial)
create table if not exists cotizacion (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references solicitud(id) on delete cascade,
  proveedor    text not null,
  numero       text,
  fecha        date not null,
  monto_neto   numeric not null default 0,
  iva          numeric not null default 0,
  monto_bruto  numeric not null default 0,
  archivo_url  text,
  creado_por   uuid references perfiles(id),
  creado_en    timestamptz not null default now()
);
alter table cotizacion enable row level security;
drop policy if exists "cotizacion lectura" on cotizacion;
drop policy if exists "cotizacion escribe" on cotizacion;
create policy "cotizacion lectura" on cotizacion for select using (auth.role() = 'authenticated');
create policy "cotizacion escribe" on cotizacion for all
  using (public.rol_actual() in ('admin','admin_ito'))
  with check (public.rol_actual() in ('admin','admin_ito'));
grant select, insert, update, delete on cotizacion to authenticated;

-- Bucket para cotización, decreto y orden de compra
insert into storage.buckets (id, name, public) values ('especiales','especiales',true)
on conflict (id) do nothing;

-- NOTA_CREDITO (corrige una factura ya emitida)
create table if not exists nota_credito (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references solicitud(id) on delete cascade,
  factura_id   uuid references factura(id) on delete set null,
  numero       text,
  fecha        date not null,
  motivo       text,
  monto_neto   numeric not null default 0,
  iva          numeric not null default 0,
  monto_bruto  numeric not null default 0,
  archivo_url  text,
  creado_por   uuid references perfiles(id),
  creado_en    timestamptz not null default now()
);
alter table nota_credito enable row level security;
drop policy if exists "nc lectura" on nota_credito;
drop policy if exists "nc crea"    on nota_credito;
drop policy if exists "nc edita"   on nota_credito;
drop policy if exists "nc elimina" on nota_credito;
create policy "nc lectura" on nota_credito for select using (auth.role() = 'authenticated');
create policy "nc crea"    on nota_credito for insert with check (public.rol_actual() in ('admin','admin_ito'));
create policy "nc edita"   on nota_credito for update
  using (public.rol_actual() in ('admin','admin_ito')) with check (public.rol_actual() in ('admin','admin_ito'));
create policy "nc elimina" on nota_credito for delete using (public.rol_actual() = 'admin'); -- solo admin borra
grant select, insert, update, delete on nota_credito to authenticated;
```

**Sobre `compra`, `factura` y otras tablas que ya existían antes de este
proyecto:** suelen traer columnas obligatorias con otros nombres/relaciones
(por ejemplo `factura.compra_id` o `factura.n_factura`) que esta app no
llena. Si al guardar algo sale `null value in column "..." violates not-null
constraint` o `Could not find the '...' column`, corre esto para esa tabla
(reemplaza `factura` por la tabla que falle):

```sql
alter table factura add column if not exists solicitud_id uuid references solicitud(id) on delete cascade;

do $$
declare r record;
begin
  for r in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'factura'
      and is_nullable = 'NO' and column_default is null
      and column_name <> 'id'
  loop
    execute format('alter table factura alter column %I drop not null', r.column_name);
  end loop;
end $$;
```

> **Resumen / saldo del convenio:** no requiere cambios de SQL. El gasto
> se descuenta cuando se registra la **factura**: `guardarFactura()` en
> `app.js` inserta una fila en `compra` con el monto bruto, y el trigger
> `trg_compra_movimiento` crea el `movimiento_saldo` que alimenta la vista
> `resumen_convenio`. Necesita un `contrato` con `estado = 'vigente'`.

## Qué falta para una v2 (no bloquea el piloto)

- Total estimado al pie de la solicitud (hoy no hay precios en esa etapa,
  es a propósito).
- Imagen del producto en el catálogo y en la solicitud (las 111 fotos
  quedaron listas, falta cargarlas al bucket y agregar la columna).
- Botón de "olvidé mi clave" (`supabase.auth.resetPasswordForEmail`).
- Numerar `n_solicitud` automáticamente (hoy queda null salvo que lo
  cargues; la hoja PDF funciona igual sin número).
