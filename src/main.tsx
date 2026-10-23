import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  ChevronDown,
  Search,
  Check,
  FileText,
  Settings,
  Layers,
  MessageSquare,
  History,
  ExternalLink,
  Download,
  X,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Leaf,
} from "lucide-react";
import Papa from "papaparse";
import { cleanRecords, analyze, escapeHTML, redact } from "./domain.js";
import "./style.css";
import { Logo, Lamp } from "./branding";
import { MerchantApp } from "./MerchantApp";
type RecordItem = { id: string; text: string; type: string; product?: string };
const seed: RecordItem[] = [
  {
    id: "R01",
    text: "Beautiful warm light. Is it tall enough to sit beside a sofa? The height is hard to picture.",
    type: "Review",
  },
  {
    id: "R02",
    text: "What are the dimensions? Would this fit on a narrow bedside table?",
    type: "Question",
  },
  {
    id: "R03",
    text: "The size is perfect for my small dining table. Love the finish.",
    type: "Review",
  },
  {
    id: "R04",
    text: "The battery lasted eight hours on our dinner table.",
    type: "Review",
  },
  {
    id: "R05",
    text: "How many hours does the battery last on full brightness?",
    type: "Support",
  },
  {
    id: "R06",
    text: "Can I leave this outside on the patio overnight?",
    type: "Question",
  },
  {
    id: "R07",
    text: "I love the dimming feature, but only found it after opening the box.",
    type: "Review",
  },
  {
    id: "R08",
    text: "Is the brightness adjustable? Looking for a soft reading light.",
    type: "Question",
  },
  {
    id: "R09",
    text: "The warm finish makes my room feel so inviting.",
    type: "Review",
  },
  {
    id: "R10",
    text: "Does it need to stay plugged in or is it cordless?",
    type: "Support",
  },
];
const products = [
  {
    name: "Forma portable table lamp",
    kind: "Portable lighting",
    price: "$89.00",
    color: "#ba6541",
    shape: "table",
  },
  {
    name: "Arc wall light",
    kind: "Wall lighting",
    price: "$129.00",
    color: "#c5b5a0",
    shape: "wall",
  },
  {
    name: "Column floor lamp",
    kind: "Floor lighting",
    price: "$249.00",
    color: "#686e54",
    shape: "floor",
  },
];
function App() {
  const [factsConfirmed, setFactsConfirmed] = useState(false),
    [tab, setTab] = useState("Products"),
    [selected, setSelected] = useState<number | null>(null),
    [records, setRecords] = useState<RecordItem[]>(seed),
    [finding, setFinding] = useState("size"),
    [modal, setModal] = useState(""),
    [pasted, setPasted] = useState(""),
    [preview, setPreview] = useState<RecordItem[]>([]),
    [draft, setDraft] = useState(
      "At 28 cm tall and 16 cm wide, Forma brings a warm glow to smaller spaces. Place it on a bedside table, shelf, or dining table. Touch and hold the top to adjust the brightness.",
    ),
    [history, setHistory] = useState<
      {
        text: string;
        date: string;
        evidence: RecordItem[];
        previous: string;
        facts: string[];
        status: string;
      }[]
    >([]),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [landing, setLanding] = useState(location.pathname === "/about"),
    [mapping, setMapping] = useState("text"),
    [csvRows, setCsvRows] = useState<any[]>([]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector(".modal") as HTMLElement;
    dialog?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal("");
      if (event.key === "Tab") {
        const nodes = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button,input,select,textarea,[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [modal]);
  const findings = analyze(records);
  const current = findings.find((f) => f.id === finding) || findings[0];
  const toast = (s: string) => {
    setNotice(s);
    setTimeout(() => setNotice(""), 4000);
  };
  function download(text: string, name: string, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  function approve() {
    if (!factsConfirmed) {
      toast("Confirm every edited factual claim before approval.");
      return;
    }
    if (/eight|8 hours|waterproof|outdoor/i.test(draft)) {
      toast(
        "Resolve the battery or outdoor-use verification task before approval.",
      );
      return;
    }
    setHistory([
      ...history,
      {
        text: draft,
        date: new Date().toISOString(),
        evidence: records.map((r) => ({ ...r })),
        previous:
          "Meet Forma. A portable lamp that brings warmth to your everyday spaces. Thoughtfully designed, beautifully simple.",
        facts: ["28 cm tall", "16 cm wide", "Touch dimming"],
        status: "Demo approval; not published",
      },
    ]);
    toast("Demo change approved. Version saved; nothing was published.");
  }
  return (
    <>
      <aside>
        <button className="brand" onClick={() => setLanding(!landing)}>
          <Logo />
        </button>
        <div className="store">
          <span className="store-icon">H</span>
          <div>
            Haven & Form<small>Demo store</small>
          </div>
          <ChevronDown size={15} />
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
              className={tab === name ? "active" : ""}
              key={name}
              onClick={() => {
                setTab(name);
                setSelected(null);
                setLanding(false);
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Changes" && history.length > 0 && (
                <span className="badge">{history.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="demo-note">
            <Leaf size={18} />
            <strong>
              A little evidence.
              <br />A clearer product page.
            </strong>
            <p>Explore with fictional products and customer conversations.</p>
            <span className="pill">Demo data</span>
          </div>
          <button
            className="profile"
            onClick={() => {
              setTab("Settings");
              setSelected(null);
            }}
          >
            <span className="avatar">JD</span>
            <div>
              Jamie Davis<small>Demo workspace</small>
            </div>
            <Settings size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span> {tab}
            {selected !== null && (
              <>
                {" "}
                <span className="slash">/</span> Forma
              </>
            )}
          </span>
          <div>
            <a className="text-button" href="/about">
              About Cluecart
            </a>
            <span className="demo-label">
              <i /> Demo data
            </span>
            <button className="text-button" onClick={() => setModal("connect")}>
              Connect your store <ArrowUpRight size={14} />
            </button>
          </div>
        </header>
        {landing ? (
          <section className="hero">
            <span className="eyebrow">KNOW WHAT’S STOPPING THE SALE.</span>
            <h1>
              Your customers are asking.
              <br />
              Is your product page answering?
            </h1>
            <p>
              Cluecart turns reviews and customer questions into evidence-backed
              improvements you can review before publishing.
            </p>
            <button className="primary" onClick={() => setModal("connect")}>
              Analyze a product <ArrowRight size={16} />
            </button>
            <button onClick={() => setLanding(false)}>Explore the demo</button>
            <div className="steps">
              {[
                "Bring your product and customer evidence.",
                "Find recurring questions and missing information.",
                "Review and apply specific improvements.",
              ].map((s, i) => (
                <article key={s}>
                  <span>0{i + 1}</span>
                  <h3>{s}</h3>
                </article>
              ))}
            </div>
          </section>
        ) : selected !== null ? (
          <>
            <div className="page-heading">
              <div>
                <button className="back" onClick={() => setSelected(null)}>
                  <ArrowLeft size={14} /> Products
                </button>
                <h1>{products[selected].name}</h1>
                <p>Turn what customers ask into answers they can find.</p>
              </div>
              <button onClick={() => setModal("evidence")}>
                <Plus size={16} /> Add evidence
              </button>
            </div>
            <div className="workspace-tabs">
              <button className="chosen">Findings & drafts</button>
              <span>{records.length} evidence records</span>
              <span className="pill">Demo data</span>
            </div>
            <div className="editor">
              <section className="findings">
                <div className="section-title">
                  <h3>Review the evidence</h3>
                  <span>{findings.length} themes</span>
                </div>
                {findings.map((f) => (
                  <button
                    key={f.id}
                    className={
                      "finding " + (current?.id === f.id ? "selected" : "")
                    }
                    onClick={() => setFinding(f.id)}
                  >
                    <span className="priority">
                      {f.id === "power" ? "VERIFY DETAIL" : "PAGE OPPORTUNITY"}
                    </span>
                    <h3>{f.title}</h3>
                    <p>
                      {f.records.length} of {records.length} imported records
                    </p>
                    <span className="mini-link">
                      View sources <ArrowRight size={13} />
                    </span>
                  </button>
                ))}
                {findings.length === 0 && (
                  <div className="source-panel">
                    <h3>Not enough evidence yet.</h3>
                    <p className="muted">
                      Add customer evidence to find recurring questions.
                      Page-only observation: show dimensions near the product
                      description.
                    </p>
                  </div>
                )}
                <div className="source-panel">
                  <h4>Exact source excerpts</h4>
                  {current?.records.map((r: RecordItem) => (
                    <blockquote key={r.id}>
                      “{r.text}”
                      <footer>
                        {r.id} · {r.type} · Demo data
                      </footer>
                    </blockquote>
                  ))}
                </div>
              </section>
              <section>
                <div className="section-title">
                  <h3>Proposed content</h3>
                  <span className="pill">Draft</span>
                </div>
                <div className="draft-body">
                  <label>CONTENT TYPE</label>
                  <h2>A little clarity goes a long way.</h2>
                  <p>Product clarification · Warm & straightforward</p>
                  <label htmlFor="draft">EDIT YOUR DRAFT</label>
                  <textarea
                    id="draft"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setFactsConfirmed(false);
                    }}
                  />
                  <div className="fact">
                    <CheckCircle2 size={17} />
                    <div>
                      <strong>Confirmed product facts</strong>
                      <p>
                        28 cm tall · 16 cm wide · Touch dimming
                        <br />
                        Merchant specification · Demo data
                      </p>
                    </div>
                  </div>
                  <div className="warning">
                    <AlertCircle size={18} />
                    <div>
                      <strong>Two details need verification</strong>
                      <p>
                        Battery: specification says 4 hours; a review says 8.
                        Outdoor suitability is unknown. Customer statements do
                        not confirm these facts.
                      </p>
                    </div>
                  </div>
                  <label className="confirmation">
                    <input
                      type="checkbox"
                      checked={factsConfirmed}
                      onChange={(e) => setFactsConfirmed(e.target.checked)}
                    />{" "}
                    I have checked every factual claim against the confirmed
                    product details.
                  </label>
                  <button className="primary full" onClick={approve}>
                    <Check size={17} /> Approve this change
                  </button>
                  <button
                    className="full"
                    onClick={() =>
                      toast(
                        "Draft rejected. Edit the text to prepare a different version.",
                      )
                    }
                  >
                    Reject draft
                  </button>
                </div>
              </section>
              <section>
                <div className="section-title">
                  <h3>Compare changes</h3>
                  <FileText size={17} />
                </div>
                <div className="comparison">
                  <label>CURRENT DESCRIPTION</label>
                  <p>
                    Meet Forma. A portable lamp that brings warmth to your
                    everyday spaces. Thoughtfully designed, beautifully simple.
                  </p>
                  <hr />
                  <label>PROPOSED ADDITION</label>
                  <div className="addition">{draft}</div>
                  <p className="muted">
                    Recommendation priority reflects recurring questions and
                    available facts. It does not predict sales impact.
                  </p>
                  <button
                    className="full"
                    onClick={() =>
                      download(
                        "<p>" + escapeHTML(draft) + "</p>",
                        "forma-description.html",
                        "text/html",
                      )
                    }
                  >
                    <Download size={16} /> Export safe HTML
                  </button>
                  <button
                    className="full"
                    onClick={async () => {
                      await navigator.clipboard.writeText(draft);
                      toast("Draft copied.");
                    }}
                  >
                    Copy as text
                  </button>
                  <div className="measurement">
                    No measurement connected
                    <small>
                      Future comparisons will be labelled observational.
                    </small>
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : tab === "Products" ? (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">A CLEARER PATH TO PURCHASE</div>
                <h1>Better pages start with listening.</h1>
                <p>
                  Bring your product and customer evidence together. Find what’s
                  missing.
                </p>
              </div>
              <button className="primary" onClick={() => setModal("connect")}>
                <Plus size={17} /> Add product
              </button>
            </div>
            <div className="welcome">
              <div className="welcome-copy">
                <span className="pill">YOUR WORKFLOW, SIMPLIFIED</span>
                <h2>
                  From customer questions
                  <br />
                  to a more helpful product page.
                </h2>
                <p>
                  Find recurring questions, check the facts, and draft
                  <br />
                  specific improvements — with the sources attached.
                </p>
                <button className="text-button" onClick={() => setSelected(0)}>
                  Explore the Forma example <ArrowRight size={16} />
                </button>
              </div>
              <div className="workflow-visual">
                <div className="quote">
                  <MessageSquare size={17} />
                  <p>“Will it fit on my bedside table?”</p>
                  <span>Customer question · Demo data</span>
                </div>
                <div className="connector">↓</div>
                <div className="answer">
                  <span className="check-square">
                    <Check size={14} />
                  </span>
                  <div>
                    <strong>Make the dimensions clear</strong>
                    <small>
                      Supported by{" "}
                      {analyze(records).find((f) => f.id === "size")?.records
                        .length || 0}{" "}
                      source records
                    </small>
                  </div>
                  <ArrowUpRight size={16} />
                </div>
              </div>
            </div>
            <div className="list-heading">
              <h2>
                Your products <span className="count">3</span>
              </h2>
              <div className="search">
                <Search size={16} />
                <input
                  aria-label="Search products"
                  placeholder="Search products"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="product-grid">
              {products
                .filter((p) =>
                  p.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((p) => (
                  <article className="product-card" key={p.name}>
                    <button
                      className={"product-image " + p.shape}
                      onClick={() =>
                        p.shape === "table"
                          ? setSelected(0)
                          : setModal("connect")
                      }
                    >
                      <span className="image-badge">Demo data</span>
                      <Lamp color={p.color} shape={p.shape} />
                      <span className="image-caption">HAVEN & FORM</span>
                    </button>
                    <div className="product-info">
                      <div className="product-category">
                        {p.kind}
                        <span>{p.price}</span>
                      </div>
                      <h3>{p.name}</h3>
                      <div className="product-status">
                        <span
                          className={
                            "status-dot " + (p.shape === "table" ? "green" : "")
                          }
                        />
                        {p.shape === "table" && records.length
                          ? "Ready to review"
                          : "Ready for evidence"}
                        <span>
                          {p.shape === "table"
                            ? `${records.length} records`
                            : "0 records"}
                        </span>
                      </div>
                      <button
                        className="product-action"
                        onClick={() => {
                          if (p.shape === "table") setSelected(0);
                          else setModal("connect");
                        }}
                      >
                        {p.shape === "table"
                          ? "Review findings"
                          : "Add customer evidence"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            <div className="bottom-note">
              <CheckCircle2 size={17} />
              <span>
                Your evidence stays traceable. Every proposed change is yours to
                review.
              </span>
              <button className="text-button" onClick={() => setModal("how")}>
                How Cluecart works <ArrowUpRight size={14} />
              </button>
            </div>
          </>
        ) : tab === "Evidence" ? (
          <>
            <div className="page-heading">
              <div>
                <h1>The words behind the work.</h1>
                <p>
                  {records.length} unique source records · Forma portable table
                  lamp · Demo data
                </p>
              </div>
              <button className="primary" onClick={() => setModal("evidence")}>
                <Plus size={16} /> Add evidence
              </button>
            </div>
            <div className="evidence-table">
              {records.map((r) => (
                <div className="evidence-row" key={r.id}>
                  <span className="pill">{r.type}</span>
                  <div>
                    <strong>{r.id}</strong>
                    <p>{r.text}</p>
                  </div>
                  <span className="muted">Demo data</span>
                </div>
              ))}
            </div>
          </>
        ) : tab === "Changes" ? (
          <>
            <div className="page-heading">
              <div>
                <h1>Every change has a story.</h1>
                <p>
                  Approved versions and their evidence remain available for
                  review.
                </p>
              </div>
            </div>
            {history.length ? (
              history.map((h, i) => (
                <article className="history" key={i}>
                  <span className="pill">Approved · Demo simulation</span>
                  <h3>Forma · Version {i + 1}</h3>
                  <small>{h.date}</small>
                  <p>{h.text}</p>
                  <button
                    onClick={() =>
                      download(
                        JSON.stringify({ version: i + 1, ...h }, null, 2),
                        "cluecart-version.json",
                      )
                    }
                  >
                    Export version & evidence
                  </button>
                  <p className="muted">
                    Not published · No measurement connected
                  </p>
                </article>
              ))
            ) : (
              <div className="empty">
                <History size={30} />
                <h2>A thoughtful change starts with a source.</h2>
                <p>Review a finding and approve your first demo draft.</p>
                <button
                  onClick={() => {
                    setSelected(0);
                    setTab("Products");
                  }}
                >
                  Review Forma <ArrowRight size={16} />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <h1>Your workspace, thoughtfully set up.</h1>
                <p>Explore safely with fictional data.</p>
              </div>
            </div>
            <div className="settings">
              <h2>
                Haven & Form <span className="pill">Demo store</span>
              </h2>
              <p>Category: Home décor & lighting</p>
              <p>Tone: Warm & straightforward</p>
              <hr />
              <h3>Connections</h3>
              <p>
                Shopify, managed authentication, PostgreSQL, private storage,
                and AI are not connected. Real customer imports are disabled
                until authentication is configured.
              </p>
              <button onClick={() => setModal("connect")}>
                Connection requirements <ExternalLink size={15} />
              </button>
              <hr />
              <h3>Your demo data</h3>
              <p>
                Demo edits last for this browser session. No evidence is sent to
                an AI provider.
              </p>
              <button
                onClick={() =>
                  download(
                    JSON.stringify({ records, history }, null, 2),
                    "cluecart-demo.json",
                  )
                }
              >
                Export demo data
              </button>{" "}
              <button
                onClick={() => {
                  setRecords([]);
                  setHistory([]);
                  toast("Demo evidence and versions deleted.");
                }}
              >
                Delete demo evidence
              </button>
            </div>
          </>
        )}
        <footer className="page-footer">
          © 2026 Cluecart <span>Know what’s stopping the sale.</span>
        </footer>
      </main>
      {modal && (
        <div className="overlay" onClick={() => setModal("")}>
          <section
            className="modal"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label={
              modal === "evidence" ? "Add demo evidence" : "Information"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setModal("")}
            >
              <X size={20} />
            </button>
            {modal === "evidence" ? (
              <>
                <span className="pill">Demo only · Use fictional text</span>
                <h2>Bring the customer’s words.</h2>
                <p>
                  Preview, redact, and deduplicate evidence before adding it to
                  Forma.
                </p>
                <button
                  onClick={() =>
                    download(
                      "id,type,product,text\nexample,Question,forma,What are the dimensions?\n",
                      "evidence-template.csv",
                      "text/csv",
                    )
                  }
                >
                  Download CSV template
                </button>
                <label>
                  UPLOAD CSV
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        Papa.parse(f, {
                          header: true,
                          skipEmptyLines: true,
                          complete: (r) => {
                            setCsvRows(r.data);
                            setPreview([]);
                          },
                        });
                    }}
                  />
                </label>
                {csvRows.length > 0 && (
                  <label>
                    TEXT COLUMN
                    <select
                      value={mapping}
                      onChange={(e) => setMapping(e.target.value)}
                    >
                      {Object.keys(csvRows[0]).map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label htmlFor="paste">OR PASTE ONE RECORD PER LINE</label>
                <textarea
                  id="paste"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Does it work without a cable?"
                />
                <button
                  onClick={() => {
                    const rows = csvRows.length
                      ? csvRows.map((r, i) => ({
                          id: r.id || "CSV" + i,
                          text: redact(String(r[mapping] || "")),
                          type: r.type || "CSV",
                          product: r.product,
                        }))
                      : pasted.split("\n").map((text, i) => ({
                          id: "P" + Date.now() + i,
                          text: redact(text),
                          type: "Pasted · unverified",
                        }));
                    setPreview(cleanRecords(rows));
                  }}
                >
                  Preview import
                </button>
                {preview.length > 0 && (
                  <>
                    <div className="preview">
                      {preview.map((r) => (
                        <p key={r.id}>
                          {r.product && r.product !== "forma" ? (
                            <strong>
                              Different product: {r.product} — excluded.{" "}
                            </strong>
                          ) : null}
                          {r.text}
                        </p>
                      ))}
                    </div>
                    <p className="muted">
                      Email and number redactions shown above. Review names and
                      addresses manually. Sources are not externally verified.
                    </p>
                    <button
                      className="primary"
                      onClick={() => {
                        setRecords(
                          cleanRecords([
                            ...records,
                            ...preview.filter(
                              (r) => !r.product || r.product === "forma",
                            ),
                          ]),
                        );
                        setModal("");
                        setPreview([]);
                        setCsvRows([]);
                        toast("Demo evidence imported and deduplicated.");
                      }}
                    >
                      Import previewed records
                    </button>
                  </>
                )}
              </>
            ) : modal === "how" ? (
              <>
                <h2>Evidence. Clarity. A considered change.</h2>
                <p>1. Bring a product and customer evidence.</p>
                <p>2. Review recurring questions with exact source excerpts.</p>
                <p>3. Edit and approve a draft, then export the content.</p>
                <p>
                  All sample records are fictional. Findings are rule-based demo
                  themes, not an AI analysis or predicted conversion impact.
                </p>
              </>
            ) : (
              <>
                <span className="pill">Integration not configured</span>
                <h2>Start with one product.</h2>
                <p>
                  Sign in to import product details and customer evidence into a
                  separate PostgreSQL-backed workspace. No Shopify credentials
                  are needed for manual import, analysis, drafting, approval,
                  and export.
                </p>
                <p>
                  Shopify publishing, generative AI, and billing are not
                  connected. The public demo remains separate from your
                  workspace.
                </p>
                <a className="button primary full" href="/workspace">
                  Open your workspace <ArrowRight size={16} />
                </a>
                <button
                  className="primary"
                  onClick={() => {
                    setModal("");
                    setSelected(0);
                  }}
                >
                  Explore the demo <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname.startsWith("/workspace") ? <MerchantApp /> : <App />,
);
