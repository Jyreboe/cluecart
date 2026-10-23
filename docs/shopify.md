# Shopify connection and publishing

The server adapter is implemented; live Shopify behavior has **not** been validated. Protocol tests substitute a simulated Shopify token/GraphQL service. No real store has connected, no real product has changed, and no charge has been created.

## Current official guidance

Read on October 22, 2026:

- [Standalone authorization-code flow](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps): signed callback/state checks and expiring offline tokens, including refresh.
- [productUpdate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productUpdate): current `ProductUpdateInput` and `productUpdate(product:)`, `descriptionHtml`, product permissions and user errors. The default verified API version is `2026-10`, configurable with `SHOPIFY_API_VERSION`.
- [Privacy compliance webhooks](https://shopify.dev/docs/apps/build/privacy-law-compliance): signed requests, customer request topics and shop redaction.
- [App billing](https://shopify.dev/docs/apps/launch/billing): new public apps use Shopify App Pricing configured in the Partner Dashboard. This app has no billing API flow or active subscription. No sandbox subscription lifecycle has been tested.

The UI is a standalone web application. Shopify App Store distribution is the current planning assumption, pending confirmation and review of the actual registration/distribution requirements. It is not an embedded admin app and does not implement session-token exchange or a theme extension.

## Configure a development app

1. Register a development Shopify app. Register `<PUBLIC_APP_URL>/api/shopify/callback` as the exact HTTPS redirect. Register `/api/shopify/webhooks` for `app/uninstalled`, `customers/data_request`, `customers/redact`, and `shop/redact`.
2. Configure raw runtime `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 random bytes encoded as standard base64), `PUBLIC_APP_URL`, and optional `SHOPIFY_API_VERSION`. Keep secrets in an appropriate secret manager. Never paste values into chat or commit them. Proxy-only credential placeholders cannot perform local HMAC or AES operations and are insufficient for the app secret/encryption key.
3. Configure managed sign-in and a tenant-isolated production database before accepting real customer data. Allow the exact development store's `*.myshopify.com` hostname in environment settings (add the concrete store domain, not every store). The saved documentation-domain addition is `shopify.dev`. Provider/token/JWKS hosts also need access for managed identity.
4. In Settings, connect the actual `your-store.myshopify.com` domain. Start with `read_products`. No customer/order scope is requested. If publishing is needed, explicitly request `write_products` in the permission form; the write grant also satisfies product read permission.
5. Import by Shopify product GID from Add product. Imports preserve variant IDs/prices/copy/image references, but **do not promote imported marketing text or customer statements into confirmed specifications**. Check facts before drafting.
6. Run the real development-store checks below before considering any launch.

One Shopify shop is bound to one workspace. Tokens and refresh credentials are AES-256-GCM encrypted with organization/shop-associated context, not returned by API exports or connection metadata. Preserve the encryption key securely for token/privacy-task recovery; changing it without a migration requires reconnecting stores and can make pending encrypted request payloads unreadable.

## Exact review and publication

Only an owner can approve or publish. A publication requires an approved description for a product imported from the connected shop. The server checks that approved product facts still match current confirmed facts, then fetches the current remote HTML/version and saves a prepared receipt. The interface shows the actual shop, product GID, field, current HTML and proposed HTML. **The write replaces the entire description field**; review existing content before proceeding. FAQs and image briefs are not installed into themes.

The publish action requires explicit confirmation of the exact prepared receipt. It rechecks local facts and immediately re-fetches the remote product. Any description or `updatedAt` change produces a conflict and stops the write. Successful receipts retain the prior version, actual resulting version and timestamps. Repeated requests return an existing success receipt rather than repeating the mutation.

Shopify's description mutation does not offer compare-and-set for the remote version. There is a remaining external-edit window between the final read and write; application-level serialization cannot eliminate it. Avoid concurrent editing during application and validate the behavior with a real development store. This is not a claim of atomic conflict prevention.

If a mutation times out or its response differs from the requested content, the operation becomes uncertain and will **not** automatically repeat the write. Reconciliation only reads Shopify and reports whether the desired content is present; it does not claim the app caused an already-matching state. Rollback requires a separate exact confirmation and checks the current remote version against the saved post-publication version before restoring. Intervening edits cause rollback conflict.

## Webhooks and privacy limits

Raw webhook bodies are HMAC-verified; invalid signatures return 401. Receipt IDs prevent duplicate processing. Uninstall immediately invalidates stored access/refresh credentials. A signed shop-redaction webhook deletes imported product data and dependent evidence, jobs, drafts, approvals, publication receipts and measurements, erases the shop connection/privacy tasks, resets store-specific preferences and removes shop domains from technical delivery receipts. The independent merchant account remains available.

Customer data-request/redaction webhooks create owner-visible manual tasks. Original request payloads are encrypted with tenant/task-associated context and accessible only to the owner, so the requester can be identified during review. These tasks are **not automatically fulfilled**. A documented, tested process for identifying records, exporting only the relevant customer's information, deleting personal information from live records and historical copies, and handling backups must be completed before production use. Receiving a webhook is not proof of compliance. Do not launch the Shopify integration with this process unresolved.

## Verification boundary

Automated simulated-store checks cover callback HMAC/state, encrypted token isolation, expiring-token refresh, idempotent product import, exact approval, case-only external edits, successful publication, repeated publication, rollback and rollback conflicts, ambiguous-write reconciliation, changed local facts, signature rejection, duplicate privacy receipts, uninstall revocation and shop-data erasure.

Still unrun: actual app installation, real provider token lifecycle, live product import/publication/reconciliation/rollback, Shopify's actual HTML normalization and API behavior, development-theme testing, customer privacy fulfillment, Shopify App Pricing sandbox subscriptions and entitlement lifecycle. No live functionality is described as validated.
