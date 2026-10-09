// Envía una pregunta a una sesión de la Agents API de OpenAI y muestra la
// respuesta en vivo, incluidas las llamadas al MCP de memoria.
// Uso:
//   npm run ask -- <agent_id> "pregunta"    crea una sesión nueva y pregunta
//   npm run ask -- <session_id> "pregunta"  sigue una sesión creada con esta misma clave
// La Agents API solo acepta mensajes con la clave que creó la sesión, así que las
// sesiones iniciadas desde el panel no sirven aquí. Lee OPENAI_API_KEY del entorno o de .env.
import { existsSync } from "node:fs";
import OpenAI from "openai";

if (existsSync(".env")) process.loadEnvFile(".env");
const [target, ...words] = process.argv.slice(2);
const question = words.join(" ").trim();
if (!target || !question || !process.env.OPENAI_API_KEY) {
  console.error('Uso: npm run ask -- <agent_id|session_id> "pregunta"   (requiere OPENAI_API_KEY)');
  process.exit(1);
}

const client = new OpenAI();
const stream = target.startsWith("agent_") ? await newSession(target) : await continueSession(target);

async function newSession(agentId: string) {
  // Los vaults guardan el token del MCP; la sesión debe tenerlos adjuntos.
  const vaultIds: string[] = [];
  for await (const vault of client.beta.agents.vaults.list()) vaultIds.push(vault.id);
  return client.beta.agents.sessions.create({
    agent_id: agentId,
    // El MCP se conecta desde la red del servicio: no hace falta un contenedor.
    environment: { type: "none" },
    vault_ids: vaultIds,
    input: question,
    stream: true,
  });
}

async function continueSession(sessionId: string) {
  // Abrir el stream antes de enviar para no perder eventos.
  const events = await client.beta.agents.sessions.events.stream(sessionId);
  await client.beta.agents.sessions.events.create(sessionId, {
    events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: question }] }] }],
  });
  return events;
}

let started = false;
for await (const event of stream) {
  switch (event.type) {
    case "agent.session.created":
      console.log(`[sesión ${event.session.id} — úsala para seguir la conversación]`);
      break;
    case "agent.session.turn.created":
      started = true;
      break;
    case "agent.session.turn.output_text.delta":
      process.stdout.write(event.delta);
      break;
    case "agent.session.turn.item.done":
      if (event.item.type === "mcp_call") {
        const ok = event.item.error ? `ERROR ${JSON.stringify(event.item.error)}` : "ok";
        console.log(`\n[MCP ${event.item.name}(${JSON.stringify(event.item.arguments)}) → ${ok}]`);
      }
      break;
    case "agent.session.turn.failed":
    case "agent.session.failed":
    case "agent.session.environment.failed":
      console.error(`\n[${event.type}] ${JSON.stringify(event)}`);
      process.exit(1);
    case "agent.session.idle":
      if (started) {
        console.log("\n[fin]");
        process.exit(0);
      }
      break;
  }
}
