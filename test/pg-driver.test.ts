import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import { MemoryStore } from "../src/core/store.js";
import { migrate } from "../src/db/migrate.js";
import { createPgClient } from "../src/db/pg-client.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import { entry, fakeClock } from "./helpers.js";

/**
 * Ejercita el driver de producción (`pg`) por el protocolo de red real,
 * contra PGlite expuesto como servidor Postgres local.
 */
const NOTE_V1 = "## Decisiones\n- Usar pagos mensuales\n- Posponer la app móvil\n";
const NOTE_V2 = "## Decisiones\n- Usar pagos mensuales\n";
const drafts = (content: string) => extractDrafts("alfa.md", content, entry({ id: "alfa", sha256: sha256(content) }));

describe("driver pg", () => {
  let server: PGLiteSocketServer;
  let client: ReturnType<typeof createPgClient>;

  beforeAll(async () => {
    const port = 40_000 + Math.floor(Math.random() * 20_000);
    server = new PGLiteSocketServer({ db: new PGlite(), port });
    await server.start();
    // PGlite atiende una conexión: el pool se limita a una.
    client = createPgClient(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1 });
    await migrate(client);
  });

  afterAll(async () => {
    await client?.end();
    await server?.stop();
  });

  it("aplica el contrato básico con el driver de producción", async () => {
    const pgStore = new MemoryStore(new PostgresMemoryRepository(client), fakeClock());
    const memStore = new MemoryStore(new InMemoryRepository(), fakeClock());
    for (const store of [pgStore, memStore]) {
      await store.importSource("alfa", drafts(NOTE_V1));
      await store.importSource("alfa", drafts(NOTE_V2));
    }
    const strip = (ms: Awaited<ReturnType<MemoryStore["all"]>>) => ms.map(({ id: _id, ...rest }) => rest).sort((a, b) => a.key.localeCompare(b.key));
    expect(strip(await pgStore.all({ includeInactive: true }))).toEqual(strip(await memStore.all({ includeInactive: true })));

    const restored = await MemoryStore.restore(await pgStore.export(), new InMemoryRepository());
    expect(await restored.all({ includeInactive: true })).toEqual(await pgStore.all({ includeInactive: true }));
  });

  it("revierte la transacción si la importación falla", async () => {
    const store = new MemoryStore(new PostgresMemoryRepository(client));
    const before = await store.all({ includeInactive: true });
    const bad = drafts("## Decisiones\n- Nueva\n").map((d) => ({ ...d, source: { ...d.source, sourceId: "otra" } }));
    await expect(store.importSource("alfa", [...drafts("## Decisiones\n- Otra nueva\n"), ...bad])).rejects.toThrow();
    expect(await store.all({ includeInactive: true })).toEqual(before);
  });
});
