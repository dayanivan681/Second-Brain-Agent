# Personal Intelligence System

Sistema privado que recuerda información importante, explica cambios y recomienda
próximos pasos **con evidencia**. Nombre provisional.

**Obsidian conserva la autoridad** sobre objetivos, reglas y decisiones. Este
repositorio guarda solo código, documentación y datos sintéticos; nunca el Vault.

## Estado

| Fase | Estado |
|---|---|
| 1. Contexto portable | **Pendiente** — falta el paquete con fuentes reales. Formato, manifiesto y validador listos. |
| 2. Memoria | **Implementada y probada con datos sintéticos**: núcleo + persistencia Postgres (esquema Supabase, probado con PGlite y el driver `pg`). Falta desplegar en un proyecto Supabase real. |
| 3. Consultas | Agente con herramientas y citas verificadas; falta conectar el modelo real (`OPENAI_API_KEY`) |
| 4. MVP | Briefing diario de Today programado; faltan Google Calendar y la interfaz |
| 5–6 | No iniciadas |

> Todo lo probado hasta ahora usa **datos sintéticos** (`fixtures/synthetic/`).
> No se ha consultado ningún archivo local ni el Vault real.

## Uso

```bash
npm ci
npm run check        # typecheck + tests + comprobación de rutas portables
node scripts/build-manifest.mjs <dir-paquete> <packageId>   # genera manifest.json
```

Requiere Node ≥ 20. Sin dependencias del Mac, iCloud ni rutas absolutas.

## Estructura

| Ruta | Contenido |
|---|---|
| `src/core/` | Dominio: memorias, importador Markdown, manifiesto, frescura, propuestas, evaluación |
| `src/db/` | Persistencia Postgres/Supabase |
| `src/agent/` | Agente de consultas con herramientas |
| `src/briefing/` | Briefing diario de Today |
| `src/mcp/` | Servidor MCP de solo lectura sobre la memoria |
| `supabase/migrations/` | Esquema SQL |
| `test/` | Contrato del dominio (Vitest) |
| `fixtures/synthetic/` | Vault y preguntas **sintéticas** |
| `scripts/` | Generador de manifiesto y verificación de portabilidad |
| `docs/` | Plan, arquitectura, roadmap, decisiones, formato del paquete de contexto |
| `vault-proposals/` | Cambios Markdown propuestos para el Vault, pendientes de revisión |

## Documentación

- [Proyecto](docs/proyecto.md) · [Arquitectura](docs/arquitectura.md) · [Roadmap](docs/roadmap.md)
- [Paquete de contexto portable](docs/contexto-portable.md) · [Supabase](docs/supabase.md) · [Agente](docs/agente.md) · [Briefing](docs/briefing.md) · [MCP](docs/mcp.md) · [Prueba del agente](docs/prueba-agente.md)
- [Decisiones](docs/decisiones/)
- [Propuestas para el Vault](vault-proposals/2026-10-07/LEEME.md)
