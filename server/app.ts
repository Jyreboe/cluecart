import express from "express";
import { aiRoutes } from "./ai.js";
import { cancelProvider } from "./jobs.js";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { pool, scoped } from "./db.js";
import { authRoutes, authenticated, editor, owner } from "./auth.js";
import {
  uuid,
  productSchema,
  recordSchema,
  draftSchema,
  textOnly,
  redacted,
  hash,
  findings,
  makeDraft,
  safeHTML,
} from "./model.js";
import { shopifyWebhooks, shopifyOAuth, shopifyRoutes } from "./shopify.js";
import { publicPage, extractProduct } from "./url-import.js";
class CapacityError extends Error {}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  shopifyWebhooks(app);
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const expected = process.env.PUBLIC_APP_URL;
      const allowed = expected
        ? new URL(expected).origin
        : `${req.protocol}://${req.get("host")}`;
      if (origin && origin !== allowed) {
        res.status(403).json({ error: "Cross-origin write rejected." });
        return;
      }
      if (req.get("sec-fetch-site") === "cross-site") {
        res.status(403).json({ error: "Cross-site write rejected." });
        return;
      }
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  });
  authRoutes(app);
  shopifyOAuth(app);
  app.use("/api", authenticated);
  shopifyRoutes(app);
  aiRoutes(app);
  app.get("/api/me", async (req, res) => {
    const id = req.identity!;
    const org = await pool.query(
      "SELECT id,name,category,tone,store_url FROM organizations WHERE id=$1",
      [id.org],
    );
    const usage = await pool.query(
      "SELECT count(*)::int AS used FROM usage_events WHERE org_id=$1 AND created_at>=date_trunc('month',now())",
      [id.org],
    );
    res.json({
      email: id.email,
      role: id.role,
      organization: org.rows[0],
      usage: {
        analyses: usage.rows[0].used,
        limit: 1,
        evidenceLimit: 100,
        plan: "Trial",
        resetAt: new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth() + 1,
            1,
          ),
        ).toISOString(),
      },
      connections: { shopify: false, ai: false, storage: false },
    });
  });
  app.patch("/api/organization", editor, async (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(150),
        category: z.enum(["Lighting", "Home décor"]),
        tone: z.string().min(1).max(100),
        storeURL: z
          .union([
            z
              .string()
              .url()
              .refine((v) => {
                try {
                  return new URL(v).protocol === "https:";
                } catch {
                  return false;
                }
              }),
            z.literal(""),
          ])
          .default(""),
      })
      .parse(req.body);
    await pool.query(
      "UPDATE organizations SET name=$1,category=$2,tone=$3,store_url=$4 WHERE id=$5",
      [data.name, data.category, data.tone, data.storeURL, req.identity!.org],
    );
    res.json({ ok: true });
  });
  app.get("/api/products", async (req, res) => {
    const result = await scoped(req.identity!.org, (db) =>
      db.query(
        "SELECT p.id,p.data,p.created_at,(SELECT count(*)::int FROM evidence_records e WHERE e.product_id=p.id AND e.org_id=p.org_id) AS evidence_count FROM products p WHERE org_id=$1 ORDER BY created_at DESC",
        [req.identity!.org],
      ),
    );
    res.json(result.rows);
  });
  app.post("/api/products", editor, async (req, res) => {
    const parsed = productSchema.parse(req.body);
    const data = {
      ...parsed,
      shopify: undefined,
      description: textOnly(parsed.description),
      policies: textOnly(parsed.policies),
      importedAt: new Date().toISOString(),
      facts: parsed.facts.map((f) => ({
        ...f,
        value: textOnly(f.value),
        confirmedAt: f.confirmed ? new Date().toISOString() : null,
      })),
    };
    const id = randomUUID();
    await scoped(req.identity!.org, async (db) => {
      await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.identity!.org,
      ]);
      const count = await db.query(
        "SELECT count(*)::int AS count FROM products WHERE org_id=$1",
        [req.identity!.org],
      );
      if (count.rows[0].count >= 10) {
        throw new ApiError(409, "Development product limit reached.");
      }
      await db.query("INSERT INTO products(id,org_id,data) VALUES($1,$2,$3)", [
        id,
        req.identity!.org,
        data,
      ]);
    });
    res.status(201).json({ id, data });
  });
  app.post(
    "/api/import-url",
    editor,
    rateLimit({ windowMs: 60000, limit: 5 }),
    async (req, res) => {
      const { url } = z
        .object({ url: z.string().url().max(2048) })
        .parse(req.body);
      try {
        const page = await publicPage(url);
        res.json({
          extracted: extractProduct(page.html, page.url),
          reviewRequired: true,
        });
      } catch (e) {
        res.status(422).json({
          error:
            e instanceof Error ? e.message : "Public page import unavailable.",
        });
      }
    },
  );
  // All nested endpoints resolve a tenant-scoped product before reading or changing child data.
  app.use("/api/products/:productId", async (req, res, next) => {
    const id = uuid.parse(req.params.productId);
    const result = await scoped(req.identity!.org, (db) =>
      db.query("SELECT data FROM products WHERE id=$1 AND org_id=$2", [
        id,
        req.identity!.org,
      ]),
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    res.locals.product = result.rows[0].data;
    res.locals.productId = id;
    next();
  });
  app.get("/api/products/:productId", async (req, res) => {
    const org = req.identity!.org,
      id = res.locals.productId;
    await scoped(org, async (db) => {
      const records = await db.query(
        "SELECT id,data FROM evidence_records WHERE product_id=$1 AND org_id=$2 ORDER BY created_at,id",
        [id, org],
      );
      const jobs = await db.query(
        "SELECT * FROM jobs WHERE product_id=$1 AND org_id=$2 ORDER BY created_at DESC",
        [id, org],
      );
      const drafts = await db.query(
        "SELECT * FROM drafts WHERE product_id=$1 AND org_id=$2 ORDER BY updated_at DESC",
        [id, org],
      );
      const approvals = await db.query(
        "SELECT id,snapshot,approved_at FROM approvals WHERE product_id=$1 AND org_id=$2 ORDER BY approved_at DESC",
        [id, org],
      );
      const decisions = await db.query(
        "SELECT id,snapshot,created_at FROM fact_decisions WHERE product_id=$1 AND org_id=$2 ORDER BY created_at DESC",
        [id, org],
      );
      const outcomes = await db.query(
        "SELECT id,data,created_at FROM outcome_observations WHERE product_id=$1 AND org_id=$2 ORDER BY created_at DESC",
        [id, org],
      );
      res.json({
        id,
        product: res.locals.product,
        records: records.rows.map((r) => ({ id: r.id, ...r.data })),
        jobs: jobs.rows,
        drafts: drafts.rows,
        approvals: approvals.rows,
        outcomes: outcomes.rows,
        factDecisions: decisions.rows,
      });
    });
  });
  app.patch("/api/products/:productId/facts", editor, async (req, res) => {
    const product = productSchema.parse({
      ...res.locals.product,
      facts: req.body.facts,
    });
    product.facts = product.facts.map((f) => ({
      ...f,
      confirmedAt: f.confirmed ? new Date().toISOString() : null,
    }));
    await scoped(req.identity!.org, async (db) => {
      await db.query("UPDATE products SET data=$1 WHERE id=$2 AND org_id=$3", [
        product,
        res.locals.productId,
        req.identity!.org,
      ]);
      await db.query(
        "INSERT INTO fact_decisions(id,org_id,product_id,user_id,snapshot) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          req.identity!.org,
          res.locals.productId,
          req.identity!.user,
          JSON.stringify(product.facts),
        ],
      );
      await db.query("INSERT INTO audit_events VALUES($1,$2,$3,$4,$5,now())", [
        randomUUID(),
        req.identity!.org,
        req.identity!.user,
        "facts.confirmed",
        res.locals.productId,
      ]);
    });
    res.json(product);
  });
  app.post("/api/products/:productId/evidence", editor, async (req, res) => {
    const { records } = z
      .object({ records: z.array(recordSchema).min(1).max(100) })
      .parse(req.body);
    const org = req.identity!.org,
      id = res.locals.productId;
    let imported = 0,
      duplicates = 0;
    await scoped(org, async (db) => {
      await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const count = await db.query(
        "SELECT count(*)::int AS count FROM evidence_records WHERE org_id=$1",
        [org],
      );
      const product = res.locals.product;
      for (const record of records) {
        if (record.product && ![id, product.title].includes(record.product)) {
          throw new ApiError(
            422,
            "Mixed-product records must be assigned or excluded before import.",
          );
        }
      }
      for (const r of records) {
        if (!textOnly(r.text).trim()) continue;
        const data = {
          ...r,
          text: textOnly(r.text),
          redacted: redacted(textOnly(r.text)),
          provenance: r.link
            ? "Merchant-supplied source link; not independently verified"
            : "Pasted or uploaded; no verifiable external source",
          importedAt: new Date().toISOString(),
        };
        const result = await db.query(
          "INSERT INTO evidence_records(id,org_id,product_id,source_id,content_hash,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
          [
            randomUUID(),
            org,
            id,
            r.sourceID ? r.type + ":" + r.sourceID : null,
            hash(textOnly(r.text)),
            data,
          ],
        );
        if (result.rowCount) imported++;
        else duplicates++;
        if (count.rows[0].count + imported > 100)
          throw new CapacityError(
            "Trial allows up to 100 stored evidence records.",
          );
      }
      if (imported > 0)
        await db.query(
          "UPDATE organizations SET ai_consent=false,evidence_revision=evidence_revision+1 WHERE id=$1",
          [org],
        );
    });
    res.status(201).json({ imported, duplicates });
  });
  app.post("/api/products/:productId/analyses", editor, async (req, res) => {
    const data = z.object({ requestKey: uuid }).parse(req.body);
    const org = req.identity!.org;
    const job = await scoped(org, async (db) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO jobs(id,org_id,product_id,request_key) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,request_key) DO NOTHING",
        [id, org, res.locals.productId, data.requestKey],
      );
      const result = await db.query(
        "SELECT * FROM jobs WHERE org_id=$1 AND request_key=$2",
        [org, data.requestKey],
      );
      if (result.rows[0].product_id !== res.locals.productId)
        throw new ApiError(
          409,
          "Request key already belongs to a different product.",
        );
      return result.rows[0];
    });
    res.status(202).json(job);
  });
  app.post(
    "/api/products/:productId/jobs/:jobId/:action",
    editor,
    async (req, res) => {
      const job = uuid.parse(req.params.jobId),
        action = z.enum(["cancel", "retry"]).parse(req.params.action);
      const result = await scoped(req.identity!.org, (db) =>
        db.query(
          action === "cancel"
            ? "UPDATE jobs SET status='cancelled',error=null WHERE id=$1 AND org_id=$2 AND product_id=$3 AND status IN ('queued','running') RETURNING id"
            : "UPDATE jobs SET status='queued',error=null,progress=0 WHERE id=$1 AND org_id=$2 AND product_id=$3 AND status='failed' AND attempts<3 AND retryable=true RETURNING id",
          [job, req.identity!.org, res.locals.productId],
        ),
      );
      if (!result.rowCount) {
        res.status(409).json({ error: "Job cannot make that transition." });
        return;
      }
      if (action === "cancel") cancelProvider(job);
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/products/:productId/draft-preview",
    editor,
    async (req, res) => {
      const { theme, kind, tone, variant } = z
        .object({
          theme: z.string().max(50),
          tone: z.string().max(100).default(""),
          variant: z.string().max(100).default(""),
          kind: z.enum([
            "Clarification",
            "Short description",
            "Benefit bullets",
            "FAQ",
            "Image brief",
          ]),
        })
        .parse(req.body);
      res.json(makeDraft(res.locals.product, theme, kind, tone, variant));
    },
  );
  app.post("/api/products/:productId/drafts", editor, async (req, res) => {
    const data = draftSchema.parse(req.body);
    const product = res.locals.product;
    if (
      data.factIDs.some(
        (id) => !product.facts.some((f: any) => f.id === id && f.confirmed),
      )
    ) {
      res
        .status(422)
        .json({ error: "Draft refers to an unconfirmed or unknown fact." });
      return;
    }
    const id = randomUUID();
    await scoped(req.identity!.org, (db) =>
      db.query(
        "INSERT INTO drafts(id,org_id,product_id,data) VALUES($1,$2,$3,$4)",
        [id, req.identity!.org, res.locals.productId, data],
      ),
    );
    res.status(201).json({ id, data });
  });
  app.post("/api/products/:productId/approve", owner, async (req, res) => {
    const { draftID } = z.object({ draftID: uuid }).parse(req.body);
    const org = req.identity!.org,
      id = res.locals.productId;
    const approved = await scoped(org, async (db) => {
      await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        org,
      ]);
      const existing = await db.query(
        "SELECT id,snapshot FROM approvals WHERE org_id=$1 AND product_id=$2 AND snapshot->>'draftID'=$3",
        [org, id, draftID],
      );
      if (existing.rows[0]) return existing.rows[0];
      const { rows } = await db.query(
        "SELECT data FROM drafts WHERE id=$1 AND product_id=$2 AND org_id=$3",
        [draftID, id, org],
      );
      if (!rows[0]) {
        throw new ApiError(404, "Draft not found.");
      }
      const d = rows[0].data;
      const fresh = await db.query(
        "SELECT data FROM products WHERE id=$1 AND org_id=$2",
        [id, org],
      );
      const product = fresh.rows[0].data;
      const facts = product.facts.filter((f: any) => d.factIDs.includes(f.id));
      if (
        !d.merchantVerified ||
        d.verificationNote.trim().length < 12 ||
        !facts.length ||
        facts.length !== d.factIDs.length ||
        facts.some((f: any) => !f.confirmed) ||
        d.rejected
      ) {
        throw new ApiError(
          422,
          "Confirm every claim, cite confirmed facts, and record a verification note before approval.",
        );
      }
      const variants = new Set(
        facts.map((f: any) => f.variant).filter(Boolean),
      );
      if (variants.size > 1) {
        throw new ApiError(
          422,
          "Keep incompatible variant facts in separate drafts.",
        );
      }
      const evidence = await db.query(
        "SELECT id,data FROM evidence_records WHERE product_id=$1 AND org_id=$2",
        [id, org],
      );
      const records = evidence.rows.map((r) => ({ ...r.data, id: r.id }));
      if (
        d.recordIDs.some((rid: string) => !records.some((r) => r.id === rid))
      ) {
        throw new ApiError(422, "A cited source is no longer available.");
      }
      const conflicts = findings(product, records).filter(
        (f) =>
          f.id === "power" &&
          f.verification &&
          f.confirmedFacts.some((fid) => d.factIDs.includes(fid)),
      );
      if (
        conflicts.length &&
        facts.some(
          (f: any) => f.topic === "power" && !f.verificationNote?.trim(),
        )
      ) {
        throw new ApiError(
          422,
          "Resolve the battery specification conflict with a fact verification note.",
        );
      }
      const previous = await db.query(
        "SELECT snapshot FROM approvals WHERE product_id=$1 AND org_id=$2 ORDER BY approved_at DESC LIMIT 1",
        [id, org],
      );
      const snapshot = {
        product: product.title,
        productID: id,
        evidence: records,
        confirmedFacts: facts,
        previous: previous.rows[0]?.snapshot.revised || product.description,
        revised: d.text,
        merchantNote: d.verificationNote,
        kind: d.kind,
        tone: d.tone,
        draftID,
        targetField:
          d.kind === "Image brief"
            ? "Image recommendation brief"
            : "descriptionHtml",
        publicationStatus: "Export only — not published",
        rollbackStatus: "Not applicable; no external write",
        approvedBy: req.identity!.email,
      };
      const approval = randomUUID();
      await db.query(
        "INSERT INTO approvals(id,org_id,product_id,user_id,snapshot) VALUES($1,$2,$3,$4,$5)",
        [approval, org, id, req.identity!.user, snapshot],
      );
      await db.query("INSERT INTO audit_events VALUES($1,$2,$3,$4,$5,now())", [
        randomUUID(),
        org,
        req.identity!.user,
        "draft.approved",
        approval,
      ]);
      return { id: approval, snapshot };
    });
    res.status(201).json(approved);
  });
  app.get(
    "/api/products/:productId/approvals/:approvalId/export",
    async (req, res) => {
      const result = await scoped(req.identity!.org, (db) =>
        db.query(
          "SELECT snapshot FROM approvals WHERE id=$1 AND org_id=$2 AND product_id=$3",
          [
            uuid.parse(req.params.approvalId),
            req.identity!.org,
            res.locals.productId,
          ],
        ),
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: "Approval not found." });
        return;
      }
      res
        .type("html")
        .attachment("cluecart-approved-description.html")
        .send(safeHTML(result.rows[0].snapshot.revised));
    },
  );
  app.post("/api/products/:productId/outcomes", editor, async (req, res) => {
    const period = z
      .object({
        start: z.string().date(),
        end: z.string().date(),
        numerator: z.number().int().nonnegative(),
        denominator: z.number().int().positive(),
      })
      .refine((p) => p.start <= p.end, "Date range is reversed");
    const data = z
      .object({
        source: z.string().min(1).max(500),
        metric: z.string().min(1).max(500),
        timezone: z
          .string()
          .max(100)
          .refine((s) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: s });
              return true;
            } catch {
              return false;
            }
          }, "Use an IANA timezone"),
        context: z.string().max(4000),
        before: period,
        after: period,
      })
      .parse(req.body);
    const id = randomUUID();
    await scoped(req.identity!.org, (db) =>
      db.query(
        "INSERT INTO outcome_observations(id,org_id,product_id,data) VALUES($1,$2,$3,$4)",
        [
          id,
          req.identity!.org,
          res.locals.productId,
          { ...data, label: "Observational comparison — not causal proof" },
        ],
      ),
    );
    res.status(201).json({ id });
  });
  app.get("/api/export", async (req, res) => {
    await scoped(req.identity!.org, async (db) => {
      const tables = [
        "products",
        "evidence_records",
        "jobs",
        "drafts",
        "approvals",
        "outcome_observations",
        "fact_decisions",
        "publications",
        "privacy_tasks",
        "audit_events",
      ];
      const output: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        organization: req.identity!.org,
      };
      for (const table of tables)
        output[table] = (
          await db.query(`SELECT * FROM ${table} WHERE org_id=$1`, [
            req.identity!.org,
          ])
        ).rows;
      res.attachment("cluecart-workspace.json").json(output);
    });
  });
  app.delete("/api/account", owner, async (req, res) => {
    z.object({ confirmation: z.literal("DELETE MY WORKSPACE") }).parse(
      req.body,
    );
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "DELETE FROM shop_webhook_receipts WHERE shop IN (SELECT shop FROM shop_connections WHERE org_id=$1)",
        [req.identity!.org],
      );
      await db.query("DELETE FROM organizations WHERE id=$1", [
        req.identity!.org,
      ]);
      await db.query("DELETE FROM users WHERE id=$1", [req.identity!.user]);
      await db.query("COMMIT");
      res.clearCookie("cluecart_session");
      res.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err instanceof CapacityError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof ZodError) {
        res.status(400).json({
          error: err.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        });
        return;
      }
      if (err.type === "entity.too.large") {
        res.status(413).json({ error: "Upload exceeds the 2 MB limit." });
        return;
      }
      if (err.type === "entity.parse.failed") {
        res.status(400).json({ error: "Invalid JSON body." });
        return;
      }
      console.error("API request failed:", err.code || err.name || "internal");
      res
        .status(500)
        .json({ error: "The operation could not complete. Please retry." });
    },
  );
  return app;
}
