---
type: project
status: planificación
updated: 2026-10-07
tags:
  - proyectos
  - inteligencia-personal
---
# Personal Intelligence System

## Objetivo

Sistema privado que recuerda información importante, explica cambios y recomienda próximos pasos con evidencia.

## Fuentes

- Este Vault (autoridad de objetivos, reglas y decisiones) — vía paquete de contexto seleccionado
- Documentos seleccionados
- Google Calendar (solo lectura; autoridad de sus eventos)

## Estado

- Planificación. Repositorio privado creado con núcleo de memoria probado solo con datos sintéticos.
- Paquete de contexto real: pendiente.
- Estado de los dominios candidatos: sin establecer (se tomará de fuentes seleccionadas).

## Decisiones

- 2026-10-07: Obsidian conserva la autoridad sobre objetivos, reglas y decisiones; la app guarda una copia derivada
- 2026-10-07: Código en repositorio privado separado del Vault
- 2026-10-07: Cambios desde la nube llegan como propuestas Markdown revisables; nunca sobrescriben notas más recientes
- 2026-10-07: Sin sincronización bidireccional automática en el MVP
- Detalle: [[2026-10-07 Personal Intelligence System]]

## Arquitectura

- TypeScript/Next.js en Vercel, Supabase Postgres + pgvector, OpenAI mediante adaptador (verificar privacidad y precios antes de contratar)
- Un agente principal con herramientas limitadas
- Memorias con fechas, fuentes, versiones y distinción hecho / inferencia / recomendación
- Acceso individual, MFA, permisos por dominio, secretos fuera del Vault

## Roadmap

| Fase | Entregable | Condición para avanzar |
|---|---|---|
| 1. Contexto portable | Fuentes, manifiesto, 30–50 preguntas | Fuentes, respuestas esperadas y lagunas documentadas |
| 2. Memoria | Importación, procedencia, revisiones, corrección, exportación | Cambios persistentes con historia |
| 3. Consultas | Respuestas con evidencia e historial | Evaluación actual e histórica aprobada |
| 4. MVP | Calendar, Today, revisión de propuestas | Prioridades fundamentadas y fallos visibles |
| 5. Piloto | 2 semanas, costes y fallos | Criterios de aceptación cumplidos |
| 6. Expansión | Nuevos conectores | Necesidad demostrada |

Estimación: 4–6 semanas + 2 de piloto.

## Próximos pasos

- [ ] Revisar e incorporar esta nota y el log del 2026-10-07
- [ ] Enlazar desde el índice de proyectos y el Centro de Mando
- [ ] Seleccionar fuentes y generar el paquete de contexto con manifiesto
- [ ] Redactar 30–50 preguntas de evaluación con respuestas esperadas y lagunas
- [ ] Persistencia en Supabase sobre el contrato de tests existente
