# Roadmap

| Fase | Entregable | Condición para avanzar | Estado |
|---|---|---|---|
| 1. Contexto portable | Fuentes seleccionadas, manifiesto y 30–50 preguntas de evaluación | Fuentes, respuestas esperadas y lagunas documentadas | Herramientas listas; **paquete real pendiente** |
| 2. Memoria | Importación, procedencia, revisiones, corrección y exportación | Cambios persistentes con historia preservada | Núcleo ✔; persistencia Postgres ✔ (PGlite); proyecto Supabase pendiente |
| 3. Consultas | Respuestas con evidencia e historial | Evaluación de estado actual e histórico aprobada | Arnés ✔; búsqueda híbrida ✔; agente con citas verificadas ✔ (falta modelo real) |
| 4. MVP | Calendar, Today y revisión de propuestas | Prioridades fundamentadas y fallos visibles | Briefing diario ✔ (rutina, salud, valoración); Calendar y UI pendientes |
| 5. Piloto | Dos semanas de uso, costes y fallos registrados | Criterios de aceptación cumplidos | — |
| 6. Expansión | Nuevos conectores y análisis | Necesidad demostrada para cada incorporación | — |

Estimación: 4–6 semanas de construcción + 2 de piloto, sujeta a disponibilidad de
fuentes y validación técnica.

## Criterios de aceptación y cobertura actual

| Criterio | Cobertura |
|---|---|
| Build y tests desde entorno limpio en la nube | CI (`.github/workflows/ci.yml`) |
| Sin rutas absolutas del Mac ni iCloud | `check:portable`, validador de manifiesto |
| Fuentes ausentes o antiguas señaladas | `assessFreshness` (`no-source`, `stale`, `synthetic`) |
| Propuestas Markdown con detección de conflictos | `checkProposal` |
| ≥ 90 % de respuestas correctas con evidencia | `scoreEvaluation` (sintético nunca aprueba) |
| Casos críticos: correcciones, decisiones revertidas, eliminación, datos ausentes | Tests de `MemoryStore` |
| Casos críticos: permisos | **Pendiente** (fase 4, auth) |
| Sin duplicados al reimportar; errores de sincronización visibles | Dedupe ✔; errores de sync pendientes (Calendar) |
| Exportación y restauración con versiones y evidencia | `export` / `restore` con checksum |
| Briefing útil 8 de 10 días laborables | Piloto (fase 5) |

## Próximos pasos

1. **(Usuario, local)** Revisar y aplicar `vault-proposals/2026-10-07/` en el Vault.
2. **(Usuario, local)** Preparar el paquete de contexto según `docs/contexto-portable.md`
   y redactar 30–50 preguntas de evaluación con respuestas esperadas.
3. **(Usuario)** Crear el proyecto Supabase (ver `docs/supabase.md`).
4. **(Constructor)** Adaptador LLM y capa de consultas con citas obligatorias.
