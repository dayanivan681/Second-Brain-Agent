# Servidor MCP (memoria para cualquier agente)

`src/mcp/` + `scripts/mcp-server.ts` (`npm run mcp`).

Expone la memoria como servidor MCP remoto (Streamable HTTP, sin estado) para que
agentes externos —la Agents API de OpenAI, ChatGPT, Claude, Codex— la consulten.

## Herramientas (solo lectura)

| Herramienta | Qué hace |
|---|---|
| `search_memories` | Búsqueda híbrida (texto + pgvector si hay `OPENAI_API_KEY`) |
| `get_memory` | Memoria + historia de revisiones |
| `memory_as_of` | Estado en una fecha pasada |
| `list_domains` | Dominios, nº de memorias, fuente más reciente |
| `check_citations` | Verifica `memoryId` antes de citarlos: existen, activos, frescura, fuente |
| `get_briefing` | Briefing de Today de una fecha o el último |

Las instrucciones del servidor piden citar `memoryId`, distinguir hecho/inferencia/
recomendación, avisar de fuentes antiguas y verificar con `check_citations`. Un
agente externo **no** está obligado a cumplirlas: la verificación estricta solo la
garantiza nuestro `runAgent` (briefing diario).

No hay herramientas de escritura: las propuestas al Vault necesitan antes una tabla
de propuestas persistente.

## Seguridad

- `POST /mcp` exige `Authorization: Bearer <MCP_TOKEN>`; el token debe tener ≥ 32
  caracteres (p. ej. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- `GET /healthz` es público y no revela datos.
- Lo eliminado no se puede leer ni citar.
- Usar siempre HTTPS delante (el proveedor de hosting lo da).

## Ejecutar

```bash
DATABASE_URL=… MCP_TOKEN=… [OPENAI_API_KEY=…] [PORT=8787] npm run mcp
```

### Render (elegido)

`render.yaml` define un *Web Service* Node 22: `npm ci --include=dev`, `npm run mcp`,
health check `/healthz`, despliegue automático desde `main`.

1. Render → **New → Blueprint** → este repositorio.
2. Introducir los secretos que pide: `MCP_TOKEN`, `DATABASE_URL` y, opcional,
   `OPENAI_API_KEY` (sin ella la búsqueda es solo textual).
3. `DATABASE_URL`: cadena del **pooler** de Supabase (Settings → Database →
   Connection string). Si el arranque falla por el certificado SSL, revisarlo antes
   de desactivar la verificación.
4. URL para OpenAI: `https://<servicio>.onrender.com/mcp`.

El plan `free` se duerme tras inactividad y el primer acceso tarda; si el agente de
OpenAI agota el tiempo de espera, cambiar a `starter`.

## Conectarlo a la Agents API de OpenAI

1. Desplegar el servidor y obtener su URL pública `https://…/mcp`.
2. En la plataforma de OpenAI, guardar `MCP_TOKEN` en el **Vault**.
3. Crear el agente con una herramienta MCP remota apuntando a esa URL y usando el
   secreto del Vault como cabecera `Authorization: Bearer …`.
4. Entorno: **none** (las herramientas son consultas; no hace falta sandbox).

Ver la guía de Vaults y herramientas MCP de la Agents API en developers.openai.com;
la API está en beta y su configuración puede cambiar.

## Probado

`test/mcp.test.ts`: lista de herramientas, procedencia, verificación de citas,
memorias eliminadas, briefing, errores, autenticación y un cliente MCP real por
HTTP. Además se arrancó `npm run mcp` contra Postgres (PGlite por socket) y se
consultó con `curl`.

### Diagnóstico de conexión

El servidor escribe en los logs de Render una línea por petición a `/mcp`:
método, ruta, código de estado, duración, `Accept` y `User-Agent` (nunca la
cabecera `Authorization`). Si un cliente remoto falla, ese código indica la causa:
`401` → token/cabecera; `405` → método no soportado; ninguna línea → URL incorrecta
o el servicio estaba dormido (plan free: ~50 s de arranque). Los clientes que solo
envían `Accept: application/json` se aceptan (el SDK exigiría también
`text/event-stream` y respondería `406`).
