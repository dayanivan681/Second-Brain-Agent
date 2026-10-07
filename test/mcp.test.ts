import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryBriefingRepository } from "../src/briefing/repository.js";
import { runDailyBriefing } from "../src/briefing/routine.js";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { MemoryStore } from "../src/core/store.js";
import { createMcpHttpServer } from "../src/mcp/http.js";
import { createMcpServer, type McpDeps } from "../src/mcp/server.js";
import { entry } from "./helpers.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const NOTE = `---
domain: alfa
updated: 2026-10-01
---
## Objetivos
- Publicar la beta antes del 30 de noviembre
## Decisiones
- Usar pagos mensuales
`;
const TOKEN = "t".repeat(40);

async function deps(): Promise<McpDeps> {
  const store = new MemoryStore(new InMemoryRepository(), () => NOW);
  await store.importSource("alfa", extractDrafts("alfa.md", NOTE, entry({ id: "alfa", path: "alfa.md", sha256: sha256(NOTE), synthetic: false, capturedAt: "2026-10-06T00:00:00Z" })));
  const briefings = new InMemoryBriefingRepository();
  await runDailyBriefing({ repo: briefings, store, now: () => NOW, timeZone: "UTC" });
  return { store, now: () => NOW, briefings };
}

const parse = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as Record<string, unknown>;

describe("servidor MCP", () => {
  let client: Client;
  let d: McpDeps;

  beforeAll(async () => {
    d = await deps();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(d).connect(a);
    client = new Client({ name: "test", version: "1" });
    await client.connect(b);
  });

  it("expone solo herramientas de lectura", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_citations", "get_briefing", "get_memory", "list_domains", "memory_as_of", "search_memories"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getInstructions()).toContain("check_citations");
  });

  it("busca con procedencia y verifica citas", async () => {
    const { results } = parse(await client.callTool({ name: "search_memories", arguments: { query: "pagos" } })) as { results: Array<{ id: string; sources: unknown[]; freshness: string }> };
    expect(results[0]).toMatchObject({ freshness: "current", sources: [{ sourceId: "alfa", path: "alfa.md", anchor: "Decisiones" }] });
    const check = parse(await client.callTool({ name: "check_citations", arguments: { memoryIds: [results[0]!.id, "inventado"] } })) as { results: Array<{ valid: boolean }> };
    expect(check.results.map((r) => r.valid)).toEqual([true, false]);
  });

  it("las memorias eliminadas no se pueden leer ni citar", async () => {
    const m = (await d.store.search("beta"))[0]!;
    await d.store.delete(m.id, "prueba");
    expect(parse(await client.callTool({ name: "get_memory", arguments: { id: m.id } }))).toEqual({ error: "No existe o fue eliminada" });
    const check = parse(await client.callTool({ name: "check_citations", arguments: { memoryIds: [m.id] } })) as { results: Array<{ valid: boolean }> };
    expect(check.results[0]?.valid).toBe(false);
  });

  it("devuelve el briefing y reporta errores como isError", async () => {
    expect(parse(await client.callTool({ name: "get_briefing", arguments: {} }))).toMatchObject({ date: "2026-10-07" });
    const bad = await client.callTool({ name: "memory_as_of", arguments: { id: "x", date: "no" } });
    expect(bad.isError).toBe(true);
    expect((await client.callTool({ name: "propose_vault_change", arguments: {} })).isError).toBe(true);
  });
});

describe("transporte HTTP", () => {
  let url: URL;
  let server: ReturnType<typeof createMcpHttpServer>;

  beforeAll(async () => {
    server = createMcpHttpServer({ ...(await deps()), token: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("rechaza peticiones sin token o con token incorrecto", async () => {
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(url, { method: "POST", body: "{}", headers: { authorization: "Bearer otro" } })).status).toBe(401);
    expect((await fetch(new URL("/healthz", url))).status).toBe(200);
  });

  it("atiende un cliente MCP real con el token", async () => {
    const client = new Client({ name: "http-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
    const { domains } = parse(await client.callTool({ name: "list_domains", arguments: {} })) as { domains: Array<{ domain: string; active: number }> };
    expect(domains).toEqual([{ domain: "alfa", active: 2, latestSource: "2026-10-01" }]);
    await client.close();
  });

  it("exige un token largo", async () => {
    const d = await deps();
    expect(() => createMcpHttpServer({ ...d, token: "corto" })).toThrow("MCP_TOKEN");
  });
});
