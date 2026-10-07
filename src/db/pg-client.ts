import pg from "pg";
import type { SqlClient } from "./sql.js";

/**
 * Cliente para Supabase Postgres. Usar la cadena de conexión del pooler de
 * Supabase desde una variable de entorno (p. ej. DATABASE_URL), nunca del Vault.
 */
export function createPgClient(
  connectionString: string,
  options: Omit<pg.PoolConfig, "connectionString"> = {},
): SqlClient & { end(): Promise<void> } {
  const pool = new pg.Pool({ ...options, connectionString });

  function fromQueryable(q: pg.Pool | pg.PoolClient, inTransaction: boolean): SqlClient {
    return {
      async query(text, params) {
        return (await q.query(text, params as unknown[])).rows;
      },
      async exec(sql) {
        await q.query(sql);
      },
      async transaction(fn) {
        if (inTransaction) return fn(this);
        const client = await pool.connect();
        try {
          await client.query("begin");
          const result = await fn(fromQueryable(client, true));
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }

  return { ...fromQueryable(pool, false), end: () => pool.end() };
}
