# Persistencia en Supabase

## Esquema

`supabase/migrations/20261007000000_memory.sql`

| Tabla | Contenido |
|---|---|
| `memories` | Agregado: clave de deduplicación, dominio, categoría, `epistemic`, texto, estado, fechas |
| `memory_sources` | Fuentes citadas (orden `seq`): `source_id`, ruta relativa, hash, versión, captura, `synthetic`, ancla |
| `memory_revisions` | Historia (orden `seq`): quién, qué cambio, texto anterior, motivo, fuente citada |

Garantías en la base de datos:

- `key` única: reimportar no duplica.
- `check` en categoría, `epistemic`, estado, `by` y `change`.
- Una lápida (`status = 'deleted'`) no puede conservar texto.
- `on delete cascade` de fuentes y revisiones.
- RLS activado **sin políticas**: solo el rol de servicio accede (desde el servidor).
  Las políticas por usuario y dominio llegan con la autenticación (fase 4).

## Código

| Pieza | Papel |
|---|---|
| `MemoryRepository` (`src/core/repository.ts`) | Interfaz de persistencia de agregados |
| `InMemoryRepository` | Adaptador en memoria |
| `PostgresMemoryRepository` (`src/db/`) | Adaptador Postgres; cada operación del `MemoryStore` es una transacción |
| `createPgClient` | Driver `pg` para Supabase |
| `createPgliteClient` | Postgres embebido (WASM) para tests |
| `migrate` | Aplica `supabase/migrations/*.sql` (tests y local) |

Los tests de contrato (`test/store.test.ts`) corren contra ambos adaptadores;
`test/pg-driver.test.ts` usa el driver `pg` por el protocolo de red real contra
PGlite. No se ha probado contra un proyecto Supabase real.

## Puesta en marcha (pendiente, requiere cuenta)

1. Verificar plan, región y condiciones de privacidad de Supabase antes de crear el proyecto.
2. Crear el proyecto y aplicar migraciones: `supabase link --project-ref <ref>` y `supabase db push`.
3. Guardar `DATABASE_URL` como variable de entorno del servidor (Vercel), nunca en el Vault.
4. Exportar con `MemoryStore.export()` y probar `restore` en un repositorio vacío antes de importar datos reales.

## Pendiente

- pgvector y búsqueda semántica (la búsqueda actual es textual, en la aplicación).
- Políticas RLS por usuario y dominio.
- Concurrencia: pensado para un único usuario; dos importaciones simultáneas de
  la misma fuente podrían chocar en la clave única (la transacción se revierte).
