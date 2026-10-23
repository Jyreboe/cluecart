import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRecords, analyze, escapeHTML, redact } from "../src/domain.js";
test("deduplicates stable IDs and normalized content; excludes empty records", () => {
  assert.equal(
    cleanRecords([
      { id: "1", text: "hello" },
      { id: "1", text: "another" },
      { text: "Same text" },
      { id: "different", text: " same   TEXT " },
      { text: "" },
    ]).length,
    2,
  );
});
test("themes retain exact evidence and do not manufacture sparse findings", () => {
  const r = { id: "1", text: "What is the height?", type: "Question" };
  assert.deepEqual(analyze([r])[0].records, [r]);
  assert.deepEqual(analyze([]), []);
});
test("safe HTML escapes executable markup", () => {
  assert.equal(
    escapeHTML('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
  );
});
test("redacts email and phone before preview", () => {
  assert.equal(
    redact("Contact jane@example.com or 555-123-4567"),
    "Contact [email redacted] or [number redacted]",
  );
});
