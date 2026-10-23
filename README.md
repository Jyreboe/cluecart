# Cluecart

**Know what’s stopping the sale.** Turn customer questions into better product pages.

A React/TypeScript application with an Express API and PostgreSQL persistence. The manual evidence-to-page workflow works without Shopify or AI credentials. Production integrations are not complete; see the status table below.

## Run locally

Validated with Node 24.19.0, npm 11, Docker 28, PostgreSQL 17 and system Chromium.

```sh
cd /workspace/cluecart
npm ci --cache /workspace/.npm
npm run db:local
npm run db:migrate
npm run dev
```

`npm run dev` starts the API on loopback port 3001 and Vite on port 5173. Use the existing checkout: cloud tasks already have isolated workspaces; do not create a worktree. `/` is the fictional, unauthenticated demo. `/workspace` is a separate authenticated, persistent workspace. Its sign-in screen offers **Create a local development account** when development authentication is enabled. Use a unique testing password. Local sign-in is disabled in production.

Configure a store name, category and tone in Settings. Import one product manually; enter specifications as `topic | fact | optional variant ID`, and variants as `ID | name | optional price`. Confirm specifications only after checking them. Then upload a CSV or paste evidence, map columns, preview assignments and redactions, and import. Run analysis, inspect exact excerpts, draft from confirmed facts, edit, record a verification note, approve, and export HTML from Changes. Approved versions and their fact/evidence snapshots survive reload. Enter aggregate before/after measurements under Changes if available.

The local PostgreSQL container uses trust authentication on a loopback-only published port and a Docker volume. **This is a development configuration, not a production database setup.**

## Implemented and verified

| Capability                                                                                                                  | Status                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lighting-focused brand, responsive workspace, landing introduction and editable logo assets                                 | Implemented; desktop/mobile inspected                                                                                         |
| Manual product import, separate facts/copy, variants, prices, policies, HTTPS image references                              | Implemented and browser/API tested                                                                                            |
| CSV column mapping, paste, preview, mixed-product assignment/exclusion, empty/duplicate filtering                           | Implemented and tested                                                                                                        |
| Source type, ID, date, link, original product assignment and provenance                                                     | Persisted; exact excerpt tests                                                                                                |
| Findings, unique-record counts, breakdown, dates, transparent priority factors and sparse states                            | Rules by default; optional schema-grounded AI classification                                                                  |
| Clarification, description, bullet, FAQ and image-brief drafts                                                              | Generated from confirmed facts with a selected variant/tone; no product images generated                                      |
| Merchant editing, draft versions, rejection history, fact decisions and approval                                            | Persisted; role/claim/conflict tests                                                                                          |
| Safe approved HTML export, text copy and immutable approval snapshots                                                       | Implemented and tested; no external publishing                                                                                |
| Observational outcomes with source, definitions, dates, timezone, denominators and context                                  | Implemented and API tested; no causal uplift claims                                                                           |
| Tenant-scoped API, owner/editor/viewer checks, secure session cookies, rate limits, CSRF origin checks                      | Implemented; tenant and permission tests                                                                                      |
| Durable analysis queue with progress, cancellation, capped retries, idempotency and completion-based usage                  | Implemented and tested                                                                                                        |
| Managed OIDC with state, PKCE, nonce, signed identity, issuer/audience and verified-email checks                            | Implemented; mock-provider protocol tested, not connected to a live provider                                                  |
| Public URL extraction with pinned public DNS, HTTPS, redirect, time and size restrictions                                   | Implemented; SSRF and extraction fixtures tested. Successful external fetch is not validated under the current network policy |
| Shopify OAuth, token encryption/refresh, product import, description publishing, reconciliation and conflict-aware rollback | Implemented and protocol-tested with a simulated store; no live store validation                                              |
| Signed uninstall/privacy webhooks                                                                                           | Receipt/idempotency and shop-data erasure tested; customer requests remain a manual workflow and block production readiness   |
| Workspace JSON export and deletion                                                                                          | Implemented and tested                                                                                                        |

The public demo is isolated in browser memory and resets on reload. It never becomes a real organization or writes to the private database. Two of its product cards remain illustrative; Forma provides the interactive example.

## Analysis and data handling

Analysis defaults to **deterministic theme matching**. Optional server-side OpenAI grouping requires configured credentials/model and explicit owner consent. Only product category and redacted evidence UUID/type/text are sent; source excerpts and counts are rebuilt from validated real record IDs. New evidence imports disable consent until review. See `docs/ai.md` for the exact data boundary and failure behavior. No real model call has been made.

Drafting uses confirmed facts rather than model-created specifications. Choose a single variant to draft from its confirmed facts, with a product-level fallback. Incompatible variant facts cannot be approved in one draft. Tone changes add a short introduction while preserving fact wording, and save the prior draft before regeneration. Editing/export do not consume an analysis.

Battery evidence mentioning eight hours against a confirmed four-hour specification blocks approval of the affected fact until the merchant records a fact verification decision. Other unknown facts block automatic drafting. Custom edits require explicit whole-draft merchant verification and a written note; the application does not prove arbitrary edited prose true. Automatic contradiction detection is deliberately limited; merchants must review other conflicts manually.

The trial permits one completed analysis per UTC calendar month and 100 stored evidence records. Failed/cancelled jobs do not consume allowance; request keys prevent duplicate job creation and usage events are unique per completed job. Jobs run in-process from a durable database queue, with a single worker per deployment. Restarting that worker requeues interrupted rules jobs, with a three-attempt cap. Jobs whose provider invocation may have started are marked failed/uncertain and cannot automatically retry. Do not run multiple worker-bearing API instances until leases/heartbeats and separate worker roles are added.

Original evidence is stored only in the authenticated workspace. Suggested redactions cover common emails, numbers, order references and some street-address patterns; they do not identify every name/address. The preview requires merchant review. **No evidence is sent to an AI provider by default.** Configuring the optional adapter is not consent; the owner must review redactions and enable it. Provider costs/retention are separate from app usage. Request/error logs exclude message bodies. The app has no third-party analytics or crash collector.

## Validation

```sh
npm run lint
npm run typecheck
npm run build
npm test
npm run test:api
npm run test:e2e
```

API tests use a separate `cluecart_test` PostgreSQL database. Browser tests start their own API on 3002 against `cluecart_e2e`, plus Vite on 5180, and use `/usr/bin/chromium`. Set `CHROMIUM_PATH` if a different trusted browser is installed. `npm run db:local` creates the isolated test databases without removing existing data. Tests create and delete their own accounts. Test network adapters simulate Shopify and the identity provider; no third-party services or paid APIs are contacted.

## Managed authentication and deployment

`.env.example` contains variable names and non-secret development defaults. For production, configure `DATABASE_URL`, `NODE_ENV=production`, `PUBLIC_APP_URL` (HTTPS, no trailing slash), `OIDC_ISSUER`, `OIDC_CLIENT_ID` and, if the client requires it, `OIDC_CLIENT_SECRET`. Configure an identity provider supporting OIDC authorization code + PKCE, RS256/ES256 signed ID tokens, email claims and verified emails. Register the exact callback `<PUBLIC_APP_URL>/api/auth/callback`. Store secrets securely; do not put values in chat or source. Network policy must permit the issuer, token and JWKS hosts.

Build with `npm run build`. Run `npm run start:api` behind a same-origin HTTPS reverse proxy; serve `dist/` as static files with fallback to `index.html`, and proxy `/api/` to the loopback API. Preserve the public Host header for CSRF validation. There is no deployment in this task. Configure managed PostgreSQL transport security, least-privilege application/worker roles, encrypted disks/backups and a single worker process before production use. Current tenant isolation is enforced by authenticated server queries; RLS policies are provided as defense in depth for non-owner database roles. The local superuser bypasses RLS, and the queue worker currently needs a service role that can claim jobs across organizations.

## Retention and backups

Private workspace data remains in PostgreSQL until the owner deletes the workspace; nothing is deleted on allowance exhaustion. Deletion cascades through products, evidence, jobs, approvals, fact decisions, observations, usage, audit events, publications, encrypted Shopify tokens, OAuth state and privacy tasks, and removes account sessions and associated webhook receipts. JSON export does not contain password hashes or session tokens.

`npm run db:backup` writes a sensitive, owner-readable PostgreSQL dump to `/workspace/.cluecart-backups/cluecart.dump`, outside the checkout. `npm run db:restore` restores data transactionally and refuses to overwrite a database containing accounts or organizations; stop the API before restoring. Backup/restore was checked with an empty development database. Docker volumes and processes must not be assumed to survive a new cloud machine. Back up before publishing a snapshot if development data must be retained; restore deliberately into an empty migrated database in a new machine. Fresh-task restoration has not been verified.

There is no automated offsite backup, scheduled retention, point-in-time recovery, or private object storage yet. Before accepting production customer data, define backup encryption/access, retention periods, deletion propagation and restore tests. Removing live records does not remove previously exported files or backups; their owners must manage those copies.

## External integrations still needed

- **Shopify:** the connection/import/publishing adapter is implemented and tested with a simulated store. Live OAuth, publication, rollback and uninstall validation require registered app credentials and a development store; none have been used here. See `docs/shopify.md` for exact configuration, scopes, current official documentation and limitations. Customer privacy requests are securely queued for manual review/fulfillment; that operating process is not complete.

- **AI:** an OpenAI Responses structured-output adapter is implemented and tested with a mock provider, with configurable model, consent gating and no automatic retry of potentially billable calls. A real key/model, live proxy propagation, model behavior and actual billing remain unvalidated. See `docs/ai.md`. No generative product-claim drafting is enabled.

- **Storage:** product images are public HTTPS references; there is no private binary-upload service. Configure a private bucket and tenant-authorized object routes before accepting binary uploads.
- **Billing:** only trial counters are active. Current official docs direct new public apps to **Shopify App Pricing**, configured in the Partner Dashboard. No obsolete manual subscription flow was added. Configure test plans and subscription-entitlement synchronization after distribution and app registration; no sandbox lifecycle or live charge has been executed. Starter/Growth prices remain hypotheses, not available plans.

- **Outcome experiments:** comparisons are observational only. A randomized-test integration would need assignment, exposure logging, defined metrics/denominators, power analysis, contamination controls, and promotion/traffic context.

This is a working local core application, not a launch-ready or certified/compliant service. Live managed identity, external product fetching, real-store Shopify behavior, customer privacy-request fulfillment, live AI behavior, billing, object storage, multi-instance workers and production backup behavior remain unverified or unimplemented as described above.

Three scripts demonstrating actual workflows are in `docs/marketing-scripts.md`.
