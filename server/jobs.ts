import { randomUUID } from "node:crypto";
import { pool, scoped } from "./db.js";
import { findings, redacted } from "./model.js";
import {
  openAIProvider,
  aiConfigured,
  validateClassification,
  type AnalysisProvider,
} from "./ai.js";
const controllers = new Map<string, AbortController>();
export function cancelProvider(job: string) {
  controllers.get(job)?.abort();
}
export async function runJob(provider: AnalysisProvider = openAIProvider) {
  const claimed = await pool.query(
    "UPDATE jobs SET status='running',progress=30,attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
  );
  const job = claimed.rows[0];
  if (!job) return false;
  let providerStarted = false;
  try {
    const payload = await scoped(job.org_id, async (db) => {
      const { rows: products } = await db.query(
        "SELECT data FROM products WHERE id=$1 AND org_id=$2",
        [job.product_id, job.org_id],
      );
      const { rows: records } = await db.query(
        "SELECT id,data FROM evidence_records WHERE product_id=$1 AND org_id=$2 ORDER BY created_at,id",
        [job.product_id, job.org_id],
      );
      const org = await db.query(
        "SELECT ai_consent FROM organizations WHERE id=$1",
        [job.org_id],
      );
      const used = await db.query(
        "SELECT count(*)::int AS count FROM usage_events WHERE org_id=$1 AND created_at>=date_trunc('month',now())",
        [job.org_id],
      );
      if (used.rows[0].count >= 1)
        throw Error(
          "Trial analysis allowance used. Existing findings and exports remain available.",
        );
      return {
        product: products[0].data,
        records: records.map((r) => ({ ...r.data, id: r.id })),
        ai: org.rows[0].ai_consent && records.length > 0,
      };
    });
    let groups: Record<string, string[]> | undefined;
    if (payload.ai) {
      if (!aiConfigured())
        throw Error(
          "AI configuration is unavailable. Disable AI consent to use rules.",
        );
      const changed = await scoped(job.org_id, (db) =>
        db.query(
          "UPDATE jobs SET provider_started_at=now(),retryable=false,progress=50 WHERE id=$1 AND org_id=$2 AND status='running' RETURNING id",
          [job.id, job.org_id],
        ),
      );
      if (!changed.rowCount) return true;
      providerStarted = true;
      const controller = new AbortController();
      controllers.set(job.id, controller);
      const classified = validateClassification(
        await provider.classify(
          payload.product,
          payload.records.map((r) => ({ ...r, text: redacted(r.text) })),
          controller.signal,
        ),
        payload.records,
      );
      groups = Object.fromEntries(
        classified.themes.map((t) => [t.topic, t.recordIDs]),
      );
    }
    const result = {
      engine: providerStarted
        ? "AI-inferred theme grouping; facts and citations validated by the server"
        : "Deterministic theme analysis — no AI provider",
      findings: findings(payload.product, payload.records, groups),
      recordCount: payload.records.length,
      sparse: payload.records.length < 3,
      pageOnly:
        payload.records.length < 3
          ? [
              "Review the placement of confirmed dimensions, materials, and care details. This is a page-only observation, not a customer finding.",
            ]
          : [],
      generatedAt: new Date().toISOString(),
    };
    await scoped(job.org_id, async (db) => {
      await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        job.org_id,
      ]);
      const usage = await db.query(
        "SELECT count(*)::int AS count FROM usage_events WHERE org_id=$1 AND created_at>=date_trunc('month',now())",
        [job.org_id],
      );
      if (usage.rows[0].count >= 1)
        throw Error(
          "Trial analysis allowance used. Existing findings and exports remain available.",
        );
      const updated = await db.query(
        "UPDATE jobs SET status='completed',progress=100,result=$1,completed_at=now() WHERE id=$2 AND org_id=$3 AND status='running' RETURNING id",
        [result, job.id, job.org_id],
      );
      if (updated.rowCount) {
        await db.query(
          "INSERT INTO usage_events(job_id,org_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [job.id, job.org_id],
        );
        await db.query(
          "INSERT INTO audit_events(id,org_id,action,target_id) VALUES($1,$2,$3,$4)",
          [randomUUID(), job.org_id, "analysis.completed", job.id],
        );
      }
    });
  } catch (e) {
    const message = providerStarted
      ? "AI failed or its result could not be verified. No app analysis allowance consumed. Automatic retry is blocked; review provider usage before starting a new job."
      : e instanceof Error &&
          (e.message.startsWith("Trial analysis") ||
            e.message.startsWith("AI configuration"))
        ? e.message
        : "Analysis failed. No allowance consumed. Retry this job.";
    await scoped(job.org_id, (db) =>
      db.query(
        "UPDATE jobs SET status='failed',error=$1,progress=0,retryable=$2 WHERE id=$3 AND org_id=$4 AND status='running'",
        [message, !providerStarted, job.id, job.org_id],
      ),
    );
  } finally {
    controllers.delete(job.id);
  }
  return true;
}
export function startWorker() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runJob();
    } catch {
      console.error("Analysis worker unavailable; queued jobs retained.");
    } finally {
      busy = false;
    }
  }, 750);
  return () => clearInterval(timer);
}
