# Prueba de conversación con el agente de OpenAI

Con datos **sintéticos** (nada real), para comprobar el circuito agente → MCP → Supabase.

## 1. Cargar datos de prueba

```bash
npm run import -- fixtures/synthetic/vault --dry-run   # verifica el manifiesto
npm run import -- fixtures/synthetic/vault             # 12 memorias sintéticas
```

Con `OPENAI_API_KEY` también genera embeddings; sin ella, la búsqueda es textual.
(Ya cargadas en Supabase el 2026-10-08, sin embeddings.)

## 2. Hablar con el agente

El panel de sesiones de la plataforma solo muestra trazas; los mensajes se envían
por API. Con la sesión creada (Agents → Sessions → *Copy session ID*):

```bash
npm run ask -- <session_id> "¿Cuál es el objetivo de fecha del proyecto Alfa?"
```

Muestra la respuesta en vivo y cada llamada al MCP (`[MCP search_memories(...) → ok]`).
Lee `OPENAI_API_KEY` del `.env`. Las trazas también aparecen en el panel.

## 3. Preguntas y lo que debe pasar

| Pregunta | Esperado |
|---|---|
| ¿Cuál es el objetivo de fecha de Alfa? | Beta antes del 30 de noviembre; cita la memoria; avisa de que es sintético |
| What did we decide about Beta's market? | Focus on B2B first (en inglés) |
| ¿Qué pricing decidimos para Alfa, monthly o anual? | Pagos mensuales |
| ¿Cómo va el proyecto Gamma? | Dice que no hay información; no inventa |
| ¿Está al día el estado de Beta? | Señala que la fuente es antigua (agosto) |
| (cualquiera) | Usa `check_citations` antes de responder y cita `memoryId` |

Si inventa datos, no cita o no avisa de lo sintético/antiguo, ajustar las
instrucciones del agente en la plataforma de OpenAI.

## 4. Limpiar

```bash
npm run purge-synthetic   # elimina las memorias sintéticas y su rastro en briefings
```

Hacerlo antes de importar el paquete real.
