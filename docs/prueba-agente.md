# Prueba de conversación con el agente de OpenAI

Con datos **sintéticos** (nada real), para comprobar el circuito agente → MCP → Supabase.

## 1. Cargar datos de prueba

```bash
npm run import -- fixtures/synthetic/vault --dry-run   # verifica el manifiesto
npm run import -- fixtures/synthetic/vault             # 12 memorias sintéticas
```

Con `OPENAI_API_KEY` también genera embeddings; sin ella, la búsqueda es textual.

## 2. Preguntas y lo que debe pasar

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

## 3. Limpiar

```bash
npm run purge-synthetic   # elimina las memorias sintéticas y su rastro en briefings
```

Hacerlo antes de importar el paquete real.
