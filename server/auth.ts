import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "./db.js";
export type Identity = {
  user: string;
  org: string;
  role: string;
  email: string;
};
declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const secure = process.env.NODE_ENV === "production";
const cookie = {
  httpOnly: true,
  secure,
  sameSite: "strict" as const,
  path: "/",
  maxAge: 7 * 86400000,
};
export const devAuth = () => process.env.DEV_AUTH === "1" && !secure;
function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
function verify(password: string, value: string) {
  const [salt, stored] = value.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function session(res: Response, user: string) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')",
    [digest(token), user],
  );
  res.cookie("cluecart_session", token, cookie);
}
export async function createUser(
  email: string,
  password?: string,
  subject?: string,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const id = randomUUID(),
      org = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,subject) VALUES($1,$2,$3,$4)",
      [id, email, password ? passwordHash(password) : null, subject || null],
    );
    await db.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      org,
      "My store",
    ]);
    await db.query("INSERT INTO memberships VALUES($1,$2,'owner')", [id, org]);
    await db.query("COMMIT");
    return id;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function authenticated(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies.cluecart_session;
  if (!token) {
    res.status(401).json({ error: "Sign in to use your workspace." });
    return;
  }
  const { rows } = await pool.query(
    'SELECT u.id AS "user",u.email,m.org_id AS org,m.role FROM sessions s JOIN users u ON s.user_id=u.id JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() ORDER BY m.org_id LIMIT 1',
    [digest(token)],
  );
  if (!rows[0]) {
    res.status(401).json({ error: "Session expired. Sign in again." });
    return;
  }
  req.identity = rows[0];
  next();
}
export function editor(req: Request, res: Response, next: NextFunction) {
  if (!["owner", "editor"].includes(req.identity!.role)) {
    res.status(403).json({ error: "Editing permission required." });
    return;
  }
  next();
}
export function owner(req: Request, res: Response, next: NextFunction) {
  if (req.identity!.role !== "owner") {
    res.status(403).json({ error: "Owner approval permission required." });
    return;
  }
  next();
}
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 25,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const pending = new Map<
  string,
  { verifier: string; nonce: string; expires: number }
>();
export function authRoutes(app: Express) {
  app.get("/api/auth/config", (_req, res) =>
    res.json({ development: devAuth(), managed: !!process.env.OIDC_ISSUER }),
  );
  app.post("/api/auth/register", authLimit, async (req, res) => {
    if (!devAuth()) {
      res.status(404).json({ error: "Development registration is disabled." });
      return;
    }
    const data = z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    try {
      const id = await createUser(data.email, data.password);
      await session(res, id);
      res.status(201).json({ ok: true });
    } catch (e) {
      if ((e as { code: string }).code === "23505") {
        res
          .status(409)
          .json({ error: "Account already exists. Sign in instead." });
        return;
      }
      throw e;
    }
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    if (!devAuth()) {
      res.status(404).json({ error: "Development login is disabled." });
      return;
    }
    const data = z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      "SELECT id,password_hash FROM users WHERE email=$1",
      [data.email],
    );
    if (
      !rows[0]?.password_hash ||
      !verify(data.password, rows[0].password_hash)
    ) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    await session(res, rows[0].id);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.cookies.cluecart_session)
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies.cluecart_session),
      ]);
    res.clearCookie("cluecart_session", cookie);
    res.json({ ok: true });
  });
  async function discovery() {
    const issuer = process.env.OIDC_ISSUER!;
    if (!issuer || new URL(issuer).protocol !== "https:")
      throw Error("Managed sign-in is not configured.");
    const r = await fetch(
      issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
      { signal: AbortSignal.timeout(10000), redirect: "error" },
    );
    if (!r.ok) throw Error("Identity provider is unavailable.");
    const d = await r.json();
    if (d.issuer !== issuer) throw Error("Identity issuer mismatch");
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
      if (new URL(d[key]).protocol !== "https:")
        throw Error("Identity endpoints require HTTPS");
    return d;
  }
  app.get("/api/auth/managed", authLimit, async (_req, res) => {
    if (!process.env.OIDC_ISSUER) {
      res
        .status(503)
        .json({ error: "Managed authentication is not configured." });
      return;
    }
    const d = await discovery(),
      state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url"),
      nonce = randomBytes(32).toString("base64url");
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    pending.set(state, { verifier, nonce, expires: Date.now() + 600000 });
    res.cookie("cluecart_oauth", state, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 600000,
      path: "/",
    });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: process.env.OIDC_CLIENT_ID!,
      redirect_uri: process.env.PUBLIC_APP_URL! + "/api/auth/callback",
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: digestBase64(verifier),
      code_challenge_method: "S256",
    }).toString();
    res.redirect(url.href);
  });
  app.get("/api/auth/callback", authLimit, async (req, res) => {
    const state = String(req.query.state || ""),
      p = pending.get(state);
    pending.delete(state);
    res.clearCookie("cluecart_oauth");
    if (
      !p ||
      p.expires < Date.now() ||
      req.cookies.cluecart_oauth !== state ||
      typeof req.query.code !== "string"
    ) {
      res.status(400).send("Invalid or expired sign-in request.");
      return;
    }
    const d = await discovery();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: req.query.code,
      redirect_uri: process.env.PUBLIC_APP_URL! + "/api/auth/callback",
      client_id: process.env.OIDC_CLIENT_ID!,
      code_verifier: p.verifier,
    });
    const headers: Record<string, string> = {};
    if (process.env.OIDC_CLIENT_SECRET) {
      const methods = d.token_endpoint_auth_methods_supported || [
        "client_secret_basic",
      ];
      if (methods.includes("client_secret_basic"))
        headers.Authorization =
          "Basic " +
          Buffer.from(
            encodeURIComponent(process.env.OIDC_CLIENT_ID!) +
              ":" +
              encodeURIComponent(process.env.OIDC_CLIENT_SECRET),
          ).toString("base64");
      else if (methods.includes("client_secret_post"))
        body.set("client_secret", process.env.OIDC_CLIENT_SECRET);
      else throw Error("Unsupported identity client authentication method.");
    }
    const r = await fetch(d.token_endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!r.ok) throw Error("Identity code exchange failed.");
    const token = await r.json();
    const { payload } = await jwtVerify(
      token.id_token,
      createRemoteJWKSet(new URL(d.jwks_uri)),
      {
        issuer: d.issuer,
        audience: process.env.OIDC_CLIENT_ID,
        algorithms: ["RS256", "ES256"],
      },
    );
    if (
      payload.nonce !== p.nonce ||
      !payload.sub ||
      (payload.azp !== undefined &&
        payload.azp !== process.env.OIDC_CLIENT_ID) ||
      payload.email_verified !== true ||
      typeof payload.email !== "string"
    )
      throw Error("Verified identity required.");
    const subject = d.issuer + "|" + payload.sub;
    const result = await pool.query("SELECT id FROM users WHERE subject=$1", [
      subject,
    ]);
    let id = result.rows[0]?.id;
    if (!id)
      id = await createUser(payload.email.toLowerCase(), undefined, subject);
    await session(res, id);
    res.redirect("/workspace");
  });
}
function digestBase64(s: string) {
  return createHash("sha256").update(s).digest("base64url");
}
