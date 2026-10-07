# Personal Intelligence System

Sistema privado que recuerda información importante, explica cambios y recomienda
próximos pasos **con evidencia**. Nombre provisional.

**Obsidian conserva la autoridad** sobre objetivos, reglas y decisiones. Este
repositorio guarda solo código, documentación y datos sintéticos; nunca el Vault.

## Estado

| Fase | Estado |
|---|---|
| 1. Contexto portable | **Pendiente** — falta el paquete con fuentes reales. Formato, manifiesto y validador listos. |
| 2. Memoria | **Núcleo implementado y probado con datos sintéticos** (importación, procedencia, revisiones, corrección, eliminación, exportación/restauración). Falta persistencia en Postgres. |
| 3–6 | No iniciadas |

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
| `test/` | Contrato del dominio (Vitest) |
| `fixtures/synthetic/` | Vault y preguntas **sintéticas** |
| `scripts/` | Generador de manifiesto y verificación de portabilidad |
| `docs/` | Plan, arquitectura, roadmap, decisiones, formato del paquete de contexto |
| `vault-proposals/` | Cambios Markdown propuestos para el Vault, pendientes de revisión |

## Documentación

- [Proyecto](docs/proyecto.md) · [Arquitectura](docs/arquitectura.md) · [Roadmap](docs/roadmap.md)
- [Paquete de contexto portable](docs/contexto-portable.md)
- [Decisiones](docs/decisiones/)
- [Propuestas para el Vault](vault-proposals/2026-10-07/LEEME.md)
