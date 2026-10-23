import { useState, useEffect, type FormEvent } from "react";
import { ArrowUpRight, AlertCircle, CheckCircle2 } from "lucide-react";
async function call(path: string, body?: unknown) {
  const response = await fetch("/api" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(
      data.error ||
        "Shopify operation failed. Reconnect or contact your administrator.",
    );
  return data;
}
export function ShopifyPanel({
  mode = "settings",
  onImported,
  owner = true,
}: {
  mode?: "settings" | "import";
  onImported?: (id: string) => void;
  owner?: boolean;
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tasks, setTasks] = useState<any[]>([]),
    [payloads, setPayloads] = useState<Record<string, unknown>>({});
  useEffect(() => {
    call("/shopify/connection")
      .then(setState)
      .catch((e) => setError(e.message));
    if (mode === "settings" && owner)
      call("/shopify/privacy-tasks")
        .then(setTasks)
        .catch(() => {});
  }, [mode, owner]);
  async function importProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await call("/shopify/import", { id: f.get("id") });
      onImported?.(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shopify-section">
      <h3>
        {mode === "settings"
          ? "Shopify connection"
          : "3. Shopify product import"}
      </h3>
      {!state ? (
        <p>Checking connection…</p>
      ) : !state.configured ? (
        <p>
          Shopify setup is not complete. Your administrator needs to configure
          the app before connecting a store. Manual import and export remain
          available.
        </p>
      ) : (
        <>
          {state.connection && !state.connection.revoked ? (
            <p>
              <CheckCircle2 size={14} /> Connected to{" "}
              <strong>{state.connection.shop}</strong> ·{" "}
              {state.connection.scopes.includes("write_products")
                ? "Product description updates allowed"
                : "Read products only"}
            </p>
          ) : (
            <p>No active Shopify connection.</p>
          )}
          {owner && mode === "settings" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                location.assign(
                  "/api/shopify/connect?" +
                    new URLSearchParams({
                      shop: String(f.get("shop")),
                      write: f.get("write") === "on" ? "1" : "0",
                    }),
                );
              }}
            >
              <label className="field">
                <span>Shopify store domain</span>
                <input
                  name="shop"
                  defaultValue={state.connection?.shop || ""}
                  placeholder="your-store.myshopify.com"
                  pattern="[a-z0-9-]+\.myshopify\.com"
                  required
                />
              </label>
              <label className="confirmation">
                <input name="write" type="checkbox" /> Request permission to
                update product descriptions. Start with read-only import if you
                do not need publishing.
              </label>
              <button>
                Connect / review Shopify permissions <ArrowUpRight size={14} />
              </button>
            </form>
          )}
          {owner &&
            mode === "import" &&
            state.connection &&
            !state.connection.revoked && (
              <form onSubmit={importProduct}>
                <label className="field">
                  <span>Shopify product ID</span>
                  <input
                    name="id"
                    pattern="gid://shopify/Product/[0-9]+"
                    placeholder="gid://shopify/Product/123456789"
                    required
                  />
                </label>
                <button disabled={busy}>Import product from Shopify</button>
                <p className="muted">
                  Imports copy, images, prices and variants. Specifications
                  remain unconfirmed until you review them.
                </p>
              </form>
            )}
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {mode === "settings" && (
        <>
          <p className="muted">
            Live OAuth, publication, rollback and uninstall behavior have not
            been validated on a development store. Protocol tests use a
            simulated store. No connection is claimed until authorization
            succeeds.
          </p>
          <h4>Privacy requests</h4>
          {tasks.length ? (
            tasks.map((t) => (
              <p className="warning" key={t.id}>
                <AlertCircle size={15} /> {t.topic} · reference {t.request_ref}{" "}
                · Needs merchant review and fulfillment. Do not use this
                integration in production until the privacy workflow is
                operational.
              </p>
            ))
          ) : (
            <p className="muted">
              No privacy requests received. Customer requests require manual
              fulfillment; signed receipt is not proof of completion.
            </p>
          )}
          {tasks.map((t) => (
            <div key={"details-" + t.id}>
              <button
                onClick={() =>
                  call("/shopify/privacy-tasks/" + t.id)
                    .then((data) => setPayloads({ ...payloads, [t.id]: data }))
                    .catch((e) => setError(e.message))
                }
              >
                Review request {t.request_ref}
              </button>
              {payloads[t.id] !== undefined && (
                <pre className="privacy-payload">
                  {JSON.stringify(payloads[t.id], null, 2)}
                </pre>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
export function PublishingPanel({
  productID,
  approvalID,
  owner,
}: {
  productID: string;
  approvalID: string;
  owner: boolean;
}) {
  const [items, setItems] = useState<any[]>([]),
    [pending, setPending] = useState<any>(null),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setItems(await call(`/products/${productID}/publications`));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [productID]);
  const p = pending || items.find((x) => x.approval_id === approvalID);
  async function action(name: string) {
    setBusy(true);
    setError("");
    try {
      if (name === "prepare") {
        const next = await call(`/products/${productID}/publication-preview`, {
          approvalID,
        });
        setPending(next);
      } else {
        await call(`/publications/${p.id}/${name}`, {
          confirmed: checked,
          reviewDigest: name === "rollback" ? p.rollbackDigest : p.reviewDigest,
        });
        setPending(null);
        await load();
      }
      setChecked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publication failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="publication-panel">
      <h4>Shopify description update</h4>
      <p className="muted">
        This replaces the entire product description in the connected store.
        Only the exact approved description and destination below may be
        written.
      </p>
      {owner && (
        <button disabled={busy} onClick={() => action("prepare")}>
          Fetch current version & review destination
        </button>
      )}
      {p && (
        <>
          <p>
            <strong>Destination:</strong> {p.shop} ·{" "}
            {p.remote_id || p.snapshot.before.id} · descriptionHtml
          </p>
          <p>
            <strong>Status:</strong> {p.status}
          </p>
          <details open={p.status === "prepared"}>
            <summary>Exact current and proposed HTML</summary>
            <label>CURRENT REMOTE VERSION</label>
            <pre>{p.snapshot.before.descriptionHtml}</pre>
            <label>PROPOSED DESCRIPTION</label>
            <pre>{p.snapshot.proposedHtml}</pre>
          </details>
          {p.snapshot.note && <p className="warning">{p.snapshot.note}</p>}
          {owner && ["prepared", "published"].includes(p.status) && (
            <>
              <label className="confirmation">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />{" "}
                I approve this exact destination, field, and{" "}
                {p.status === "published"
                  ? "restoration of the previous content"
                  : "proposed content"}
                .
              </label>
              {p.status === "prepared" ? (
                <button
                  className="primary"
                  disabled={busy || !checked}
                  onClick={() => action("publish")}
                >
                  Publish approved description
                </button>
              ) : (
                <button
                  disabled={busy || !checked}
                  onClick={() => action("rollback")}
                >
                  Restore previous description
                </button>
              )}
            </>
          )}
          {owner &&
            [
              "uncertain",
              "publishing",
              "rolling_back",
              "rollback_uncertain",
            ].includes(p.status) && (
              <button disabled={busy} onClick={() => action("reconcile")}>
                Check remote state without writing
              </button>
            )}
          {["conflict", "rollback_conflict"].includes(p.status) && (
            <p className="warning">
              The remote product changed. Fetch and review a new version; this
              operation will not overwrite it.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </section>
  );
}
