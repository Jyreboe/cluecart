import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { migrate, pool } from "../server/db.js";
import { runJob } from "../server/jobs.js";
import { openAIProvider, validateClassification } from "../server/ai.js";
import { productSchema } from "../server/model.js";
const app = createApp(),
  client = request.agent(app);
let productID = "",
  records: any[] = [],
  calls = 0,
  consentRevision = 0;
before(async () => {
  await migrate();
  process.env.AI_PROVIDER = "openai";
  process.env.AI_MODEL = "fixture-model";
  process.env.CLUECART_AI_KEY = "fixture-only-key";
  await client
    .post("/api/auth/register")
    .send({
      email: randomUUID() + "@aifixture.example",
      password: "local-ai-password-123",
    })
    .expect(201);
  productID = (
    await client
      .post("/api/products")
      .send({
        title: "Private merchant lamp",
        facts: [
          {
            id: randomUUID(),
            topic: "size",
            value: "28 cm tall",
            confirmed: true,
          },
        ],
      })
      .expect(201)
  ).body.id;
  await client
    .post(`/api/products/${productID}/evidence`)
    .send({
      records: [
        { type: "Question", text: "What is the height? jane@example.com" },
        { type: "Question", text: "How wide is it?" },
        { type: "Review", text: "The finish is beautiful." },
      ],
    })
    .expect(201);
  records = (await client.get(`/api/products/${productID}`)).body.records;
  consentRevision = (await client.get("/api/ai/config")).body.evidence_revision;
  await client
    .post("/api/ai/consent")
    .send({ enabled: true, expectedRevision: consentRevision })
    .expect(200);
});
after(async () => {
  await client
    .delete("/api/account")
    .send({ confirmation: "DELETE MY WORKSPACE" })
    .expect(200);
  await pool.end();
});
async function queue(key = randomUUID()) {
  return (
    await client
      .post(`/api/products/${productID}/analyses`)
      .send({ requestKey: key })
      .expect(202)
  ).body;
}
async function job(id: string) {
  return (await client.get(`/api/products/${productID}`)).body.jobs.find(
    (j: any) => j.id === id,
  );
}
test("SDK Responses structured-output request excludes account/product identity and redacts evidence; unknown citations reject", async () => {
  const original = globalThis.fetch;
  let count = 0;
  try {
    globalThis.fetch = (async (input: any, init?: any) => {
      count++;
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.equal(body.model, "fixture-model");
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.ok(!body.input.includes("jane@example.com"));
      assert.ok(body.input.includes("[email redacted]"));
      assert.ok(!body.input.includes("Private merchant lamp"));
      assert.equal(body.tools, undefined);
      return Response.json({
        id: "resp_fixture",
        object: "response",
        created_at: 1,
        status: "completed",
        model: "fixture-model",
        output: [
          {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  themes: [{ topic: "size", recordIDs: [records[0].id] }],
                }),
                annotations: [],
              },
            ],
          },
        ],
      });
    }) as typeof fetch;
    const result = await openAIProvider.classify(
      productSchema.parse({ title: "Private merchant lamp" }),
      records,
    );
    assert.equal(result.themes[0].recordIDs[0], records[0].id);
    assert.equal(count, 1);
    assert.throws(() =>
      validateClassification(
        { themes: [{ topic: "size", recordIDs: [randomUUID()] }] },
        records,
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("AI failures block automatic retry and do not consume app allowance or expose error input", async () => {
  const key = randomUUID(),
    j = await queue(key);
  await runJob({
    async classify() {
      calls++;
      throw Error("private customer payload should not be logged");
    },
  });
  const failed = await job(j.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.retryable, false);
  assert.ok(!failed.error.includes("private customer"));
  assert.equal((await client.get("/api/me")).body.usage.analyses, 0);
  await client
    .post(`/api/products/${productID}/jobs/${j.id}/retry`)
    .expect(409);
  assert.equal((await queue(key)).id, j.id);
  await runJob({
    async classify() {
      calls++;
      return { themes: [] };
    },
  });
  assert.equal(calls, 1);
});
test("invalid model citations cannot become customer findings or paid app usage", async () => {
  const j = await queue();
  await runJob({
    async classify() {
      return { themes: [{ topic: "size", recordIDs: [randomUUID()] }] };
    },
  });
  assert.equal((await job(j.id)).status, "failed");
  assert.equal((await client.get("/api/me")).body.usage.analyses, 0);
});
test("cancellation aborts the provider request and never consumes completed-analysis allowance", async () => {
  const j = await queue();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  const running = runJob({
    async classify(_p, _r, signal) {
      started();
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(Error("Cancelled")), {
          once: true,
        }),
      );
    },
  });
  await ready;
  await client
    .post(`/api/products/${productID}/jobs/${j.id}/cancel`)
    .expect(200);
  await running;
  assert.equal((await job(j.id)).status, "cancelled");
  assert.equal((await client.get("/api/me")).body.usage.analyses, 0);
});
test("verified grouping uses real exact excerpts, charges once, and new evidence revokes AI consent", async () => {
  const key = randomUUID(),
    j = await queue(key);
  let received = "";
  await runJob({
    async classify(_p, input) {
      received = input[0].text;
      return {
        themes: [{ topic: "size", recordIDs: [records[0].id, records[1].id] }],
      };
    },
  });
  assert.ok(!received.includes("jane@example.com"));
  const completed = await job(j.id);
  assert.equal(completed.status, "completed");
  assert.match(completed.result.engine, /AI-inferred/);
  assert.equal(completed.result.findings[0].count, 2);
  assert.equal(completed.result.findings[0].excerpts[0].text, records[0].text);
  assert.equal((await client.get("/api/me")).body.usage.analyses, 1);
  assert.equal((await queue(key)).id, j.id);
  await client
    .post(`/api/products/${productID}/evidence`)
    .send({
      records: [{ type: "Question", text: "New question about charging." }],
    })
    .expect(201);
  assert.equal((await client.get("/api/ai/config")).body.ai_consent, false);
  await client
    .post("/api/ai/consent")
    .send({ enabled: true, expectedRevision: consentRevision })
    .expect(409);
});
