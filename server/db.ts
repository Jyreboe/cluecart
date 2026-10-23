import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://cluecart@127.0.0.1:5432/cluecart",
  max: 8,
});
export async function migrate() {
  for (const file of ["001_core.sql", "002_shopify.sql", "003_ai.sql"])
    await pool.query(
      await readFile(
        new URL("../db/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
}
export async function scoped<T>(
  org: string,
  fn: (db: pg.PoolClient) => Promise<T>,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.org_id',$1,true)", [org]);
    const value = await fn(db);
    await db.query("COMMIT");
    return value;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
if (process.argv[1]?.endsWith("/db.ts")) {
  await migrate();
  await pool.end();
  console.log("Database migrations applied.");
}
