// Envía una pregunta a una sesión de la Agents API de OpenAI y muestra la
// respuesta en vivo, incluidas las llamadas al MCP de memoria.
// Uso: npm run ask -- <session_id> "pregunta"
// Lee OPENAI_API_KEY del entorno o del archivo .env.
import { existsSync } from "node:fs";
import OpenAI from "openai";

if (existsSync(".env")) process.loadEnvFile(".env");
const [sessionId, ...words] = process.argv.slice(2);
const question = words.join(" ").trim();
if (!sessionId || !question || !process.env.OPENAI_API_KEY) {
  console.error('Uso: npm run ask -- <session_id> "pregunta"   (requiere OPENAI_API_KEY)');
  process.exit(1);
}

const client = new OpenAI();
// Abrir el stream antes de enviar para no perder eventos.
const stream = await client.beta.agents.sessions.events.stream(sessionId);
await client.beta.agents.sessions.events.create(sessionId, {
  events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: question }] }] }],
});

let started = false;
for await (const event of stream) {
  switch (event.type) {
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
