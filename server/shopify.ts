import express, { type Express } from "express";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { pool, scoped } from "./db.js";
import { authenticated, owner } from "./auth.js";
import { productSchema, safeHTML, uuid } from "./model.js";
export const shopSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
export const snapshotDigest = (value: any) => digest(canonical(value));
export const publicationReview = (s: any) =>
  snapshotDigest({
    before: s.before,
    proposedHtml: s.proposedHtml,
    targetField: s.targetField,
    preparedAt: s.preparedAt,
  });

const remoteID = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/);
const version = () => process.env.SHOPIFY_API_VERSION || "2026-10";
export const shopifyConfigured = () =>
  !!(
    process.env.SHOPIFY_CLIENT_ID &&
    process.env.SHOPIFY_CLIENT_SECRET &&
    process.env.TOKEN_ENCRYPTION_KEY &&
    process.env.PUBLIC_APP_URL
  );
function key() {
  const k = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "base64");
  if (k.length !== 32)
    throw Error("A raw 32-byte token encryption key is required.");
  return k;
}
export function seal(value: unknown, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function unseal(value: string, context: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"),
  );
}
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function verifyOAuth(params: Record<string, string>, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(params.hmac || "")) return false;
  const message = Object.entries(params)
    .filter(([k]) => k !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + "=" + v)
    .join("&");
  return equal(
    createHmac("sha256", secret).update(message).digest("hex"),
    params.hmac,
  );
}
export function verifyWebhook(body: Buffer, signature: string, secret: string) {
  return equal(
    createHmac("sha256", secret).update(body).digest("base64"),
    signature,
  );
}
async function fetchJSON(url: string, options: RequestInit) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Error(
      "Shopify rejected the request; reconnect or review permissions.",
    );
  return response.json();
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
async function access(org: string, write = false) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query(
      "SELECT * FROM shop_connections WHERE org_id=$1 AND revoked=false FOR UPDATE",
      [org],
    );
    const c = rows[0];
    if (!c?.encrypted_tokens) throw Error("Connect Shopify first.");
    if (write && !c.scopes.split(",").includes("write_products"))
      throw Error("Approve Shopify product-write permission first.");
    let tokens = unseal(c.encrypted_tokens, org + "|" + c.shop);
    if (Date.now() >= tokens.expiresAt - 60000) {
      const refreshed = tokenSchema.parse(
        await fetchJSON(`https://${c.shop}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.SHOPIFY_CLIENT_ID!,
            client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
          }),
        }),
      );
      tokens = {
        ...refreshed,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
      };
      await db.query(
        "UPDATE shop_connections SET encrypted_tokens=$1 WHERE org_id=$2",
        [seal(tokens, org + "|" + c.shop), org],
      );
    }
    await db.query("COMMIT");
    return { shop: c.shop, token: tokens.access_token as string };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
async function graph(
  org: string,
  query: string,
  variables: unknown,
  write = false,
) {
  if (!/^20\d{2}-(01|04|07|10)$/.test(version()))
    throw Error("Configure a supported stable Shopify API version.");
  const c = await access(org, write);
  const result = await fetchJSON(
    `https://${c.shop}/admin/api/${version()}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": c.token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (result.errors?.length)
    throw Error(
      "Shopify GraphQL request failed. No automatic retry was attempted.",
    );
  return { shop: c.shop, data: result.data };
}
export type RemoteProduct = {
  id: string;
  title: string;
  descriptionHtml: string;
  updatedAt: string;
};
export interface StoreAdapter {
  read(org: string, id: string): Promise<RemoteProduct>;
  write(org: string, id: string, html: string): Promise<RemoteProduct>;
}
export const shopifyAdapter: StoreAdapter = {
  async read(org, id) {
    const r = await graph(
      org,
      "query Product($id:ID!){ product(id:$id){id title descriptionHtml updatedAt}}",
      { id },
    );
    if (!r.data.product) throw Error("Remote product was not found.");
    return r.data.product;
  },
  async write(org, id, html) {
    const r = await graph(
      org,
      "mutation Description($product:ProductUpdateInput!){ productUpdate(product:$product){product{id title descriptionHtml updatedAt} userErrors{field message}}}",
      { product: { id, descriptionHtml: html } },
      true,
    );
    if (
      r.data.productUpdate.userErrors?.length ||
      !r.data.productUpdate.product
    )
      throw Error("Shopify did not confirm the description update.");
    return r.data.productUpdate.product;
  },
};
export function factsStillConfirmed(current: any[], approved: any[]) {
  return (
    approved.length > 0 &&
    approved.every((a) =>
      current.some(
        (c) =>
          c.id === a.id &&
          c.confirmed &&
          c.value === a.value &&
          c.variant === a.variant,
      ),
    )
  );
}
export function remoteDigest(p: RemoteProduct) {
  return digest(JSON.stringify([p.id, p.descriptionHtml, p.updatedAt]));
}
// This lock serializes this application's writes. Shopify does not expose a
// product-description compare-and-set; an external edit in the final read/write
// window cannot be eliminated. Read immediately before write, and never retry an
// ambiguous mutation automatically.
export async function executePublication(
  org: string,
  id: string,
  action: "publish" | "rollback" | "reconcile",
  adapter: StoreAdapter = shopifyAdapter,
  actor?: string,
) {
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext($1))", [org]);
    const { rows } = await scoped(org, (db) =>
      db.query("SELECT * FROM publications WHERE id=$1 AND org_id=$2", [
        id,
        org,
      ]),
    );
    const p = rows[0];
    if (!p) throw Error("Publication not found.");
    const s = p.snapshot;
    if (action === "publish" && p.status === "published") return p;
    if (action === "rollback" && p.status === "rolled_back") return p;
    const current = await adapter.read(org, p.remote_id);
    async function update(status: string, extra: Record<string, unknown> = {}) {
      const next = { ...s, ...extra };
      const result = await scoped(org, async (db) => {
        const updated = await db.query(
          "UPDATE publications SET status=$1,snapshot=$2,updated_at=now() WHERE id=$3 AND org_id=$4 RETURNING *",
          [status, next, id, org],
        );
        await db.query(
          "INSERT INTO audit_events(id,org_id,user_id,action,target_id) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), org, actor || null, "publication." + status, id],
        );
        return updated;
      });
      return result.rows[0];
    }
    if (action === "publish") {
      const source = await scoped(org, (db) =>
        db.query(
          "SELECT a.snapshot,p.data FROM approvals a JOIN products p ON a.product_id=p.id AND a.org_id=p.org_id WHERE a.id=$1 AND a.org_id=$2",
          [p.approval_id, org],
        ),
      );
      if (
        !source.rows[0] ||
        !factsStillConfirmed(
          source.rows[0].data.facts,
          source.rows[0].snapshot.confirmedFacts,
        )
      )
        return update("conflict", {
          note: "Local product facts changed after approval. A new fact review and approval are required.",
        });
    }
    if (action === "reconcile") {
      if (
        ![
          "uncertain",
          "publishing",
          "rollback_uncertain",
          "rolling_back",
        ].includes(p.status)
      )
        return p;
      const rollback =
        p.status.startsWith("rollback") || p.status === "rolling_back";
      const desired = rollback ? s.before.descriptionHtml : s.proposedHtml;
      if (current.descriptionHtml === desired)
        return update(rollback ? "rolled_back" : "published", {
          after: rollback ? s.after : current,
          reconciledAt: new Date().toISOString(),
          note: "Current remote content matches the requested version; origin of this state is not asserted.",
        });
      return update(rollback ? "rollback_conflict" : "conflict", {
        note: "Remote state does not match the requested version. Re-review required.",
      });
    }
    if (action === "publish" && p.status !== "prepared")
      throw Error("This publication needs reconciliation or a new review.");
    if (action === "rollback" && p.status !== "published")
      throw Error("Only a confirmed publication can be rolled back.");
    const expected = action === "publish" ? s.before : s.after;
    if (!expected || remoteDigest(current) !== remoteDigest(expected))
      return update(action === "publish" ? "conflict" : "rollback_conflict", {
        note: "Remote content or version changed. Re-review instead of overwriting.",
      });
    const html =
      action === "publish" ? s.proposedHtml : s.before.descriptionHtml;
    await update(action === "publish" ? "publishing" : "rolling_back");
    try {
      const written = await adapter.write(org, p.remote_id, html);
      if (written.descriptionHtml !== html)
        return update(
          action === "publish" ? "uncertain" : "rollback_uncertain",
          {
            observed: written,
            note: "Returned content differs from the requested version. Reconcile before further writes.",
          },
        );
      return update(
        action === "publish" ? "published" : "rolled_back",
        action === "publish"
          ? { after: written, publishedAt: new Date().toISOString() }
          : { rolledBackAt: new Date().toISOString() },
      );
    } catch {
      return update(action === "publish" ? "uncertain" : "rollback_uncertain", {
        note: "Write outcome is unknown. Reconcile remote state; no automatic retry is allowed.",
      });
    }
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [org]);
    lock.release();
  }
}
export function shopifyWebhooks(app: Express) {
  app.post(
    "/api/shopify/webhooks",
    express.raw({ type: "application/json", limit: "2mb" }),
    async (req, res) => {
      const secret = process.env.SHOPIFY_CLIENT_SECRET;
      if (
        !secret ||
        !Buffer.isBuffer(req.body) ||
        !verifyWebhook(req.body, req.get("X-Shopify-Hmac-Sha256") || "", secret)
      ) {
        res.status(401).json({ error: "Invalid webhook signature." });
        return;
      }
      const topic = req.get("X-Shopify-Topic") || "",
        shop = shopSchema.safeParse(req.get("X-Shopify-Shop-Domain"));
      const receipt = req.get("X-Shopify-Webhook-Id");
      if (
        !shop.success ||
        !receipt ||
        ![
          "app/uninstalled",
          "customers/data_request",
          "customers/redact",
          "shop/redact",
        ].includes(topic)
      ) {
        res.status(400).json({ error: "Invalid webhook metadata." });
        return;
      }
      let body: any;
      try {
        body = JSON.parse(req.body.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid webhook body." });
        return;
      }
      if ((body.shop_domain || body.myshopify_domain) !== shop.data) {
        res.status(400).json({ error: "Webhook store mismatch." });
        return;
      }
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const result = await db.query(
          "INSERT INTO shop_webhook_receipts(id,shop,topic) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
          [receipt, shop.data, topic],
        );
        if (!result.rowCount) {
          await db.query("COMMIT");
          res.json({ ok: true });
          return;
        }
        const { rows } = await db.query(
          "SELECT org_id FROM shop_connections WHERE shop=$1 FOR UPDATE",
          [shop.data],
        );
        const org = rows[0]?.org_id;
        if (org) {
          if (topic === "app/uninstalled")
            await db.query(
              "UPDATE shop_connections SET encrypted_tokens=null,revoked=true WHERE org_id=$1",
              [org],
            );
          else if (topic === "shop/redact") {
            await db.query("DELETE FROM products WHERE org_id=$1", [org]);
            await db.query("DELETE FROM privacy_tasks WHERE org_id=$1", [org]);
            await db.query("DELETE FROM shop_connections WHERE org_id=$1", [
              org,
            ]);
            await db.query(
              "UPDATE shop_webhook_receipts SET shop='' WHERE shop=$1",
              [shop.data],
            );
            await db.query(
              "UPDATE organizations SET name='My store',store_url=null,tone='Warm & straightforward',category='Lighting',ai_consent=false,evidence_revision=evidence_revision+1 WHERE id=$1",
              [org],
            );
          } else {
            const taskID = randomUUID();
            await db.query(
              "INSERT INTO privacy_tasks(id,org_id,shop,topic,request_ref,encrypted_payload) VALUES($1,$2,$3,$4,$5,$6)",
              [
                taskID,
                org,
                shop.data,
                topic,
                String(body.data_request?.id || body.customer?.id || receipt),
                seal(body, org + "|privacy|" + taskID),
              ],
            );
          }
        }
        await db.query("COMMIT");
        res.json({ ok: true });
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
    },
  );
}
export function shopifyOAuth(app: Express) {
  app.get("/api/shopify/connect", authenticated, owner, async (req, res) => {
    if (!shopifyConfigured()) {
      res.status(503).json({
        error: "Shopify credentials and encryption are not configured.",
      });
      return;
    }
    const shop = shopSchema.parse(req.query.shop),
      write = req.query.write === "1";
    const existing = await pool.query(
      "SELECT org_id FROM shop_connections WHERE shop=$1",
      [shop],
    );
    if (existing.rows[0] && existing.rows[0].org_id !== req.identity!.org) {
      res
        .status(409)
        .json({ error: "This shop cannot be linked to this workspace." });
      return;
    }
    const state = randomBytes(32).toString("hex");
    await pool.query("DELETE FROM shop_oauth_states WHERE expires_at<now()");
    await pool.query(
      "INSERT INTO shop_oauth_states VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
      [digest(state), req.identity!.org, req.identity!.user, shop, write],
    );
    res.cookie("cluecart_shopify_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600000,
    });
    res.redirect(
      `https://${shop}/admin/oauth/authorize?` +
        new URLSearchParams({
          client_id: process.env.SHOPIFY_CLIENT_ID!,
          scope: write ? "write_products" : "read_products",
          redirect_uri: process.env.PUBLIC_APP_URL! + "/api/shopify/callback",
          state,
        }),
    );
  });
  app.get("/api/shopify/callback", async (req, res) => {
    if (!shopifyConfigured()) {
      res.status(503).json({ error: "Shopify is not configured." });
      return;
    }
    const params = z.record(z.string(), z.string()).parse(req.query);
    if (
      !verifyOAuth(params, process.env.SHOPIFY_CLIENT_SECRET!) ||
      !params.state ||
      !equal(params.state, req.cookies.cluecart_shopify_state || "") ||
      !/^\d{10}$/.test(params.timestamp || "") ||
      Math.abs(Date.now() / 1000 - Number(params.timestamp)) > 300
    ) {
      res
        .status(403)
        .json({ error: "Invalid or expired Shopify authorization." });
      return;
    }
    const shop = shopSchema.parse(params.shop);
    res.clearCookie("cluecart_shopify_state");
    const state = await pool.query(
      "DELETE FROM shop_oauth_states WHERE state_hash=$1 AND shop=$2 AND expires_at>now() RETURNING *",
      [digest(params.state), shop],
    );
    const saved = state.rows[0];
    if (!saved) {
      res
        .status(403)
        .json({ error: "Authorization state already used or expired." });
      return;
    }
    const owner = await pool.query(
      "SELECT 1 FROM memberships WHERE user_id=$1 AND org_id=$2 AND role='owner'",
      [saved.user_id, saved.org_id],
    );
    if (!owner.rowCount) {
      res.status(403).json({ error: "Workspace authorization changed." });
      return;
    }
    const token = tokenSchema.parse(
      await fetchJSON(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.SHOPIFY_CLIENT_ID!,
          client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
          code: params.code,
          expiring: "1",
        }),
      }),
    );
    const scopes = token.scope || "";
    if (
      saved.write_access
        ? !scopes.split(",").includes("write_products")
        : !scopes
            .split(",")
            .some((s) => ["read_products", "write_products"].includes(s))
    ) {
      res
        .status(403)
        .json({ error: "Required product permission was not granted." });
      return;
    }
    const encrypted = seal(
      { ...token, expiresAt: Date.now() + token.expires_in * 1000 },
      saved.org_id + "|" + shop,
    );
    await pool.query(
      "INSERT INTO shop_connections(shop,org_id,encrypted_tokens,scopes) VALUES($1,$2,$3,$4) ON CONFLICT(shop) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,scopes=excluded.scopes,revoked=false WHERE shop_connections.org_id=excluded.org_id",
      [shop, saved.org_id, encrypted, scopes],
    );
    res.redirect("/workspace");
  });
}
export function shopifyRoutes(app: Express) {
  app.get("/api/shopify/connection", async (req, res) => {
    const r = await pool.query(
      "SELECT shop,scopes,revoked FROM shop_connections WHERE org_id=$1",
      [req.identity!.org],
    );
    res.json({
      configured: shopifyConfigured(),
      connection: r.rows[0] || null,
      liveValidated: false,
      billing:
        "Shopify App Pricing requires Partner Dashboard configuration; no billing is active.",
    });
  });
  app.get("/api/shopify/privacy-tasks/:taskId", owner, async (req, res) => {
    const id = uuid.parse(req.params.taskId),
      org = req.identity!.org;
    const result = await pool.query(
      "SELECT encrypted_payload FROM privacy_tasks WHERE id=$1 AND org_id=$2",
      [id, org],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Privacy task not found." });
      return;
    }
    res.json({
      request: unseal(result.rows[0].encrypted_payload, org + "|privacy|" + id),
      status: "Manual review and fulfillment required.",
    });
  });
  app.post("/api/shopify/import", owner, async (req, res) => {
    const id = remoteID.parse(req.body.id);
    const r = await graph(
      req.identity!.org,
      "query Import($id:ID!){ shop{currencyCode} product(id:$id){id title description descriptionHtml handle updatedAt images(first:10){nodes{url}} variants(first:100){pageInfo{hasNextPage} nodes{id title price}}}}",
      { id },
    );
    const p = r.data.product;
    if (!p) {
      res.status(404).json({ error: "Shopify product not found." });
      return;
    }
    if (p.variants.pageInfo?.hasNextPage) {
      res.status(422).json({
        error:
          "This product has more than 100 variants. Use manual entry; paginated Shopify import is not supported yet.",
      });
      return;
    }
    const data = productSchema.parse({
      title: p.title,
      description: p.description,
      price: Number(p.variants.nodes[0]?.price) || 0,
      currency: r.data.shop.currencyCode,
      images: p.images.nodes.map((i: any) => i.url),
      variants: p.variants.nodes.map((v: any) => ({
        id: v.id,
        title: v.title,
        price: Number(v.price),
      })),
      sourceURL: `https://${r.shop}/products/${p.handle}`,
      importedAt: new Date().toISOString(),
      shopify: { shop: r.shop, id: p.id, updatedAt: p.updatedAt },
      facts: [],
    });
    const imported = await scoped(req.identity!.org, async (db) => {
      await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        req.identity!.org,
      ]);
      const existing = await db.query(
        "SELECT id,data FROM products WHERE org_id=$1 AND data->'shopify'->>'id'=$2",
        [req.identity!.org, id],
      );
      if (existing.rows[0]) return existing.rows[0];
      const pid = randomUUID();
      await db.query("INSERT INTO products(id,org_id,data) VALUES($1,$2,$3)", [
        pid,
        req.identity!.org,
        data,
      ]);
      return { id: pid, data };
    });
    res.status(201).json(imported);
  });
  app.get("/api/shopify/privacy-tasks", owner, async (req, res) =>
    res.json(
      (
        await pool.query(
          "SELECT id,topic,request_ref,status,created_at FROM privacy_tasks WHERE org_id=$1 ORDER BY created_at",
          [req.identity!.org],
        )
      ).rows,
    ),
  );
  app.post(
    "/api/products/:productId/publication-preview",
    owner,
    async (req, res) => {
      const id = uuid.parse(req.params.productId),
        approval = uuid.parse(req.body.approvalID),
        org = req.identity!.org;
      const result = await scoped(org, (db) =>
        db.query(
          "SELECT p.data,a.snapshot FROM products p JOIN approvals a ON a.product_id=p.id AND a.org_id=p.org_id WHERE p.id=$1 AND p.org_id=$2 AND a.id=$3",
          [id, org, approval],
        ),
      );
      const row = result.rows[0];
      if (
        !row?.data.shopify ||
        row.snapshot.targetField !== "descriptionHtml"
      ) {
        res.status(422).json({
          error:
            "An imported Shopify product and approved description are required.",
        });
        return;
      }
      const connection = await pool.query(
        "SELECT shop FROM shop_connections WHERE org_id=$1 AND revoked=false",
        [org],
      );
      if (connection.rows[0]?.shop !== row.data.shopify.shop) {
        res.status(409).json({
          error: "Shop connection differs from the imported destination.",
        });
        return;
      }
      if (!factsStillConfirmed(row.data.facts, row.snapshot.confirmedFacts)) {
        res.status(409).json({
          error:
            "Product facts changed after approval. Approve a reviewed draft first.",
        });
        return;
      }
      const remote = await shopifyAdapter.read(org, row.data.shopify.id);
      const snapshot = {
        before: remote,
        proposedHtml: safeHTML(row.snapshot.revised),
        targetField: "descriptionHtml",
        preparedAt: new Date().toISOString(),
      };
      const publication = randomUUID();
      await scoped(org, (db) =>
        db.query(
          "INSERT INTO publications(id,org_id,product_id,approval_id,shop,remote_id,status,snapshot) VALUES($1,$2,$3,$4,$5,$6,'prepared',$7)",
          [
            publication,
            org,
            id,
            approval,
            row.data.shopify.shop,
            remote.id,
            snapshot,
          ],
        ),
      );
      res.status(201).json({
        id: publication,
        status: "prepared",
        snapshot,
        shop: row.data.shopify.shop,
        reviewDigest: publicationReview(snapshot),
      });
    },
  );
  app.get("/api/products/:productId/publications", async (req, res) =>
    res.json(
      (
        await scoped(req.identity!.org, (db) =>
          db.query(
            "SELECT * FROM publications WHERE org_id=$1 AND product_id=$2 ORDER BY created_at DESC",
            [req.identity!.org, uuid.parse(req.params.productId)],
          ),
        )
      ).rows.map((p) => ({
        ...p,
        reviewDigest: publicationReview(p.snapshot),
        rollbackDigest: snapshotDigest(p.snapshot),
      })),
    ),
  );
  app.post(
    "/api/publications/:publicationId/:action",
    owner,
    async (req, res) => {
      const action = z
          .enum(["publish", "rollback", "reconcile"])
          .parse(req.params.action),
        id = uuid.parse(req.params.publicationId);
      const rows = await scoped(req.identity!.org, (db) =>
        db.query("SELECT * FROM publications WHERE id=$1 AND org_id=$2", [
          id,
          req.identity!.org,
        ]),
      );
      if (!rows.rows[0]) {
        res.status(404).json({ error: "Publication not found." });
        return;
      }
      if (
        (action === "publish" && rows.rows[0].status === "published") ||
        (action === "rollback" && rows.rows[0].status === "rolled_back")
      ) {
        res.json(rows.rows[0]);
        return;
      }
      if (
        action !== "reconcile" &&
        (req.body.confirmed !== true ||
          req.body.reviewDigest !==
            (action === "publish"
              ? publicationReview(rows.rows[0].snapshot)
              : snapshotDigest(rows.rows[0].snapshot)))
      ) {
        res.status(422).json({
          error:
            "Explicit approval of this exact destination and version is required.",
        });
        return;
      }
      res.json(
        await executePublication(
          req.identity!.org,
          id,
          action,
          shopifyAdapter,
          req.identity!.user,
        ),
      );
    },
  );
}
