// /api/chat.js
export default async function handler(req, res) {
  // CORS for Expo Web / mobile
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const msgs = Array.isArray(body?.messages) ? body.messages : [];
    const lastUser = msgs.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
    const query = (lastUser || "skincare").trim();

    // SerpAPI: Google Shopping (India)
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "in"); // India
    url.searchParams.set("hl", "en");
    url.searchParams.set("api_key", process.env.SERPAPI_KEY);

    const r = await fetch(url.toString(), { cache: "no-store" });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ reply: "Upstream error.", error: txt, products: [] });
    }
    const j = await r.json();

    // Map results → product cards expected by the app
    const products = (j.shopping_results || [])
      .slice(0, 6)
      .map((p) => {
        // robust image selection
        const image =
          p.thumbnail ||
          p.product_photos?.[0]?.link ||
          p.image ||
          p.rich_product?.images?.[0] ||
          null;

        // INR often provided when gl=in
        const priceINR =
          typeof p.extracted_price === "number" ? Math.round(p.extracted_price) : null;

        return {
          title: p.title || "",
          priceINR,
          price: priceINR
            ? `₹${priceINR.toLocaleString("en-IN")}`
            : p.price || "",
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
    console.error("Chat API error:", err);
    return res
      .status(500)
      .json({ reply: "Server error.", products: [] });
  }
}
