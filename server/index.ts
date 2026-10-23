import "dotenv/config";
import { createApp } from "./app.js";
import { migrate, pool } from "./db.js";
import { startWorker } from "./jobs.js";
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.DATABASE_URL ||
    !process.env.OIDC_ISSUER ||
    !process.env.OIDC_CLIENT_ID ||
    !process.env.PUBLIC_APP_URL)
)
  throw Error(
    "Production requires managed identity and explicit database/application configuration.",
  );
if (
  process.env.NODE_ENV === "production" &&
  new URL(process.env.PUBLIC_APP_URL!).protocol !== "https:"
)
  throw Error("Production requires an HTTPS public application URL.");
await migrate();
await pool.query(
  "UPDATE jobs SET status='queued',progress=0 WHERE status='running' AND attempts<3 AND provider_started_at IS NULL",
);
await pool.query(
  "UPDATE jobs SET status='failed',retryable=false,error='Provider outcome unknown after restart. Automatic retry blocked; check provider usage.' WHERE status='running' AND provider_started_at IS NOT NULL",
);
await pool.query(
  "UPDATE jobs SET status='failed',error='Retry limit reached. No allowance consumed.' WHERE status='running' AND attempts>=3",
);
const stop = startWorker();
const server = createApp().listen(
  Number(process.env.API_PORT || 3001),
  "127.0.0.1",
  () => console.log("Cluecart API ready."),
);
async function shutdown() {
  stop();
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
