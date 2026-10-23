import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { createApp } from "../server/app.js";
import { pool, migrate } from "../server/db.js";
import {
  seal,
  unseal,
  shopSchema,
  verifyOAuth,
  verifyWebhook,
} from "../server/shopify.js";
const originalFetch = globalThis.fetch,
  app = createApp(),
  client = request.agent(app),
  other = request.agent(app);
const shop = "cluecart-fixture.myshopify.com",
  remoteID = "gid://shopify/Product/123";
let org = "",
  productID = "",
  approvalID = "",
  writes = 0,
  failAfterWrite = false,
  refreshes = 0;
let remote = {
  id: remoteID,
  title: "Fixture lamp",
  descriptionHtml: "<p>Original copy</p>",
  updatedAt: "2026-10-22T12:00:00Z",
};
let clock = 0;
before(async () => {
  await migrate();
  process.env.SHOPIFY_CLIENT_ID = "fixture-client";
  process.env.SHOPIFY_CLIENT_SECRET = "fixture-only-secret";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:5180";
  await client
    .post("/api/auth/register")
    .send({
      email: randomUUID() + "@shopfixture.example",
      password: "fixture-local-password-123",
    })
    .expect(201);
  await other
    .post("/api/auth/register")
    .send({
      email: randomUUID() + "@othershop.example",
      password: "fixture-local-password-123",
    })
    .expect(201);
  org = (await client.get("/api/me")).body.organization.id;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url === `https://${shop}/admin/oauth/access_token`) {
      const body = init.body as URLSearchParams;
      if (body.get("grant_type") === "refresh_token") refreshes++;
      else assert.equal(body.get("expiring"), "1");
      return Response.json({
        access_token: "fixture-token",
        refresh_token: "fixture-refresh",
        expires_in: 3600,
        scope: "write_products",
      });
    }
    assert.equal(url, `https://${shop}/admin/api/2026-10/graphql.json`);
    const body = JSON.parse(init.body);
    if (body.query.startsWith("query Import"))
      return Response.json({
        data: {
          shop: { currencyCode: "USD" },
          product: {
            ...remote,
            description: "Original copy",
            handle: "fixture",
            images: { nodes: [] },
            variants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/1",
                  title: "Default",
                  price: "89.00",
                },
              ],
            },
          },
        },
      });
    if (body.query.startsWith("query Product"))
      return Response.json({ data: { product: { ...remote } } });
    if (body.query.startsWith("mutation Description")) {
      writes++;
      remote = {
        ...remote,
        descriptionHtml: body.variables.product.descriptionHtml,
        updatedAt: `2026-10-22T12:00:${String(++clock).padStart(2, "0")}Z`,
      };
      if (failAfterWrite) throw Error("Simulated lost network response");
      return Response.json({
        data: { productUpdate: { product: { ...remote }, userErrors: [] } },
      });
    }
    throw Error("Unexpected fixture request");
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = originalFetch;
  await client
    .delete("/api/account")
    .send({ confirmation: "DELETE MY WORKSPACE" })
    .expect(200);
  await other
    .delete("/api/account")
    .send({ confirmation: "DELETE MY WORKSPACE" })
    .expect(200);
  await pool.query(
    "DELETE FROM shop_webhook_receipts WHERE shop=$1 OR shop=$2",
    [shop, ""],
  );
  await pool.end();
});
function signature(params: Record<string, string>) {
  return createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET!)
    .update(
      Object.entries(params)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("&"),
    )
    .digest("hex");
}
async function prepare() {
  return (
    await client
      .post(`/api/products/${productID}/publication-preview`)
      .send({ approvalID })
      .expect(201)
  ).body;
}
async function publish(prepared: any) {
  return client
    .post(`/api/publications/${prepared.id}/publish`)
    .send({ confirmed: true, reviewDigest: prepared.reviewDigest });
}
test("tokens use authenticated encryption bound to tenant/shop and signatures reject tampering", () => {
  const encrypted = seal({ access_token: "fixture-token" }, org + "|" + shop);
  assert.ok(!encrypted.includes("fixture-token"));
  assert.equal(
    unseal(encrypted, org + "|" + shop).access_token,
    "fixture-token",
  );
  assert.throws(() => unseal(encrypted, "wrong-tenant|" + shop));
  assert.equal(shopSchema.safeParse("evil.example").success, false);
  assert.equal(
    shopSchema.safeParse("shop.myshopify.com.evil.example").success,
    false,
  );
  const params = { shop, state: "x", timestamp: "123" };
  assert.equal(
    verifyOAuth(
      { ...params, hmac: signature(params) },
      process.env.SHOPIFY_CLIENT_SECRET!,
    ),
    true,
  );
  assert.equal(
    verifyOAuth(
      { ...params, state: "tampered", hmac: signature(params) },
      process.env.SHOPIFY_CLIENT_SECRET!,
    ),
    false,
  );
  assert.equal(
    verifyWebhook(Buffer.from("{}"), "bad", process.env.SHOPIFY_CLIENT_SECRET!),
    false,
  );
});
test("OAuth scopes start with products only, validate callback, encrypt expiring tokens and isolate shops", async () => {
  const result = await client
    .get("/api/shopify/connect")
    .query({ shop })
    .expect(302);
  const url = new URL(result.headers.location);
  assert.equal(url.searchParams.get("scope"), "read_products");
  assert.ok(!url.searchParams.get("scope")!.includes("customers"));
  const params = {
    shop,
    state: url.searchParams.get("state")!,
    timestamp: String(Math.floor(Date.now() / 1000)),
    code: "fixture-code",
  };
  await client
    .get("/api/shopify/callback")
    .query({ ...params, hmac: "bad" })
    .expect(403);
  await client
    .get("/api/shopify/callback")
    .query({ ...params, hmac: signature(params) })
    .expect(302);
  await client
    .get("/api/shopify/callback")
    .query({ ...params, hmac: signature(params) })
    .expect(403);
  const c = (await client.get("/api/shopify/connection")).body;
  assert.equal(c.connection.shop, shop);
  assert.equal(c.connection.encrypted_tokens, undefined);
  await other.get("/api/shopify/connect").query({ shop }).expect(409);
  const raw = (
    await pool.query(
      "SELECT encrypted_tokens FROM shop_connections WHERE org_id=$1",
      [org],
    )
  ).rows[0].encrypted_tokens;
  assert.ok(!raw.includes("fixture-token"));
  const tokens = unseal(raw, org + "|" + shop);
  tokens.expiresAt = Date.now() - 1000;
  await pool.query(
    "UPDATE shop_connections SET encrypted_tokens=$1 WHERE org_id=$2",
    [seal(tokens, org + "|" + shop), org],
  );
});
test("Shopify product import preserves variants, refreshes expiry, avoids inventing specs and is idempotent", async () => {
  const result = await client
    .post("/api/shopify/import")
    .send({ id: remoteID })
    .expect(201);
  productID = result.body.id;
  assert.equal(
    result.body.data.variants[0].id,
    "gid://shopify/ProductVariant/1",
  );
  assert.equal(result.body.data.price, 89);
  assert.equal(result.body.data.variants[0].price, 89);
  assert.deepEqual(result.body.data.facts, []);
  assert.equal(refreshes, 1);
  assert.equal(
    (await client.post("/api/shopify/import").send({ id: remoteID })).body.id,
    productID,
  );
  const facts = [
    {
      id: randomUUID(),
      topic: "size",
      value: "28 cm tall",
      variant: "",
      confirmed: true,
    },
  ];
  await client
    .patch(`/api/products/${productID}/facts`)
    .send({ facts })
    .expect(200);
  const d = await client
    .post(`/api/products/${productID}/drafts`)
    .send({
      kind: "Clarification",
      text: "28 cm tall",
      factIDs: [facts[0].id],
      recordIDs: [],
      merchantVerified: true,
      verificationNote: "Verified against fixture manufacturer specification.",
    })
    .expect(201);
  approvalID = (
    await client
      .post(`/api/products/${productID}/approve`)
      .send({ draftID: d.body.id })
      .expect(201)
  ).body.id;
});
test("publication requires exact approval and blocks even case-only intervening edits", async () => {
  const p = await prepare();
  await client
    .post(`/api/publications/${p.id}/publish`)
    .send({ confirmed: false, reviewDigest: p.reviewDigest })
    .expect(422);
  await other
    .post(`/api/publications/${p.id}/publish`)
    .send({ confirmed: true, reviewDigest: p.reviewDigest })
    .expect(404);
  remote.descriptionHtml = "<p>original copy</p>";
  const result = await publish(p);
  assert.equal(result.body.status, "conflict");
  assert.equal(writes, 0);
});
test("publication is retry-safe and rollback rejects external edits", async () => {
  const p = await prepare();
  const result = await publish(p);
  assert.equal(result.body.status, "published");
  assert.equal(writes, 1);
  assert.equal((await publish(p)).body.status, "published");
  assert.equal(writes, 1);
  remote = { ...remote, updatedAt: "2026-10-22T12:30:00Z" };
  const list = (await client.get(`/api/products/${productID}/publications`))
    .body;
  const pub = list.find((x: any) => x.id === p.id);
  const rollback = await client
    .post(`/api/publications/${p.id}/rollback`)
    .send({ confirmed: true, reviewDigest: pub.rollbackDigest })
    .expect(200);
  assert.equal(rollback.body.status, "rollback_conflict");
  assert.equal(writes, 1);
});
test("a confirmed publication can rollback once when its version is unchanged", async () => {
  const p = await prepare();
  assert.equal((await publish(p)).body.status, "published");
  const pub = (
    await client.get(`/api/products/${productID}/publications`)
  ).body.find((x: any) => x.id === p.id);
  const body = { confirmed: true, reviewDigest: pub.rollbackDigest };
  assert.equal(
    (await client.post(`/api/publications/${p.id}/rollback`).send(body)).body
      .status,
    "rolled_back",
  );
  const count = writes;
  assert.equal(
    (await client.post(`/api/publications/${p.id}/rollback`).send(body)).body
      .status,
    "rolled_back",
  );
  assert.equal(writes, count);
});
test("ambiguous writes are reconciled without repeating a mutation", async () => {
  const p = await prepare();
  failAfterWrite = true;
  const result = await publish(p);
  assert.equal(result.body.status, "uncertain");
  const count = writes;
  await publish(p);
  assert.equal(writes, count);
  const reconciled = await client
    .post(`/api/publications/${p.id}/reconcile`)
    .expect(200);
  assert.equal(reconciled.body.status, "published");
  assert.equal(writes, count);
  failAfterWrite = false;
});
test("changed local facts invalidate prepared publications and require a new approval", async () => {
  const p = await prepare();
  const current = await client.get(`/api/products/${productID}`);
  const facts = current.body.product.facts.map((f: any) => ({
    ...f,
    value: "30 cm tall",
    confirmed: true,
  }));
  await client
    .patch(`/api/products/${productID}/facts`)
    .send({ facts })
    .expect(200);
  const count = writes;
  const result = await publish(p);
  assert.equal(result.body.status, "conflict");
  assert.match(result.body.snapshot.note, /Local product facts changed/);
  assert.equal(writes, count);
  await client
    .post(`/api/products/${productID}/publication-preview`)
    .send({ approvalID })
    .expect(409);
});
async function webhook(topic: string, payload: unknown, id = randomUUID()) {
  const body = JSON.stringify(payload),
    hmac = createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET!)
      .update(body)
      .digest("base64");
  return client
    .post("/api/shopify/webhooks")
    .set("Content-Type", "application/json")
    .set("X-Shopify-Hmac-Sha256", hmac)
    .set("X-Shopify-Topic", topic)
    .set("X-Shopify-Shop-Domain", shop)
    .set("X-Shopify-Webhook-Id", id)
    .send(body);
}
test("signed privacy/uninstall webhooks are idempotent; shop redaction removes store data", async () => {
  await client
    .post("/api/shopify/webhooks")
    .set("Content-Type", "application/json")
    .set("X-Shopify-Hmac-Sha256", "bad")
    .send("{}")
    .expect(401);
  const id = randomUUID();
  assert.equal(
    (
      await webhook(
        "customers/data_request",
        { shop_domain: shop, data_request: { id: 10 } },
        id,
      )
    ).status,
    200,
  );
  await webhook(
    "customers/data_request",
    { shop_domain: shop, data_request: { id: 10 } },
    id,
  );
  assert.equal((await client.get("/api/shopify/privacy-tasks")).body.length, 1);
  const task = (await client.get("/api/shopify/privacy-tasks")).body[0];
  const details = await client
    .get("/api/shopify/privacy-tasks/" + task.id)
    .expect(200);
  assert.equal(details.body.request.data_request.id, 10);
  await other.get("/api/shopify/privacy-tasks/" + task.id).expect(404);
  assert.equal(
    (await webhook("app/uninstalled", { myshopify_domain: shop, id: 1 }))
      .status,
    200,
  );
  assert.equal(
    (await client.get("/api/shopify/connection")).body.connection.revoked,
    true,
  );
  assert.equal(
    (await webhook("shop/redact", { shop_domain: shop, shop_id: 1 })).status,
    200,
  );
  assert.equal((await client.get("/api/products")).body.length, 0);
  assert.equal(
    (await client.get("/api/shopify/connection")).body.connection,
    null,
  );
  assert.equal((await client.get("/api/shopify/privacy-tasks")).body.length, 0);
});
