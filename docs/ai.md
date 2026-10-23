# Optional server-side AI grouping

The default engine is deterministic and requires no API key. The OpenAI adapter is implemented but has not made a live provider request. SDK/protocol tests use a fake HTTP response; job tests use injected providers. No provider charge has been incurred.

The implementation follows the installed official `openai` SDK **7.42.0** README and `helpers/zod` documentation: `client.responses.parse`, `text.format: zodTextFormat(...)`, `output_parsed`, `store:false`, configurable model and `maxRetries:0`. SDK sources and integrity are pinned by `package-lock.json`. No remembered model name is hardcoded. See the [official SDK](https://github.com/openai/openai-node) and [structured-output helper](https://github.com/openai/openai-node/blob/master/helpers.md#structured-outputs).

## Enable deliberately

1. Configure `AI_PROVIDER=openai`, `AI_MODEL` with a currently supported structured-output-capable model, and `CLUECART_AI_KEY` through secure environment settings. `AI_PROVIDER=rules` is the default suggestion. The server uses the standard `https://api.openai.com/v1` SDK destination. An environment secret requirement declares `api.openai.com` as its allowed destination. Do not paste a key into chat or source.
2. Review original sources and their redacted previews. Redaction covers common emails, numbers, order references and some street addresses; it cannot identify every name or address. Edit the input before import if more redaction is needed. The app does not claim comprehensive PII removal.
3. An organization owner must explicitly enable AI grouping in Settings. The exact fields sent are disclosed there. New evidence imports revoke consent so the owner must review the new sources and enable it again.
4. Run an analysis manually. No automatic background analysis is triggered merely by configuring a key or importing evidence. Provider charges may apply when a real analysis is requested.

## Data boundary

The provider receives product category plus server record UUID, source type and redacted text for the selected product only. It does not receive account/store names, product copy, prices, URLs, unredacted evidence fields, billing data or other organizations' records. No cross-merchant training or pooling is implemented. `store:false` requests no Responses API response storage, but this is not a promise of zero provider retention or a legal/compliance guarantee; check the provider's current terms and your agreement.

The model can return only allowed theme names and supplied record IDs under a strict structured schema. Duplicate/unknown IDs are rejected, and counts/excerpts are rebuilt by the server from actual source records. Uploaded evidence is encoded as untrusted data, not instructions. No tool execution, store write, product specification, confidence score, prose claim or revenue forecast can be returned through this schema. The interface labels the grouping as AI-inferred; merchants still review the exact original excerpts.

Drafts use confirmed merchant facts through deterministic templates, including short tone introductions and variant-specific selection. The AI adapter does not draft or verify product capabilities. Arbitrary merchant edits require explicit verification before approval. Schema grounding limits the effects of malicious evidence but does not prove the model's theme classification is correct.

## Failure and usage behavior

The SDK makes no automatic retries. A durable `provider_started_at` marker is committed before invocation. Cancellation aborts the local provider request, but cannot guarantee the provider stops processing or charging. Failed, cancelled, invalid-output and ambiguous calls do not consume the app's **completed-analysis** allowance. This does not promise a provider refund.

Once a provider invocation might have started, automatic retry is blocked. A process restart marks interrupted provider jobs failed/uncertain instead of resubmitting them. Review usage with the provider before deliberately starting a new job. Reusing the same app request key returns the original job; completed jobs have one usage event. The rules engine can safely retry without a provider charge. A single worker process per deployment is required until worker leases are implemented.

Tests cover SDK request shape/redaction, rejection of unknown source IDs, provider failure, no repeated same-key invocation, invalid model output, cancellation, exact-source reconstruction, completion-based accounting and revocation of consent on new evidence. Live model compatibility, model quality, actual proxy-secret propagation, provider retention and real provider billing remain unverified.
