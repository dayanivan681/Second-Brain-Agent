import { PGlite } from "@electric-sql/pglite";
import { InMemoryRepository } from "../src/core/in-memory-repository.js";
import type { MemoryRepository } from "../src/core/repository.js";
import { migrate } from "../src/db/migrate.js";
import { createPgliteClient } from "../src/db/pglite-client.js";
import { PostgresMemoryRepository } from "../src/db/postgres-repository.js";
import type { SqlClient } from "../src/db/sql.js";

// PGlite tarda segundos en arrancar: una base por archivo de test, una
// por "slot" (los tests de restauración necesitan dos repositorios a la vez).
const databases: Promise<SqlClient>[] = [];
let slot = 0;

async function database(index: number): Promise<SqlClient> {
  databases[index] ??= (async () => {
    const sql = createPgliteClient(new PGlite());
    await migrate(sql);
    return sql;
  })();
  return databases[index]!;
}

/** Base de datos limpia y migrada, compartida dentro del archivo de test. */
export async function freshDatabase(index = 0): Promise<SqlClient> {
  const sql = await database(index);
  await sql.exec("truncate memories cascade");
  return sql;
}

/** Cada adaptador debe pasar el mismo contrato. El primer repo de cada test usa el slot 0. */
export const REPOSITORIES: Array<[string, () => Promise<MemoryRepository>, () => void]> = [
  ["en memoria", async () => new InMemoryRepository(), () => {}],
  [
    "postgres (PGlite)",
    async () => new PostgresMemoryRepository(await freshDatabase(slot++)),
    () => {
      slot = 0;
    },
  ],
];
