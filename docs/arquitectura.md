# Arquitectura

## Propuesta

| Capa | Elección | Estado |
|---|---|---|
| Dominio | TypeScript puro (`src/core`) | Implementado |
| App | Next.js en Vercel | Fase 4 |
| Datos | Supabase Postgres + almacenamiento privado | Esquema y adaptador implementados ([supabase.md](supabase.md)); proyecto real pendiente |
| Búsqueda | Híbrida: texto normalizado + pgvector (RRF) | Implementada; embeddings reales pendientes de clave |
| LLM | OpenAI mediante adaptador intercambiable | Fase 3 |
| Calendario | Google Calendar, solo lectura | Fase 4 |

Verificar capacidades, privacidad y precios de cada servicio **antes de contratar**.

## Principios

- **Un agente principal con herramientas limitadas.** Sin agentes permanentes.
- **Procedencia obligatoria.** Cada memoria lleva `sourceId`, ruta relativa,
  hash, versión y fecha de captura; nada sin fuente se presenta como actual.
- **Distinción epistémica.** `fact` (lo que dice la fuente), `inference`,
  `recommendation`. El importador solo produce `fact`.
- **Historia preservada.** Correcciones y retracciones se registran como
  revisiones; `asOf(fecha)` responde el estado histórico.
- **Eliminación real.** `delete` purga el texto y las revisiones; queda una
  lápida para que reimportar no lo resucite.
- **Idempotencia.** Reimportar la misma fuente no duplica; lo que desaparece de
  la fuente se retracta (decisiones revertidas).
- **Portabilidad.** Sin rutas absolutas del Mac; `npm run check:portable` lo
  comprueba en CI.

## Modelo de datos (núcleo)

```
Memory { id, key, domain, category, epistemic, statement, status,
         sources: SourceRef[], revisions: Revision[], createdAt, updatedAt }
SourceRef { sourceId, path, contentHash, version?, capturedAt, synthetic, anchor? }
Revision { at, by: import|user|system, change, previousStatement?, reason?, source? }
```

`MemoryStore` contiene la lógica sobre un `MemoryRepository`; los adaptadores en
memoria y Postgres pasan los mismos tests de contrato.

## Seguridad

Acceso individual con MFA, permisos por dominio, secretos fuera del Vault y del
repositorio (variables de entorno gestionadas), límites de consumo del LLM. El
validador del manifiesto rechaza paquetes con secretos detectables.
