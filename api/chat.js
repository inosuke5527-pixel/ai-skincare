// /api/products.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const query = (body?.query || "skincare").trim();

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "in");
    url.searchParams.set("hl", "en");
    url.searchParams.set("api_key", process.env.SERPAPI_KEY);

    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ reply: "Upstream error.", error: txt, products: [] });
    }
    const j = await r.json();

    const products = (j.shopping_results || [])
      .slice(0, 6)
      .map((p) => {
        const image =
          p.thumbnail ||
          p.product_photos?.[0]?.link ||
          p.image ||
          p.rich_product?.images?.[0] ||
          null;

        const priceINR =
          typeof p.extracted_price === "number" ? Math.round(p.extracted_price) : null;

        return {
          title: p.title || "",
          priceINR,
          price: priceINR ? `₹${priceINR.toLocaleString("en-IN")}` : p.price || "",
          url: p.link || p.product_link || null,
          image,
          details: [p.source, p.condition, p.delivery].filter(Boolean).join(" • "),
        };
      })
      .filter((p) => p.title && p.image);

    const reply =
      products.length > 0
        ? `Here are some options for "${query}":`
        : `I couldn't find relevant products for "${query}". Try another phrase.`;

    return res.status(200).json({ reply, products });
  } catch (err) {
    console.error("Products API error:", err);
    return res.status(500).json({ reply: "Server error.", products: [] });
  }
}
