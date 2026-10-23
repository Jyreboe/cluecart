import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { randomUUID, createHash } from "node:crypto";
import { createApp } from "../server/app.js";
import { migrate, pool } from "../server/db.js";
const originalFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});
test("managed OIDC enforces state, PKCE, signed identity, audience, nonce and verified email with a mock provider", async () => {
  await migrate();
  process.env.OIDC_ISSUER = "https://identity.example";
  process.env.OIDC_CLIENT_ID = "cluecart-test";
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:5180";
  const { privateKey, publicKey } = await generateKeyPair("RS256"),
    jwk = await exportJWK(publicKey);
  const subject = randomUUID(),
    email = subject + "@managed.example";
  let nonce = "",
    challenge = "",
    badAudience = false;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: "https://identity.example",
        authorization_endpoint: "https://identity.example/authorize",
        token_endpoint: "https://identity.example/token",
        jwks_uri: "https://identity.example/keys",
      });
    if (url.endsWith("/keys"))
      return Response.json({
        keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
      });
    if (url.endsWith("/token")) {
      const body = init.body as URLSearchParams;
      assert.equal(
        createHash("sha256")
          .update(body.get("code_verifier")!)
          .digest("base64url"),
        challenge,
      );
      const token = await new SignJWT({ nonce, email, email_verified: true })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject(subject)
        .setIssuer("https://identity.example")
        .setAudience(badAudience ? "wrong-audience" : "cluecart-test")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ id_token: token });
    }
    throw Error("Unexpected provider request");
  }) as typeof fetch;
  const app = createApp(),
    client = request.agent(app);
  let location = new URL(
    (await client.get("/api/auth/managed").expect(302)).headers.location,
  );
  nonce = location.searchParams.get("nonce")!;
  challenge = location.searchParams.get("code_challenge")!;
  await client.get("/api/auth/callback?state=incorrect&code=code").expect(400);
  // A fresh valid request must succeed; wrong state did not grant an account.
  location = new URL(
    (await client.get("/api/auth/managed").expect(302)).headers.location,
  );
  nonce = location.searchParams.get("nonce")!;
  challenge = location.searchParams.get("code_challenge")!;
  badAudience = true;
  await client
    .get("/api/auth/callback")
    .query({ state: location.searchParams.get("state"), code: "code" })
    .expect(500);
  await client.get("/api/me").expect(401);
  location = new URL(
    (await client.get("/api/auth/managed").expect(302)).headers.location,
  );
  nonce = location.searchParams.get("nonce")!;
  challenge = location.searchParams.get("code_challenge")!;
  badAudience = false;
  await client
    .get("/api/auth/callback")
    .query({ state: location.searchParams.get("state"), code: "code" })
    .expect(302);
  const me = await client.get("/api/me").expect(200);
  assert.equal(me.body.email, email);
  await client
    .delete("/api/account")
    .send({ confirmation: "DELETE MY WORKSPACE" })
    .expect(200);
  await client.get("/api/me").expect(401);
});
