import { z } from "zod";
import { createHash } from "node:crypto";
import sanitize from "sanitize-html";
export const uuid = z.string().uuid();
export const factSchema = z.object({
  id: uuid.default(() => crypto.randomUUID()),
  topic: z.enum([
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
  ]),
  value: z.string().trim().min(1).max(2000),
  variant: z.string().max(100).default(""),
  verificationNote: z.string().max(2000).default(""),
  confirmed: z.boolean().default(false),
  confirmedAt: z.string().datetime().nullable().default(null),
});
const httpsURL = z
  .string()
  .url()
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an HTTPS URL");
export const productSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(30000).default(""),
    price: z.number().nonnegative().max(10000000).default(0),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    category: z.enum(["Lighting", "Home décor"]).default("Lighting"),
    sourceURL: z.union([httpsURL, z.literal("")]).default(""),
    images: z.array(httpsURL).max(10).default([]),
    variants: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          title: z.string().max(200),
          price: z.number().nonnegative().nullable().default(null),
        }),
      )
      .max(100)
      .default([]),
    policies: z.string().max(10000).default(""),
    facts: z.array(factSchema).max(100).default([]),
    importedAt: z.string().datetime().optional(),
    shopify: z
      .object({
        shop: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
        id: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
        updatedAt: z.string().datetime(),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    const ids = new Set(p.variants.map((v) => v.id));
    if (ids.size !== p.variants.length)
      ctx.addIssue({ code: "custom", message: "Duplicate variant IDs" });
    if (new Set(p.facts.map((f) => f.id)).size !== p.facts.length)
      ctx.addIssue({ code: "custom", message: "Duplicate fact IDs" });
    p.facts.forEach((f) => {
      if (f.variant && !ids.has(f.variant))
        ctx.addIssue({
          code: "custom",
          message: "Fact refers to an unknown variant",
        });
    });
  });
export type Product = z.infer<typeof productSchema>;
export const recordSchema = z.object({
  sourceID: z.string().trim().max(200).default(""),
  type: z.enum(["Review", "Question", "Support", "Pasted"]).default("Pasted"),
  text: z.string().trim().min(1).max(15000),
  date: z.union([z.string().date(), z.literal("")]).default(""),
  rating: z.number().min(0).max(5).nullable().default(null),
  link: z.union([httpsURL, z.literal("")]).default(""),
  product: z.string().max(200).default(""),
  originalProduct: z.string().max(200).default(""),
});
export type Evidence = z.infer<typeof recordSchema> & {
  id: string;
  redacted?: string;
};
export function hash(s: string) {
  return createHash("sha256")
    .update(s.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}
export function textOnly(s: string) {
  return sanitize(s, { allowedTags: [], allowedAttributes: {} });
}
export function redacted(s: string) {
  return s
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email redacted]")
    .replace(/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[number redacted]")
    .replace(/\b(?:order|reference)\s*#?\s*[a-z0-9-]{4,}/gi, "[order redacted]")
    .replace(
      /\b\d{1,6}\s+[\w ]{2,40}\s(?:street|st|avenue|ave|road|rd|lane|ln)\b/gi,
      "[address redacted]",
    );
}
export const topics = [
  ["size", "Dimensions & scale", "size|height|tall|wide|dimension|fit"],
  ["materials", "Materials & finishes", "material|finish|wood|metal|brass"],
  ["assembly", "Assembly & setup", "assembl|install|setup|screw"],
  [
    "placement",
    "Placement & intended use",
    "outdoor|bathroom|waterproof|outside|patio",
  ],
  ["power", "Power & charging", "battery|hours|charg|cordless|plug"],
  ["dimming", "Brightness & dimming", "dim|brightness|bright"],
  ["care", "Care instructions", "clean|care|wipe"],
  ["shipping", "Shipping questions", "ship|deliver|arriv"],
  ["returns", "Returns & policies", "return|refund"],
  ["positive", "What customers appreciate", "love|beautiful|perfect|inviting"],
] as const;
export function findings(
  product: Product,
  records: Evidence[],
  memberships?: Record<string, string[]>,
) {
  return topics
    .map(([topic, title, pattern]) => {
      const supporting = records.filter((r) =>
        memberships
          ? (memberships[topic] || []).includes(r.id)
          : new RegExp(pattern, "i").test(r.text),
      );
      const facts = product.facts.filter(
        (f) => f.topic === topic && f.confirmed,
      );
      const addressed = facts.some((f) =>
        product.description.toLowerCase().includes(f.value.toLowerCase()),
      );
      const breakdown = Object.fromEntries(
        ["Review", "Question", "Support", "Pasted"].map((t) => [
          t,
          supporting.filter((r) => r.type === t).length,
        ]),
      );
      const dates = supporting
        .map((r) => r.date)
        .filter(Boolean)
        .sort();
      const conflict =
        topic === "power" &&
        supporting.some((r) => /\b(?:eight|8)\s*hours/i.test(r.text)) &&
        facts.some((f) => /\b(?:four|4)\s*hours/i.test(f.value));
      return {
        id: topic,
        title,
        recordIDs: supporting.map((r) => r.id),
        excerpts: supporting.map((r) => ({
          id: r.id,
          text: r.text,
          type: r.type,
          link: r.link,
          date: r.date,
        })),
        count: supporting.length,
        total: records.length,
        breakdown,
        dates: dates.length ? [dates[0], dates[dates.length - 1]] : [],
        addressed,
        confirmedFacts: facts.map((f) => f.id),
        verification: conflict
          ? "Customer experience mentions eight hours; confirmed specification says four. Verify the operating conditions."
          : facts.length
            ? ""
            : "No confirmed fact answers this question.",
        priority: !addressed && supporting.length >= 2 ? "High" : "Normal",
        factors: {
          recurrence: supporting.length,
          buyingRelevance: topic !== "positive",
          pageAnswers: addressed,
          confirmedFacts: facts.length,
          effort: "Small copy change after verification",
        },
        nextAction: facts.length
          ? "Draft an answer from confirmed facts."
          : "Confirm this product detail.",
      };
    })
    .filter((f) => f.count > 0);
}
export const draftSchema = z.object({
  kind: z.enum([
    "Clarification",
    "Short description",
    "Benefit bullets",
    "FAQ",
    "Image brief",
  ]),
  text: z.string().trim().min(1).max(20000),
  factIDs: z.array(uuid).max(100),
  recordIDs: z.array(uuid).max(200),
  merchantVerified: z.boolean().default(false),
  verificationNote: z.string().max(2000).default(""),
  tone: z.string().max(100).default("Warm & straightforward"),
  rejected: z.boolean().default(false),
});
export function makeDraft(
  p: Product,
  theme: string,
  kind = "Clarification",
  tone = "",
  variant = "",
) {
  const specific = variant
    ? p.facts.filter(
        (f) => f.confirmed && f.topic === theme && f.variant === variant,
      )
    : [];
  const relevant = specific.length
    ? specific
    : p.facts.filter((f) => f.confirmed && f.topic === theme && !f.variant);
  if (!relevant.length)
    return {
      blocked: true,
      text: "Confirm this product detail before drafting an answer.",
      factIDs: [],
    };
  const lines = relevant.map((f) => f.value);
  let text = lines.join(" ");
  if (kind === "Benefit bullets") text = lines.map((l) => "• " + l).join("\n");
  if (kind === "FAQ")
    text =
      "Q: " +
      (topics.find((t) => t[0] === theme)?.[1] || "Product details") +
      "?\nA: " +
      lines.join(" ");
  if (kind === "Image brief")
    text =
      "Create a labelled product diagram showing: " +
      lines.join("; ") +
      ". Use the actual product and verified measurements.";
  const intro: Record<string, string> = {
    "Warm & straightforward": "A few useful details for your space.",
    "Concise & practical": "Product details.",
    "Calm & considered": "Consider the details that fit your space.",
  };
  if (tone && intro[tone] && kind !== "Image brief")
    text = intro[tone] + "\n" + text;
  if (variant) {
    const title = p.variants.find((v) => v.id === variant)?.title;
    if (!title)
      return {
        blocked: true,
        text: "Choose a valid product variant.",
        factIDs: [],
      };
    text = "For " + title + ":\n" + text;
  }
  return { blocked: false, text, factIDs: relevant.map((f) => f.id) };
}
export function safeHTML(text: string) {
  return text
    .split("\n")
    .map(
      (line) =>
        "<p>" +
        line.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c]!,
        ) +
        "</p>",
    )
    .join("\n");
}
