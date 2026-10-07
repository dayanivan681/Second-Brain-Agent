import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/core/hash.js";
import { extractDrafts } from "../src/core/importer.js";
import { MemoryStore } from "../src/core/store.js";
import { migrate } from "../src/db/migrate.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import type { SqlClient } from "../src/db/sql.js";
import { entry } from "./helpers.js";
import { freshDatabase } from "./repositories.js";

const NOTE = "## Decisiones\n- Usar pagos mensuales\n";

describe("esquema Postgres", () => {
  let sql: SqlClient;
  let store: MemoryStore;
  beforeEach(async () => {
    sql = await freshDatabase();
    store = new MemoryStore(new PostgresMemoryRepository(sql));
    const e = entry({ id: "alfa", sha256: sha256(NOTE) });
    await store.importSource("alfa", extractDrafts("alfa.md", NOTE, e));
  });

  it("las migraciones son idempotentes", async () => {
    expect(await migrate(sql)).toEqual([]);
  });

  it("guarda fuentes y revisiones como filas relacionadas", async () => {
    const [m] = await store.all();
    await store.correct(m!.id, "Usar pagos anuales", "aclaración");
    const revisions = await sql.query<{ change: string; previous_statement: string | null }>(
      "select change, previous_statement from memory_revisions where memory_id = $1 order by seq",
      [m!.id],
    );
    expect(revisions).toEqual([
      { change: "create", previous_statement: null },
      { change: "correct", previous_statement: "Usar pagos mensuales" },
    ]);
    const [src] = await sql.query<{ source_id: string }>("select source_id from memory_sources where memory_id = $1", [m!.id]);
    expect(src?.source_id).toBe("alfa");
  });

  it("eliminar no deja texto en ninguna tabla", async () => {
    const [m] = await store.all();
    await store.correct(m!.id, "Texto corregido", "x");
    await store.delete(m!.id, "Petición del usuario");
    const dump = JSON.stringify([
      await sql.query("select * from memories"),
      await sql.query("select * from memory_sources"),
      await sql.query("select * from memory_revisions"),
    ]);
    expect(dump).not.toMatch(/pagos|corregido/i);
  });

  it("la base de datos rechaza lápidas con texto y valores no válidos", async () => {
    const [m] = await store.all();
    await expect(sql.query("update memories set status = 'deleted' where id = $1", [m!.id])).rejects.toThrow();
    await expect(sql.query("update memories set epistemic = 'opinion' where id = $1", [m!.id])).rejects.toThrow();
  });
});
