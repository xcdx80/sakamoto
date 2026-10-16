import { readFileSync, readdirSync } from "node:fs";

/** One atomic, serialized migration transaction; a concurrent runner rechecks recorded versions under the lock. */
export async function applyMigrations(sql) {
  const files = readdirSync(new URL("../db/migrations/", import.meta.url))
    .filter((n) => /^\d{3}-[a-z0-9-]+\.sql$/.test(n))
    .sort();
  await sql.transaction([
    sql.query("select pg_advisory_xact_lock(72621001)"),
    sql.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())"),
    ...files.map((version) => {
      const source = readFileSync(new URL("../db/migrations/" + version, import.meta.url), "utf8");
      if (source.includes("$sakamoto_migration$")) throw new Error("Reserved migration delimiter");
      return sql.query(`do $migration_guard$ begin
        if not exists(select 1 from schema_migrations where version='${version}') then
          execute $sakamoto_migration$${source}$sakamoto_migration$;
          insert into schema_migrations(version) values('${version}');
        end if;
      end $migration_guard$`);
    }),
  ]);
}
