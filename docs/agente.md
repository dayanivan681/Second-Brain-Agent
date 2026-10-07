# Agente de consultas

`src/agent/`: un agente con herramientas que decide qué consultar hasta tener
evidencia, y responde con afirmaciones citadas.

## Cómo funciona

1. Recibe la pregunta (español, inglés o Spanglish).
2. Llama herramientas en bucle (`runAgent`), dentro de un presupuesto de pasos y llamadas.
3. Devuelve JSON: `answer`, `claims` (`fact` | `inference` | `recommendation`, con `memoryIds`) y `gaps`.
4. El sistema **verifica** la respuesta antes de aceptarla:
   - toda cita debe ser una memoria que alguna herramienta devolvió en esta ejecución;
   - todo `fact` debe citar evidencia;
   - si falla, se le pide una corrección una vez; si vuelve a fallar, no se devuelve ninguna afirmación.
5. Añade avisos automáticos: fuente antigua, sintética o sin fuente.
6. Devuelve también la traza (herramientas, argumentos, errores), el uso de tokens y las propuestas.

## Herramientas

| Herramienta | Efecto | Qué hace |
|---|---|---|
| `search_memories` | read | Búsqueda híbrida (texto + pgvector) o textual |
| `get_memory` | read | Memoria + historia de revisiones |
| `memory_as_of` | read | Estado en una fecha pasada |
| `list_domains` | read | Dominios, nº de memorias y fecha de la fuente más reciente |
| `propose_vault_change` | propose | Encola un cambio Markdown con hash base; **no lo aplica** |

## Autonomía

`AutonomyPolicy` define qué efectos ejecuta el agente sin pedir permiso y su
presupuesto. Por defecto: `read` + `propose`, 8 pasos, 16 llamadas.

| Nivel | Qué hace solo | Estado |
|---|---|---|
| 1. Responder | Investiga y responde con evidencia | ✔ |
| 2. Proponer | Deja cambios para el Vault en cola de revisión | ✔ |
| 3. Rutinas | Briefing diario programado ([briefing.md](briefing.md)); detección de contradicciones pendiente | ✔ parcial |
| 4. Escribir | Actualiza la memoria directamente | Requiere decidir la autoridad (abajo) |

**Decisión pendiente — autoridad de los datos.** Hoy Obsidian es la autoridad y el
agente solo propone. Si la autoridad pasa a la nube (Supabase), el nivel 4 se
habilita añadiendo herramientas con efecto `write` sobre `MemoryStore`, que ya
guarda historia y permite revertir. Obsidian quedaría como vista o exportación.

## Modelo

`ChatModel` es independiente del proveedor. `OpenAIChatModel` usa Chat Completions
con herramientas; configurar `OPENAI_API_KEY` y `OPENAI_CHAT_MODEL` (verificar
privacidad y precios). Los tests usan un modelo guionizado.
