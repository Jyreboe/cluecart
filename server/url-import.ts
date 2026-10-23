import { lookup } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
export function publicAddress(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function publicPage(
  raw: string,
  redirects = 0,
): Promise<{ html: string; url: string }> {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.endsWith(".") ||
    redirects > 3
  )
    throw Error("Use a public HTTPS URL on port 443.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("Private or reserved network destinations are not allowed.");
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = https.get(
      url,
      {
        lookup: (_h, _opts, cb) => cb(null, chosen.address, chosen.family),
        timeout: 8000,
        headers: {
          "User-Agent": "Cluecart-Product-Import/1.0",
          Accept: "text/html",
        },
      },
      (response) => {
        if (
          response.statusCode &&
          [301, 302, 303, 307, 308].includes(response.statusCode)
        ) {
          response.destroy();
          if (!response.headers.location) {
            reject(Error("Invalid redirect"));
            return;
          }
          publicPage(
            new URL(response.headers.location, url).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.destroy();
          reject(Error("Public page could not be fetched."));
          return;
        }
        if (!/text\/html/i.test(response.headers["content-type"] || "")) {
          response.destroy();
          reject(Error("Only public HTML product pages are supported."));
          return;
        }
        let total = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > 2 * 1024 * 1024) {
            settled = true;
            response.destroy();
            reject(Error("Page exceeds the 2 MB limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (!settled)
            resolve({
              html: Buffer.concat(chunks).toString("utf8"),
              url: url.href,
            });
        });
        response.on("error", reject);
      },
    );
    const timer = setTimeout(() => {
      request.destroy(Error("Product fetch timed out."));
    }, 10000);
    request.on("timeout", () =>
      request.destroy(Error("Product fetch timed out.")),
    );
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
  });
}
export function extractProduct(html: string, url: string) {
  const $ = load(html);
  let product: any = null;
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed)
        ? parsed
        : [parsed, ...(parsed["@graph"] || [])];
      product = nodes.find(
        (n: any) =>
          n["@type"] === "Product" || n["@type"]?.includes?.("Product"),
      );
      if (product) break;
    } catch {
      /* malformed public metadata is ignored */
    }
  }
  const description =
    product?.description || $('meta[name="description"]').attr("content") || "";
  return {
    title: String(
      product?.name ||
        $('meta[property="og:title"]').attr("content") ||
        $("title").text(),
    ).slice(0, 200),
    description: load(String(description)).text().slice(0, 30000),
    sourceURL: url,
    price: Number(product?.offers?.price) || 0,
    currency: /^[A-Z]{3}$/.test(product?.offers?.priceCurrency)
      ? product.offers.priceCurrency
      : "USD",
    facts: [],
    variants: [],
    images: [],
    policies: "",
    category: "Lighting",
    importedAt: new Date().toISOString(),
  };
}
