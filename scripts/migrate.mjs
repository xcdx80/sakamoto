import { neon } from "@neondatabase/serverless";
import { applyMigrations } from "./migrations.mjs";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Put it in .env.local.");
await applyMigrations(neon(process.env.DATABASE_URL));
console.log("Ordered database migrations applied.");
