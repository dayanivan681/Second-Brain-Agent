# 0001 — Decisiones iniciales

Fecha: 2026-10-07 · Estado: propuesta (pendiente de consolidar en Obsidian)

1. **Obsidian es la autoridad** de objetivos, reglas y decisiones; la app guarda
   una copia derivada. Sin sincronización bidireccional automática en el MVP.
2. **Código en repositorio privado separado del Vault.**
3. **Dos rutas de construcción** (local y nube); la nube trabaja con un paquete
   de contexto portable con manifiesto de hashes.
4. **Sin paquete, solo datos sintéticos** claramente marcados; la importación
   real y su evaluación quedan pendientes. No se inventa el estado de proyectos.
5. **Cambios hacia el Vault como propuestas Markdown** con hash base; se rechazan
   si la nota cambió después de exportar.
6. **Stack propuesto:** TypeScript/Next.js, Vercel, Supabase Postgres + pgvector,
   OpenAI vía adaptador. Pendiente de verificar privacidad y precios.
7. **Núcleo de dominio en TypeScript puro** con `MemoryStore` en memoria como
   contrato; la persistencia se implementa después contra los mismos tests.
8. **Datos sintéticos neutrales:** no se usan los dominios candidatos reales en
   fixtures para no fabricar su estado.
