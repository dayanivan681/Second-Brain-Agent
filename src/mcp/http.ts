import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, type McpDeps } from "./server.js";

const MIN_TOKEN_LENGTH = 32;

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Endpoint MCP (Streamable HTTP, sin estado) en POST /mcp, protegido con un
 * token Bearer. Pensado para conectarlo como servidor MCP remoto de un agente
 * (p. ej. la Agents API de OpenAI, guardando el token en su Vault).
 */
export function createMcpHttpServer(deps: McpDeps & { token: string; log?: (line: string) => void }): HttpServer {
  if (!deps.token || deps.token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`MCP_TOKEN debe tener al menos ${MIN_TOKEN_LENGTH} caracteres`);
  }
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    // Una línea por petición (sin cabeceras de autenticación) para diagnosticar clientes remotos.
    res.on("finish", () => {
      if (req.url === "/healthz") return;
      deps.log?.(`${req.method} ${req.url} → ${res.statusCode} ${Date.now() - started}ms accept="${req.headers.accept ?? ""}" ua="${req.headers["user-agent"] ?? ""}"`);
    });
    void handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "error" }));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (!authorized(req, deps.token)) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end('{"error":"unauthorized"}');
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    // El SDK exige "application/json, text/event-stream"; algunos clientes solo envían
    // uno de los dos. Como respondemos siempre JSON, aceptamos ambos casos.
    const accept = req.headers.accept ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      const value = "application/json, text/event-stream";
      req.headers.accept = value;
      const raw: string[] = [];
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
        const [name, v] = [req.rawHeaders[i] ?? "", req.rawHeaders[i + 1] ?? ""];
        if (name.toLowerCase() !== "accept") raw.push(name, v);
      }
      req.rawHeaders.splice(0, req.rawHeaders.length, ...raw, "Accept", value);
    }
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }
}
