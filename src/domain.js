export function cleanRecords(records) {
  const ids = new Set(),
    contents = new Set();
  return records.filter((r) => {
    const content = r.text?.trim().toLowerCase().replace(/\s+/g, " ");
    if (!content || (r.id && ids.has(r.id)) || contents.has(content))
      return false;
    if (r.id) ids.add(r.id);
    contents.add(content);
    return true;
  });
}
export function escapeHTML(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function redact(s) {
  return s
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email redacted]")
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[number redacted]");
}
export function analyze(records) {
  const themes = [
    ["size", "Dimensions & scale", "size|height|tall|wide|dimension"],
    [
      "power",
      "Battery life needs clarification",
      "battery|hours|charge|cordless",
    ],
    ["dimming", "Make dimming easier to find", "dim|brightness|bright"],
    [
      "placement",
      "Where can this lamp be used?",
      "outdoor|bathroom|water|outside",
    ],
  ];
  return themes
    .map(([id, title, pattern]) => ({
      id,
      title,
      records: records.filter((r) => new RegExp(pattern, "i").test(r.text)),
    }))
    .filter((f) => f.records.length);
}
