import { useState, useEffect } from "react";
export function AISettings({ owner }: { owner: boolean }) {
  const [config, setConfig] = useState<any>(null),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/ai/config");
    if (!r.ok) throw Error("AI configuration could not be loaded.");
    setConfig(await r.json());
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function consent(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/ai/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          expectedRevision: config.evidence_revision,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setReviewed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Consent could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="shopify-section">
      <h3>Optional AI grouping</h3>
      {config && (
        <>
          <p>
            {config.configured
              ? `${config.provider} adapter configured · Model: ${config.model}`
              : "Rules engine is the default. An administrator must configure a provider key and supported model before AI can be enabled."}
          </p>
          <p>{config.dataSent}</p>
          <p>
            <strong>
              {config.ai_consent
                ? "AI grouping is enabled for future analysis jobs."
                : "AI grouping is disabled. No evidence is sent to an AI provider."}
            </strong>
          </p>
          {config.ai_consent_at && (
            <p className="muted">
              Last consent decision:{" "}
              {new Date(config.ai_consent_at).toLocaleString()}
            </p>
          )}
          {owner && config.configured && !config.ai_consent && (
            <>
              <label className="confirmation">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed the redacted source records and remaining personal
                information, and authorize sending these fields to the
                configured provider.
              </label>
              <button
                disabled={busy || !reviewed}
                onClick={() => consent(true)}
              >
                Enable AI grouping for this workspace
              </button>
            </>
          )}
          {owner && config.ai_consent && (
            <button disabled={busy} onClick={() => consent(false)}>
              Disable AI grouping
            </button>
          )}
          <p className="muted">
            Importing new evidence disables consent until you review it again.
            Provider API costs may apply. Failed or uncertain AI calls do not
            consume the app's completed-analysis allowance and will not
            automatically retry. Provider retention terms still apply; no
            zero-retention or training guarantee is made here.
          </p>
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
