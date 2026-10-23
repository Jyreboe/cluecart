import { useState, useEffect, useRef, type FormEvent } from "react";
import Papa from "papaparse";
import {
  Layers,
  MessageSquare,
  History,
  Settings,
  Plus,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Download,
  LogOut,
  FileText,
  Check,
} from "lucide-react";
import { Logo, Lamp } from "./branding";
import { AISettings } from "./AISettings";
import { ShopifyPanel, PublishingPanel } from "./ShopifyPanel";
const topics = [
  "size",
  "materials",
  "assembly",
  "placement",
  "power",
  "dimming",
  "care",
  "shipping",
  "returns",
  "other",
];
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "The request failed.");
  return data;
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function saveFile(data: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
const defaultProduct = {
  title: "",
  description: "",
  price: 0,
  currency: "USD",
  category: "Lighting",
  sourceURL: "",
  images: [],
  variants: [],
  policies: "",
  facts: [],
};
export function MerchantApp() {
  const [me, setMe] = useState<any>(null),
    [auth, setAuth] = useState<any>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [register, setRegister] = useState(false),
    [tab, setTab] = useState("Products"),
    [list, setList] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<any>(null),
    [screen, setScreen] = useState("list"),
    [theme, setTheme] = useState(""),
    [draftVariant, setDraftVariant] = useState(""),
    [draft, setDraft] = useState<any>(null),
    [facts, setFacts] = useState<any[]>([]),
    [csvRows, setCsvRows] = useState<any[]>([]),
    [columns, setColumns] = useState<Record<string, string>>({
      text: "text",
      sourceID: "id",
      type: "type",
      product: "product",
      date: "date",
      rating: "rating",
      link: "link",
    }),
    [preview, setPreview] = useState<any[]>([]),
    [pasted, setPasted] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [notice, setNotice] = useState(""),
    [importProduct, setImportProduct] = useState<any>(defaultProduct),
    [specs, setSpecs] = useState(""),
    [variantLines, setVariantLines] = useState(""),
    [imageLines, setImageLines] = useState("");
  const selectedRef = useRef("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const refreshMe = async () => setMe(await api("/me"));
  const loadList = async () => setList(await api("/products"));
  const load = async (id = selected) => {
    const d = await api("/products/" + id);
    if (selectedRef.current !== id) return d;
    setView(d);
    setFacts(d.product.facts);
    return d;
  };
  useEffect(() => {
    Promise.all([
      api("/auth/config").then(setAuth),
      api("/me")
        .then(setMe)
        .catch(() => {}),
    ])
      .catch((e) => setError("The workspace API is unavailable. " + e.message))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (me) loadList().catch((e) => setError(e.message));
  }, [me]);

  const activeJob = view?.jobs?.find((j: any) =>
    ["queued", "running"].includes(j.status),
  );
  useEffect(() => {
    if (!activeJob || !selected) return;
    const timer = setInterval(() => {
      load(selected)
        .then(() => refreshMe())
        .catch((e) => setError(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeJob?.id, selected]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api(register ? "/auth/register" : "/auth/login", "POST", {
        email: form.get("email"),
        password: form.get("password"),
      });
      await refreshMe();
    });
  }
  function openProduct(id: string) {
    selectedRef.current = id;
    setSelected(id);
    setScreen("detail");
    setTheme("");
    setDraftVariant("");
    setDraft(null);
    setTab("Products");
    setView(null);
    load(id).catch((e) => setError(e.message));
    setError("");
  }
  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const variants = variantLines
        .split("\n")
        .filter((v) => v.trim())
        .map((v) => {
          const [id, title, price] = v.split("|");
          if (price?.trim() && !Number.isFinite(Number(price)))
            throw Error("Enter a numeric variant price.");
          return {
            id: id.trim(),
            title: title?.trim() || id.trim(),
            price: price?.trim() ? Number(price) : null,
          };
        });
      const confirmed = form.get("confirmed") === "on";
      const facts = specs
        .split("\n")
        .filter((v) => v.trim())
        .map((v) => {
          const [topic, value, variant = ""] = v.split("|");
          if (!topics.includes(topic.trim()) || !value?.trim())
            throw Error(
              "Use topic | confirmed detail | optional variant ID on each specification line.",
            );
          return {
            id: crypto.randomUUID(),
            topic: topic.trim(),
            value: value.trim(),
            variant: variant.trim(),
            confirmed,
            verificationNote: "",
          };
        });
      const result = await api("/products", "POST", {
        ...importProduct,
        price: Number(importProduct.price),
        facts,
        variants,
        images: imageLines
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      await loadList();
      openProduct(result.id);
      setImportProduct(defaultProduct);
      setSpecs("");
      setVariantLines("");
      setImageLines("");
      setNotice("Product imported. Facts remain separate from marketing copy.");
    });
  }
  function preparePreview() {
    setError("");
    try {
      const rows = csvRows.length
        ? csvRows.map((r) => ({
            sourceID: r[columns.sourceID] || "",
            text: r[columns.text] || "",
            type: r[columns.type] || "Pasted",
            product: r[columns.product] || "",
            date: r[columns.date] || "",
            rating: r[columns.rating] ? Number(r[columns.rating]) : null,
            link: r[columns.link] || "",
          }))
        : pasted.split("\n").map((text) => ({
            sourceID: "",
            text,
            type: "Pasted",
            product: "",
            date: "",
            rating: null,
            link: "",
          }));
      const seen = new Set();
      setPreview(
        rows
          .filter((r) => {
            const key = String(r.text)
              .trim()
              .toLowerCase()
              .replace(/\s+/g, " ");
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((r, i) => ({
            ...r,
            key: i,
            include:
              !r.product || [selected, view.product.title].includes(r.product),
            originalProduct: r.product,
            redacted: r.text
              .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email redacted]")
              .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[number redacted]")
              .replace(
                /\b(?:order|reference)\s*#?\s*[a-z0-9-]{4,}/gi,
                "[order redacted]",
              ),
          })),
      );
      setReviewed(false);
    } catch {
      setError("Could not read these records. Review the mapping.");
    }
  }
  const analysis = view?.jobs?.find(
    (j: any) => j.status === "completed",
  )?.result;
  const finding =
    analysis?.findings?.find((f: any) => f.id === theme) ||
    analysis?.findings?.[0];
  async function generate(kind: string, tone = me.organization.tone) {
    await run(async () => {
      const result = await api(`/products/${selected}/draft-preview`, "POST", {
        theme: finding.id,
        kind,
        tone,
        variant: draftVariant,
      });
      if (result.blocked) throw Error(result.text);
      if (draft) {
        await api(`/products/${selected}/drafts`, "POST", draft);
        await load();
        setNotice("Previous wording saved as a draft version.");
      }
      setDraft({
        kind,
        text: result.text,
        factIDs: result.factIDs,
        recordIDs: finding.recordIDs,
        merchantVerified: false,
        verificationNote: "",
        tone,
        rejected: false,
      });
    });
  }
  async function approve() {
    await run(async () => {
      const saved = await api(`/products/${selected}/drafts`, "POST", draft);
      await api(`/products/${selected}/approve`, "POST", { draftID: saved.id });
      await load();
      setNotice(
        "Exact draft approved. Its evidence and fact snapshots are saved. Nothing was published.",
      );
    });
  }
  function navigate(name: string) {
    setTab(name);
    setScreen("list");
    setError("");
    if (name === "Products") loadList().catch((e) => setError(e.message));
  }
  if (checking)
    return (
      <div className="auth-shell">
        <Logo />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!me)
    return (
      <div className="auth-shell">
        <a href="/">
          <Logo />
        </a>
        <div className="auth-card">
          <span className="eyebrow">YOUR EVIDENCE, YOUR WORKSPACE</span>
          <h1>{register ? "Start with one product." : "Welcome back."}</h1>
          <p>
            Sign in to import products and keep your evidence, drafts, and
            decisions together.
          </p>
          {auth?.managed && (
            <a className="button primary full" href="/api/auth/managed">
              Continue with your identity provider <ArrowRight size={16} />
            </a>
          )}
          {auth?.development && (
            <>
              <div className="warning">
                <AlertCircle size={18} />
                <div>
                  <strong>Local development authentication</strong>
                  <p>
                    For local testing only. Production requires a managed
                    identity provider. Do not use a password you use elsewhere.
                  </p>
                </div>
              </div>
              <form onSubmit={login}>
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                  />
                </Field>
                <Field label="Development password (12+ characters)">
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    required
                  />
                </Field>
                <button className="primary full" disabled={busy}>
                  {register ? "Create local account" : "Sign in"}
                </button>
              </form>
              <button
                className="text-button full"
                onClick={() => setRegister(!register)}
              >
                {register
                  ? "Already have an account? Sign in"
                  : "Create a local development account"}
              </button>
            </>
          )}
          {auth && !auth.managed && !auth.development && (
            <p>
              Authentication is not configured. An administrator must configure
              managed sign-in before importing data.
            </p>
          )}
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          <a className="back-link" href="/">
            Explore the demo without an account <ArrowRight size={15} />
          </a>
        </div>
      </div>
    );
  return (
    <>
      <aside>
        <a className="brand" href="/">
          <Logo />
        </a>
        <div className="store">
          <span className="store-icon">{me.organization.name[0]}</span>
          <div>
            {me.organization.name}
            <small>Private workspace · {me.role}</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            ["Products", Layers],
            ["Evidence", MessageSquare],
            ["Changes", History],
            ["Settings", Settings],
          ].map(([name, Icon]: any) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              {name}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="demo-note">
            <strong>{me.usage.plan} workspace</strong>
            <p>
              {me.usage.analyses} / {me.usage.limit} monthly analyses
              <br />
              Up to {me.usage.evidenceLimit} evidence records
              <br />
              Resets {new Date(me.usage.resetAt).toLocaleDateString()} (UTC)
            </p>
            <p>Editing and export do not consume an analysis.</p>
          </div>
          <button
            className="profile"
            onClick={() =>
              run(async () => {
                await api("/auth/logout", "POST");
                location.reload();
              })
            }
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="merchant-main">
        <header>
          <span>
            Workspace <span className="slash">/</span>
            {tab}
            {view && selected && screen === "detail" && (
              <> / {view.product.title}</>
            )}
          </span>
          <span className="account-email">{me.email}</span>
        </header>
        {error && (
          <div className="error-box" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="success-box" role="status">
            <CheckCircle2 size={17} />
            {notice}
            <button onClick={() => setNotice("")}>Dismiss</button>
          </div>
        )}
        {tab === "Settings" ? (
          <>
            <div className="page-heading">
              <div>
                <h1>A workspace that keeps the context.</h1>
                <p>Store preferences, connections, and your data.</p>
              </div>
            </div>
            <div className="settings">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(async () => {
                    await api("/organization", "PATCH", {
                      name: f.get("name"),
                      category: f.get("category"),
                      tone: f.get("tone"),
                      storeURL: f.get("url"),
                    });
                    await refreshMe();
                    setNotice("Store preferences saved.");
                  });
                }}
              >
                <Field label="Store name">
                  <input
                    name="name"
                    defaultValue={me.organization.name}
                    required
                    maxLength={150}
                  />
                </Field>
                <Field label="Optional public store URL">
                  <input
                    name="url"
                    type="url"
                    defaultValue={me.organization.store_url || ""}
                    placeholder="https://your-store.example"
                  />
                </Field>
                <Field label="Category">
                  <select
                    name="category"
                    defaultValue={me.organization.category}
                  >
                    <option>Lighting</option>
                    <option>Home décor</option>
                  </select>
                </Field>
                <Field label="Preferred writing tone">
                  <select name="tone" defaultValue={me.organization.tone}>
                    <option>Warm & straightforward</option>
                    <option>Concise & practical</option>
                    <option>Calm & considered</option>
                  </select>
                </Field>
                <button className="primary" disabled={busy}>
                  Save preferences
                </button>
              </form>
              <hr />
              <h3>Connections</h3>
              <p>
                PostgreSQL: connected · Authentication:{" "}
                {auth?.managed
                  ? "managed provider configured"
                  : "local development only"}
                .
              </p>
              <ShopifyPanel owner={me.role === "owner"} />
              <AISettings owner={me.role === "owner"} />
              <p>
                Rules are the default, with optional consent-based AI grouping.
                Drafts use confirmed facts. No private object storage is
                configured; images are public HTTPS references.
              </p>
              <h3>Subscription</h3>
              <p>
                Trial allowance only. No billing integration or charges. Starter
                ($39) and Growth ($99) remain pricing hypotheses, not active
                subscriptions.
              </p>
              <hr />
              <h3>Your data</h3>
              <p>
                Data persists in the local PostgreSQL volume. Export before
                deleting. Deletion removes the workspace, evidence, drafts,
                jobs, approvals, measurements, and account sessions. Backups
                need a separately configured retention policy.
              </p>
              <a className="button" href="/api/export">
                <Download size={15} /> Export workspace JSON
              </a>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(async () => {
                    await api("/account", "DELETE", {
                      confirmation: f.get("confirmation"),
                    });
                    location.reload();
                  });
                }}
              >
                <Field label="Type DELETE MY WORKSPACE to delete your account and workspace">
                  <input
                    name="confirmation"
                    required
                    pattern="DELETE MY WORKSPACE"
                  />
                </Field>
                <button disabled={busy}>Permanently delete workspace</button>
              </form>
            </div>
          </>
        ) : screen === "import" ? (
          <>
            <div className="page-heading">
              <div>
                <button className="back" onClick={() => setScreen("list")}>
                  <ArrowLeft size={15} /> Products
                </button>
                <h1>Start with what you know.</h1>
                <p>Import product copy, then add confirmed facts separately.</p>
              </div>
            </div>
            <div className="import-layout">
              <form className="settings" onSubmit={addProduct}>
                <Field label="Product title">
                  <input
                    value={importProduct.title}
                    onChange={(e) =>
                      setImportProduct({
                        ...importProduct,
                        title: e.target.value,
                      })
                    }
                    required
                    maxLength={200}
                  />
                </Field>
                <Field label="Current description (marketing copy)">
                  <textarea
                    value={importProduct.description}
                    onChange={(e) =>
                      setImportProduct({
                        ...importProduct,
                        description: e.target.value,
                      })
                    }
                  />
                </Field>
                <div className="form-row">
                  <Field label="Price">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={importProduct.price}
                      onChange={(e) =>
                        setImportProduct({
                          ...importProduct,
                          price: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Currency">
                    <input
                      pattern="[A-Z]{3}"
                      value={importProduct.currency}
                      onChange={(e) =>
                        setImportProduct({
                          ...importProduct,
                          currency: e.target.value.toUpperCase(),
                        })
                      }
                      required
                    />
                  </Field>
                </div>
                <Field label="Category">
                  <select
                    value={importProduct.category}
                    onChange={(e) =>
                      setImportProduct({
                        ...importProduct,
                        category: e.target.value,
                      })
                    }
                  >
                    <option>Lighting</option>
                    <option>Home décor</option>
                  </select>
                </Field>
                <Field label="Source URL (optional)">
                  <input
                    type="url"
                    value={importProduct.sourceURL}
                    onChange={(e) =>
                      setImportProduct({
                        ...importProduct,
                        sourceURL: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Variants: one ID | name | optional price per line">
                  <textarea
                    value={variantLines}
                    onChange={(e) => setVariantLines(e.target.value)}
                    placeholder="small | Small lamp"
                  />
                </Field>
                <Field label="Specifications: topic | fact | optional variant ID">
                  <textarea
                    required
                    value={specs}
                    onChange={(e) => setSpecs(e.target.value)}
                    placeholder={
                      "size | 28 cm tall and 16 cm wide\npower | Up to four hours at full brightness\nsize | 20 cm tall | small"
                    }
                  />
                </Field>
                <p className="muted">
                  Topics: {topics.join(", ")}. Variant facts remain attached to
                  their variant; drafts will not combine variants.
                </p>
                <Field label="Public HTTPS image URLs, one per line">
                  <textarea
                    value={imageLines}
                    onChange={(e) => setImageLines(e.target.value)}
                  />
                </Field>
                <Field label="Merchant-supplied shipping and return policies">
                  <textarea
                    value={importProduct.policies}
                    onChange={(e) =>
                      setImportProduct({
                        ...importProduct,
                        policies: e.target.value,
                      })
                    }
                  />
                </Field>
                <label className="confirmation">
                  <input type="checkbox" name="confirmed" /> I have checked
                  these specifications against my product information.
                </label>
                <button className="primary" disabled={busy}>
                  <Plus size={16} /> Import product
                </button>
              </form>
              <div className="settings">
                <h2>Three ways to start.</h2>
                <h3>1. Manual entry</h3>
                <p>
                  Works without Shopify or AI credentials. Describe one product
                  and keep confirmed specifications separate from copy.
                </p>
                <h3>2. Public product URL</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      const r = await api("/import-url", "POST", {
                        url: f.get("url"),
                      });
                      setImportProduct(r.extracted);
                      setNotice(
                        "Public metadata extracted. Review every field before importing. No specifications were assumed.",
                      );
                    });
                  }}
                >
                  <Field label="Public HTTPS product URL">
                    <input type="url" name="url" required />
                  </Field>
                  <button disabled={busy}>Extract for review</button>
                </form>
                <p className="muted">
                  Public HTML only. Private addresses, unsafe redirects, large
                  responses, and access-controlled pages are rejected.
                </p>
                <ShopifyPanel
                  mode="import"
                  owner={me.role === "owner"}
                  onImported={(id) => {
                    loadList();
                    openProduct(id);
                  }}
                />
              </div>
            </div>
          </>
        ) : screen === "detail" && view ? (
          <>
            <div className="page-heading">
              <div>
                <button
                  className="back"
                  onClick={() => {
                    setScreen("list");
                    loadList();
                  }}
                >
                  <ArrowLeft size={15} /> Products
                </button>
                <h1>{view.product.title}</h1>
                <p>
                  {view.product.category} · {view.product.currency}{" "}
                  {view.product.price.toFixed(2)} · Imported{" "}
                  {new Date(view.product.importedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => {
                  setTab("Evidence");
                  setScreen("detail");
                }}
              >
                <Plus size={16} /> Add evidence
              </button>
            </div>
            {tab === "Evidence" ? (
              EvidencePanel()
            ) : tab === "Changes" ? (
              ChangesPanel()
            ) : (
              <>
                <div className="workspace-tabs">
                  <button
                    className="chosen"
                    onClick={() => setScreen("detail")}
                  >
                    Findings & drafts
                  </button>
                  <button onClick={() => setScreen("facts")}>
                    Confirmed facts
                  </button>
                  <button
                    disabled={busy || !!activeJob}
                    onClick={() =>
                      run(async () => {
                        await api(`/products/${selected}/analyses`, "POST", {
                          requestKey: crypto.randomUUID(),
                        });
                        await load();
                      })
                    }
                  >
                    {activeJob ? "Analysis queued…" : "Analyze evidence"}
                  </button>
                </div>
                {activeJob && (
                  <p role="status" className="success-box">
                    {activeJob.status} · {activeJob.progress}%{" "}
                    <button
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/products/${selected}/jobs/${activeJob.id}/cancel`,
                            "POST",
                          );
                          await load();
                        })
                      }
                    >
                      Cancel job
                    </button>
                  </p>
                )}
                {view.jobs
                  .filter((j: any) => j.status === "failed")
                  .slice(0, 1)
                  .map((j: any) => (
                    <div className="error-box" key={j.id}>
                      {j.error}
                      <button
                        disabled={j.attempts >= 3 || !j.retryable}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/products/${selected}/jobs/${j.id}/retry`,
                              "POST",
                            );
                            await load();
                          })
                        }
                      >
                        Retry job
                      </button>
                    </div>
                  ))}
                {!analysis ? (
                  <div className="empty">
                    <MessageSquare size={30} />
                    <h2>First, bring the customer’s words.</h2>
                    <p>
                      {view.records.length} evidence records imported. Run
                      analysis when you are ready. One completed job uses one
                      trial analysis; failures and edits do not.
                    </p>
                    <button
                      onClick={() => {
                        setTab("Evidence");
                        setScreen("detail");
                      }}
                    >
                      Add evidence <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="engine-note">
                      {analysis.engine} · Snapshot of {analysis.recordCount}{" "}
                      records ·{" "}
                      {new Date(analysis.generatedAt).toLocaleString()}. New
                      imports require a new analysis.
                    </p>
                    {analysis.sparse && (
                      <div className="warning">
                        <AlertCircle size={18} />
                        <div>
                          <strong>Evidence is sparse.</strong>
                          <p>
                            These records do not establish how common a concern
                            is among all customers.
                          </p>
                          <strong>Page-only observations</strong>
                          {analysis.pageOnly.map((s: string) => (
                            <p key={s}>{s}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="editor">
                      <section>
                        <div className="section-title">
                          <h3>Review the evidence</h3>
                          <span>{analysis.findings.length} themes</span>
                        </div>
                        {analysis.findings.map((f: any) => (
                          <button
                            className={
                              "finding " +
                              (finding?.id === f.id ? "selected" : "")
                            }
                            key={f.id}
                            onClick={() => setTheme(f.id)}
                          >
                            <span className="priority">
                              {f.priority} recommendation priority
                            </span>
                            <h3>{f.title}</h3>
                            <p>
                              {f.count} of {f.total} imported records
                            </p>
                            <span className="mini-link">
                              {f.addressed
                                ? "Page includes confirmed fact"
                                : "Check the page answer"}{" "}
                              <ArrowRight size={13} />
                            </span>
                          </button>
                        ))}
                        {finding && (
                          <div className="source-panel">
                            <h4>Exact source excerpts</h4>
                            <p className="muted">
                              {Object.entries(finding.breakdown)
                                .filter(([, n]) => Number(n) > 0)
                                .map(([k, n]) => `${n} ${k}`)
                                .join(" · ")}
                            </p>
                            {finding.dates.length > 0 && (
                              <p className="muted">
                                {finding.dates.join(" — ")}
                              </p>
                            )}
                            {finding.excerpts.map((r: any) => (
                              <blockquote key={r.id}>
                                {r.text}
                                <footer>
                                  <a
                                    href={"#source-" + r.id}
                                    onClick={() => setTab("Evidence")}
                                  >
                                    {r.type} · {r.id.slice(0, 8)}
                                  </a>
                                  {r.link && (
                                    <>
                                      {" "}
                                      ·{" "}
                                      <a
                                        href={r.link}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Source link
                                      </a>
                                    </>
                                  )}
                                </footer>
                              </blockquote>
                            ))}
                            <h4>Why this priority?</h4>
                            <p className="muted">
                              Recurrence: {finding.count}; buying relevance:{" "}
                              {finding.factors.buyingRelevance
                                ? "yes"
                                : "context only"}
                              ; page answers:{" "}
                              {finding.addressed ? "yes" : "check needed"};
                              confirmed facts: {finding.confirmedFacts.length};
                              effort: {finding.factors.effort}. This is not a
                              conversion forecast.
                            </p>
                          </div>
                        )}
                      </section>
                      <section>
                        <div className="section-title">
                          <h3>Proposed content</h3>
                          <FileText size={17} />
                        </div>
                        <div className="draft-body">
                          {finding ? (
                            <>
                              <h2>{finding.nextAction}</h2>
                              {finding.verification && (
                                <div className="warning">
                                  <AlertCircle size={17} />
                                  <p>
                                    {finding.verification}{" "}
                                    <button onClick={() => setScreen("facts")}>
                                      Review facts
                                    </button>
                                  </p>
                                </div>
                              )}
                              {view.product.variants.length > 0 && (
                                <Field label="Draft for a variant">
                                  <select
                                    value={draftVariant}
                                    onChange={(e) =>
                                      setDraftVariant(e.target.value)
                                    }
                                  >
                                    <option value="">
                                      Product-level facts
                                    </option>
                                    {view.product.variants.map((v: any) => (
                                      <option key={v.id} value={v.id}>
                                        {v.title}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                              )}
                              <Field label="Generate from confirmed facts">
                                <select
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value)
                                      generate(e.target.value);
                                    e.target.value = "";
                                  }}
                                >
                                  <option value="">
                                    Choose a content type
                                  </option>
                                  {[
                                    "Clarification",
                                    "Short description",
                                    "Benefit bullets",
                                    "FAQ",
                                    "Image brief",
                                  ].map((k) => (
                                    <option key={k}>{k}</option>
                                  ))}
                                </select>
                              </Field>
                              {draft && (
                                <>
                                  <Field label="Edit your draft">
                                    <textarea
                                      value={draft.text}
                                      onChange={(e) =>
                                        setDraft({
                                          ...draft,
                                          text: e.target.value,
                                          merchantVerified: false,
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field label="Preferred tone (saved with version)">
                                    <select
                                      value={draft.tone}
                                      onChange={(e) =>
                                        setDraft({
                                          ...draft,
                                          tone: e.target.value,
                                        })
                                      }
                                    >
                                      <option>Warm & straightforward</option>
                                      <option>Concise & practical</option>
                                      <option>Calm & considered</option>
                                    </select>
                                  </Field>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      generate(draft.kind, draft.tone)
                                    }
                                  >
                                    Draft in this tone
                                  </button>
                                  <p className="muted">
                                    Tone changes use a short introduction and
                                    preserve confirmed fact wording. The current
                                    draft is saved before regeneration.
                                  </p>
                                  <h4>Claim provenance</h4>
                                  {draft.factIDs.map((id: string) => (
                                    <p className="fact" key={id}>
                                      {view.product.facts.find(
                                        (f: any) => f.id === id,
                                      )?.value ||
                                        "Fact no longer available"}{" "}
                                      · Merchant confirmed
                                    </p>
                                  ))}
                                  <Field label="Record how you verified this exact draft">
                                    <textarea
                                      placeholder="Checked dimensions against the product specification…"
                                      value={draft.verificationNote}
                                      onChange={(e) =>
                                        setDraft({
                                          ...draft,
                                          verificationNote: e.target.value,
                                          merchantVerified: false,
                                        })
                                      }
                                    />
                                  </Field>
                                  <label className="confirmation">
                                    <input
                                      type="checkbox"
                                      checked={draft.merchantVerified}
                                      onChange={(e) =>
                                        setDraft({
                                          ...draft,
                                          merchantVerified: e.target.checked,
                                        })
                                      }
                                    />{" "}
                                    I verified every factual claim in this exact
                                    text. Customer statements are not
                                    specifications.
                                  </label>
                                  <button
                                    className="primary full"
                                    disabled={busy || me.role !== "owner"}
                                    onClick={approve}
                                  >
                                    <Check size={16} /> Approve this change
                                  </button>
                                  <button
                                    className="full"
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `/products/${selected}/drafts`,
                                          "POST",
                                          draft,
                                        );
                                        await load();
                                        setNotice(
                                          "Draft version saved without approval.",
                                        );
                                      })
                                    }
                                  >
                                    Save draft version
                                  </button>
                                  <button
                                    className="full"
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `/products/${selected}/drafts`,
                                          "POST",
                                          { ...draft, rejected: true },
                                        );
                                        setDraft(null);
                                        await load();
                                        setNotice(
                                          "Rejection recorded. No allowance consumed.",
                                        );
                                      })
                                    }
                                  >
                                    Reject draft
                                  </button>
                                </>
                              )}
                            </>
                          ) : (
                            <p>
                              No recurring themes found. Check your confirmed
                              facts before drafting page-only improvements.
                            </p>
                          )}
                        </div>
                      </section>
                      <section>
                        <div className="section-title">
                          <h3>Compare changes</h3>
                        </div>
                        <div className="comparison">
                          <label>CURRENT DESCRIPTION</label>
                          <p>
                            {view.product.description ||
                              "No description imported."}
                          </p>
                          <hr />
                          <label>PROPOSED ADDITION</label>
                          <div className="addition">
                            {draft?.text ||
                              "Select a finding and draft from confirmed facts."}
                          </div>
                          {draft && (
                            <button
                              className="full"
                              onClick={() =>
                                run(async () => {
                                  await navigator.clipboard.writeText(
                                    draft.text,
                                  );
                                  setNotice(
                                    "Draft text copied. Review before applying it.",
                                  );
                                })
                              }
                            >
                              Copy draft text
                            </button>
                          )}
                          <h4>Saved draft versions</h4>
                          {view.drafts.map((d: any) => (
                            <button
                              className="saved-draft"
                              key={d.id}
                              onClick={() => setDraft(d.data)}
                            >
                              {d.data.rejected ? "Rejected" : "Draft"} ·{" "}
                              {d.data.kind} ·{" "}
                              {new Date(d.updated_at).toLocaleString()}
                            </button>
                          ))}
                          <div className="measurement">
                            {view.outcomes.length
                              ? "Observational comparisons saved"
                              : "No measurement connected"}
                            <small>
                              Export approved content from Changes. No Shopify
                              write will occur.
                            </small>
                          </div>
                        </div>
                      </section>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        ) : screen === "facts" && view ? (
          <>
            <div className="page-heading">
              <div>
                <button className="back" onClick={() => setScreen("detail")}>
                  <ArrowLeft size={15} /> Product workspace
                </button>
                <h1>Confirm this product detail.</h1>
                <p>
                  Record the facts you can stand behind, including
                  variant-specific limits.
                </p>
              </div>
            </div>
            <div className="settings">
              {facts.map((f: any, i: number) => (
                <div className="fact-editor" key={f.id}>
                  <Field label="Topic">
                    <select
                      value={f.topic}
                      onChange={(e) =>
                        setFacts(
                          facts.map((x, j) =>
                            j === i ? { ...x, topic: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      {topics.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Product fact">
                    <textarea
                      value={f.value}
                      onChange={(e) =>
                        setFacts(
                          facts.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  value: e.target.value,
                                  confirmed: false,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Variant">
                    <select
                      value={f.variant}
                      onChange={(e) =>
                        setFacts(
                          facts.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  variant: e.target.value,
                                  confirmed: false,
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="">All variants / product-level</option>
                      {view.product.variants.map((v: any) => (
                        <option value={v.id} key={v.id}>
                          {v.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Verification decision / conflicting source resolution">
                    <input
                      value={f.verificationNote || ""}
                      onChange={(e) =>
                        setFacts(
                          facts.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  verificationNote: e.target.value,
                                  confirmed: false,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <label className="confirmation">
                    <input
                      type="checkbox"
                      checked={f.confirmed}
                      onChange={(e) =>
                        setFacts(
                          facts.map((x, j) =>
                            j === i ? { ...x, confirmed: e.target.checked } : x,
                          ),
                        )
                      }
                    />{" "}
                    Confirmed by merchant
                    {f.confirmedAt
                      ? " · " + new Date(f.confirmedAt).toLocaleString()
                      : ""}
                  </label>
                </div>
              ))}
              <button
                onClick={() =>
                  setFacts([
                    ...facts,
                    {
                      id: crypto.randomUUID(),
                      topic: "other",
                      value: "",
                      variant: "",
                      confirmed: false,
                      verificationNote: "",
                    },
                  ])
                }
              >
                <Plus size={15} /> Add fact
              </button>{" "}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/products/${selected}/facts`, "PATCH", {
                      facts,
                    });
                    await load();
                    setNotice("Fact decisions saved with timestamps.");
                  })
                }
              >
                Save fact decisions
              </button>
              <hr />
              <h3>Verification history</h3>
              {view.factDecisions?.map((d: any) => (
                <details key={d.id}>
                  <summary>{new Date(d.created_at).toLocaleString()}</summary>
                  {d.snapshot.map((f: any) => (
                    <p key={f.id}>
                      {f.topic}: {f.value} ·{" "}
                      {f.confirmed ? "Confirmed" : "Needs verification"}
                      {f.verificationNote ? " · " + f.verificationNote : ""}
                    </p>
                  ))}
                </details>
              ))}
            </div>
          </>
        ) : tab === "Evidence" || tab === "Changes" ? (
          <>
            <div className="page-heading">
              <div>
                <h1>
                  {tab === "Evidence"
                    ? "Every source belongs to a product."
                    : "Every change keeps its context."}
                </h1>
                <p>
                  Select a product to{" "}
                  {tab === "Evidence"
                    ? "import and inspect evidence"
                    : "review approved versions and measurements"}
                  .
                </p>
              </div>
            </div>
            <div className="product-list">
              {list.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    openProduct(p.id);
                    setTab(tab);
                  }}
                >
                  <span>{p.data.title}</span>
                  <span>
                    {p.evidence_count} records <ArrowRight size={16} />
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">A CLEARER PATH TO PURCHASE</span>
                <h1>Better pages start with listening.</h1>
                <p>
                  Start with a product. Keep its facts, evidence, and decisions
                  together.
                </p>
              </div>
              <button className="primary" onClick={() => setScreen("import")}>
                <Plus size={16} /> Add product
              </button>
            </div>
            {!list.length ? (
              <div className="empty">
                <Layers size={30} />
                <h2>Your first product is a good place to start.</h2>
                <p>
                  Set your store name and tone in Settings, then import a
                  product manually. No Shopify credentials are needed.
                </p>
                <button className="primary" onClick={() => setScreen("import")}>
                  Import one product <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="product-grid">
                {list.map((p) => (
                  <article className="product-card" key={p.id}>
                    <button
                      className="product-image"
                      onClick={() => openProduct(p.id)}
                    >
                      {p.data.images[0] ? (
                        <img
                          className="merchant-product-image"
                          src={p.data.images[0]}
                          alt={p.data.title}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <Lamp color="#ba6541" />
                      )}
                    </button>
                    <div className="product-info">
                      <div className="product-category">
                        {p.data.category}
                        <span>
                          {p.data.currency} {p.data.price.toFixed(2)}
                        </span>
                      </div>
                      <h3>{p.data.title}</h3>
                      <div className="product-status">
                        {p.evidence_count} imported records
                      </div>
                      <button
                        className="product-action"
                        onClick={() => openProduct(p.id)}
                      >
                        Open product <ArrowRight size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        <footer className="page-footer">
          Cluecart
          <span>Turn customer questions into better product pages.</span>
        </footer>
      </main>
    </>
  );
  function EvidencePanel() {
    return (
      <div className="import-layout">
        <section className="settings">
          <h2>Bring the customer’s words.</h2>
          <p>
            Review sources, product assignments, and redactions before import.
            Import does not send evidence to AI. Analysis uses a provider only
            with explicit workspace consent.
          </p>
          <button
            onClick={() =>
              saveFile(
                "id,type,product,date,rating,text,link\nexample,Question,,2026-10-01,,What are the dimensions?,\n",
                "cluecart-evidence-template.csv",
                "text/csv",
              )
            }
          >
            Download CSV template
          </button>
          <Field label="Upload CSV (2 MB maximum)">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2 * 1024 * 1024) {
                  setError("CSV exceeds 2 MB.");
                  return;
                }
                Papa.parse(f, {
                  header: true,
                  skipEmptyLines: true,
                  complete: (r) => {
                    if (r.errors.length) {
                      setError(
                        "CSV parsing failed. Check delimiters and quoted fields.",
                      );
                      return;
                    }
                    setCsvRows(r.data);
                    setPreview([]);
                  },
                  error: () => setError("CSV could not be read."),
                });
              }}
            />
          </Field>
          {csvRows.length > 0 && (
            <div className="mapping-grid">
              {Object.keys(columns).map((k) => (
                <Field key={k} label={k + " column"}>
                  <select
                    value={columns[k]}
                    onChange={(e) =>
                      setColumns({ ...columns, [k]: e.target.value })
                    }
                  >
                    <option value="">Not supplied</option>
                    {Object.keys(csvRows[0]).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          )}
          <Field label="Or paste one record per line (unverified provenance)">
            <textarea
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setCsvRows([]);
              }}
            />
          </Field>
          <button onClick={preparePreview}>Preview import</button>
          {preview.length > 0 && (
            <>
              <h3>{preview.length} unique non-empty preview records</h3>
              <div className="import-preview">
                {preview.map((r, i) => (
                  <article key={r.key}>
                    <label className="confirmation">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) =>
                          setPreview(
                            preview.map((x, j) =>
                              j === i ? { ...x, include: e.target.checked } : x,
                            ),
                          )
                        }
                      />{" "}
                      Include / assign to {view.product.title}
                    </label>
                    {r.originalProduct &&
                      ![selected, view.product.title].includes(
                        r.originalProduct,
                      ) && (
                        <p className="warning">
                          Mixed product: {r.originalProduct}. Excluded unless
                          you explicitly assign it above.
                        </p>
                      )}
                    <p>{r.text}</p>
                    <p className="redaction">
                      Suggested redaction: {r.redacted}
                    </p>
                    <small>
                      {r.type} · {r.date || "No source date"} ·{" "}
                      {r.link
                        ? "Merchant-provided link"
                        : "No verifiable external source"}
                    </small>
                  </article>
                ))}
              </div>
              <label className="confirmation">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed the sources, assignments, and redactions. I will
                review any remaining names and addresses before using an AI
                provider.
              </label>
              <button
                className="primary"
                disabled={!reviewed || busy}
                onClick={() =>
                  run(async () => {
                    const records = preview
                      .filter((r) => r.include)
                      .map((r) => ({
                        sourceID: r.sourceID,
                        type: r.type,
                        text: r.text,
                        date: r.date,
                        rating: r.rating,
                        link: r.link,
                        product: selected,
                        originalProduct: r.originalProduct,
                      }));
                    const result = await api(
                      `/products/${selected}/evidence`,
                      "POST",
                      { records },
                    );
                    setPreview([]);
                    setCsvRows([]);
                    setPasted("");
                    await load();
                    setNotice(
                      `${result.imported} records imported; ${result.duplicates} duplicates skipped.`,
                    );
                  })
                }
              >
                Import reviewed records
              </button>
            </>
          )}
        </section>
        <section className="settings">
          <h2>
            Source records <span className="count">{view.records.length}</span>
          </h2>
          {view.records.map((r: any) => (
            <article id={"source-" + r.id} className="source-record" key={r.id}>
              <span className="pill">{r.type}</span>
              <strong>{r.sourceID || r.id.slice(0, 8)}</strong>
              <p>{r.text}</p>
              <small>
                {r.date || "No source date"} · {r.provenance}
              </small>
              {r.link && (
                <p>
                  <a href={r.link} target="_blank" rel="noreferrer">
                    Original source link
                  </a>
                </p>
              )}
              <details>
                <summary>Redacted preview</summary>
                <p>{r.redacted}</p>
              </details>
            </article>
          ))}
          {!view.records.length && (
            <p>No evidence imported yet. Product facts are kept separately.</p>
          )}
        </section>
      </div>
    );
  }
  function ChangesPanel() {
    return (
      <>
        <div className="import-layout">
          <section className="settings">
            <h2>Approved versions</h2>
            {!view.approvals.length && (
              <p>
                No approved changes yet. Review the evidence and approve an
                exact draft.
              </p>
            )}
            {view.approvals.map((a: any) => (
              <article className="version-card" key={a.id}>
                <span className="pill">
                  Approved · {a.snapshot.publicationStatus}
                </span>
                <h3>{a.snapshot.kind}</h3>
                <small>
                  {new Date(a.approved_at).toLocaleString()} ·{" "}
                  {a.snapshot.approvedBy}
                </small>
                <h4>Previous content</h4>
                <p>{a.snapshot.previous}</p>
                <h4>Revised content</h4>
                <div className="addition">{a.snapshot.revised}</div>
                <p>{a.snapshot.merchantNote}</p>
                <details>
                  <summary>Evidence & fact provenance</summary>
                  <p>
                    {a.snapshot.evidence.length} evidence records retained in
                    the snapshot.
                  </p>
                  {a.snapshot.confirmedFacts.map((f: any) => (
                    <p key={f.id}>
                      {f.value} · {f.confirmedAt}
                    </p>
                  ))}
                </details>
                <a
                  className="button"
                  href={`/api/products/${selected}/approvals/${a.id}/export`}
                >
                  <Download size={15} /> Export approved HTML
                </a>
                <button
                  onClick={() =>
                    saveFile(
                      JSON.stringify(a, null, 2),
                      "cluecart-approved-version.json",
                    )
                  }
                >
                  Export evidence snapshot
                </button>
                {view.product.shopify &&
                  a.snapshot.targetField === "descriptionHtml" && (
                    <PublishingPanel
                      productID={selected}
                      approvalID={a.id}
                      owner={me.role === "owner"}
                    />
                  )}{" "}
                <p className="muted">
                  Target: {a.snapshot.targetField}. {a.snapshot.rollbackStatus}.
                </p>
              </article>
            ))}
          </section>
          <section className="settings">
            <h2>Observational comparisons</h2>
            <p>
              Before-and-after measurements do not establish that the copy
              caused a change. Keep metric definitions and known confounders
              visible.
            </p>
            {!view.outcomes.length && (
              <div className="measurement">No measurement connected</div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  const period = (p: string) => ({
                    start: f.get(p + "Start"),
                    end: f.get(p + "End"),
                    numerator: Number(f.get(p + "Numerator")),
                    denominator: Number(f.get(p + "Denominator")),
                  });
                  await api(`/products/${selected}/outcomes`, "POST", {
                    source: f.get("source"),
                    metric: f.get("metric"),
                    timezone: f.get("timezone"),
                    context: f.get("context"),
                    before: period("before"),
                    after: period("after"),
                  });
                  await load();
                  setNotice(
                    "Observational comparison saved. No causal claim was made.",
                  );
                });
              }}
            >
              <Field label="Measurement source">
                <input
                  name="source"
                  required
                  placeholder="Shopify aggregate report / manual export"
                />
              </Field>
              <Field label="Metric definition and limitations">
                <textarea
                  name="metric"
                  required
                  placeholder="Orders divided by product page views; repeat views may be counted."
                />
              </Field>
              <Field label="Timezone">
                <input
                  name="timezone"
                  defaultValue={
                    Intl.DateTimeFormat().resolvedOptions().timeZone
                  }
                  required
                />
              </Field>
              {["before", "after"].map((p) => (
                <fieldset key={p}>
                  <legend>{p === "before" ? "Before" : "After"}</legend>
                  <div className="form-row">
                    <Field label="Start">
                      <input name={p + "Start"} type="date" required />
                    </Field>
                    <Field label="End">
                      <input name={p + "End"} type="date" required />
                    </Field>
                  </div>
                  <div className="form-row">
                    <Field label="Numerator count">
                      <input
                        name={p + "Numerator"}
                        type="number"
                        min="0"
                        required
                      />
                    </Field>
                    <Field label="Denominator count">
                      <input
                        name={p + "Denominator"}
                        type="number"
                        min="1"
                        required
                      />
                    </Field>
                  </div>
                </fieldset>
              ))}
              <Field label="Promotions, traffic changes, and other context">
                <textarea
                  name="context"
                  placeholder="Document known confounders, or state that they are unknown."
                  required
                />
              </Field>
              <button disabled={busy}>Save comparison</button>
            </form>
            {view.outcomes.map((o: any) => (
              <article className="version-card" key={o.id}>
                <span className="pill">Observational comparison</span>
                <h3>{o.data.metric}</h3>
                <p>
                  {o.data.source} · {o.data.timezone}
                </p>
                <p>
                  Before: {o.data.before.numerator} /{" "}
                  {o.data.before.denominator} ({o.data.before.start} –{" "}
                  {o.data.before.end})
                </p>
                <p>
                  After: {o.data.after.numerator} / {o.data.after.denominator} (
                  {o.data.after.start} – {o.data.after.end})
                </p>
                <p>{o.data.context}</p>
                <strong>Not causal proof.</strong>
              </article>
            ))}
          </section>
        </div>
      </>
    );
  }
}
