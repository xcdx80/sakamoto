import { Pool } from "pg";
import { configureDatabase } from "../lib/db";
import { applyMigrations } from "../scripts/migrations.mjs";

// Integration fixtures require an explicit isolated socket. Never fall back to DATABASE_URL/.env.local.
const host = process.env.SAKAMOTO_TEST_PG_SOCKET;
if (!host || !host.startsWith("/tmp/sakamoto-")) throw new Error("Set SAKAMOTO_TEST_PG_SOCKET to an owned isolated /tmp/sakamoto-* PostgreSQL socket.");
const schema = "sakamoto_test_" + process.pid + "_" + crypto.randomUUID().replaceAll("-", "");
export const pool = new Pool({ host, user: "sakamoto_test", database: process.env.SAKAMOTO_TEST_PG_DATABASE ?? "postgres", options: `-c search_path=${schema},public`, max: 5 });
const migrationAdapter = {
  query(text: string, params: unknown[] = []) {
    return {
      text,
      params,
      then(resolve: any, reject: any) {
        return pool
          .query(text, params)
          .then((r) => r.rows)
          .then(resolve, reject);
      },
    };
  },
  async transaction(queries: { text: string; params: unknown[] }[]) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      for (const q of queries) await c.query(q.text, q.params);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  },
};
export async function setupPostgres() {
  await pool.query(`create schema ${schema}`);
  await applyMigrations(migrationAdapter);
  await applyMigrations(migrationAdapter);
  const connection = await pool.connect();
  try {
    await connection.query("begin");
    await connection.query("select pg_advisory_xact_lock(72621003)");
    await connection.query("create extension if not exists vector with schema public");
    await connection.query("commit");
  } catch (e) {
    await connection.query("rollback");
    throw e;
  } finally {
    connection.release();
  }
}
configureDatabase({ query: async (text, params) => (await pool.query(text, params)).rows });
