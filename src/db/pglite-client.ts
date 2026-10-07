import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { SqlClient } from "./sql.js";

/** Postgres embebido (WASM) para tests y desarrollo sin servicios externos. */
export function createPgliteClient(db: PGlite): SqlClient {
  function wrap(q: PGlite | Transaction, inTransaction: boolean): SqlClient {
    return {
      async query(text, params) {
        return (await q.query(text, params)).rows as never;
      },
      async exec(sql) {
        await q.exec(sql);
      },
      async transaction(fn) {
        if (inTransaction) return fn(this);
        return db.transaction((tx) => fn(wrap(tx, true)));
      },
    };
  }
  return wrap(db, false);
}
