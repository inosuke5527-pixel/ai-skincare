// api/recommend.js
export default async function handler(req, res) {
  // --- CORS so Expo Go / Web can call this endpoint ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { skin = {}, prefs = {}, query = "" } = req.body || {};
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) return res.status(500).json({ error: 'Missing SERPAPI_KEY' });

    // --- Simple knowledge for mapping concerns <-> actives ---
    const ACTIVE_MAP = {
      acne: ["salicylic","benzoyl peroxide","azelaic","retinol","adapalene"],
      pigmentation: ["vitamin c","ascorbic","arbutin","kojic","azelaic","niacinamide","tranexamic"],
      redness: ["azelaic","niacinamide","allantoin","centella","madecassoside"],
      dehydration: ["hyaluronic","glycerin","panthenol","squalane"],
      oil: ["niacinamide","zinc","salicylic"]
    };
    const IRRITANTS = ["fragrance","parfum","linalool","limonene","eugenol","citrus"];
    const HIGH_COMEDO = ["isopropyl myristate","isopropyl palmitate","coconut oil"];

    // --- 1) Intent parse ---
    const parseIntent = (text="") => {
      const q = text.toLowerCase();
      const budget = /under\s*₹?\s*(\d{2,5})/.exec(q)?.[1] || /under\s*\$?\s*(\d{1,4})/.exec(q)?.[1];
      const budgetMax = budget ? Number(budget) : null;

      const hits = {
        acne: /(acne|pimple|whitehead|blackhead|breakout)/.test(q),
        pigmentation: /(tan|suntan|dark spot|hyperpig|melasma|dull)/.test(q),
        redness: /(redness|rosacea|flush|irritat)/.test(q),
        dehydration: /(dry|dehydrated|tight|flaky)/.test(q),
        oil: /(oily|oil|sebum|shine)/.test(q),
      };
      const concerns = Object.entries(hits).filter(([,v])=>v).map(([k])=>k);
      if (!concerns.length && /(tan|suntan)/.test(q)) concerns.push("pigmentation");

      const cats = new Set();
      if (/(spf|sunscreen|sunblock)/.test(q)) cats.add("sunscreen");
      if (/(cleanser|face wash)/.test(q)) cats.add("cleanser");
      if (/(serum|treatment|essence)/.test(q)) cats.add("serum");
      if (/(moisturizer|cream|lotion|gel)/.test(q)) cats.add("moisturizer");
      if (/(exfoliat|aha|bha|peel|mandelic|glycolic|lactic)/.test(q)) cats.add("exfoliant");
      if (!cats.size && concerns.includes("pigmentation")) { cats.add("sunscreen"); cats.add("serum"); cats.add("exfoliant"); }

      return { budgetMax, concerns: concerns.length ? concerns : ["acne"], categories: [...cats] };
    };

    const fetchJSON = async (url) => (await fetch(url)).json();

    // --- 2) Web search via SerpAPI ---
    const searchProductsSerp = async ({ query, region = "in" }) => {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&google_domain=google.${region}&location=${encodeURIComponent(region.toUpperCase())}&hl=en&gl=${region}&api_key=${SERPAPI_KEY}`;
      const data = await fetchJSON(url);
      const items = [];
      (data.shopping_results || []).forEach((r, i) => {
        items.push({
          id: r.product_id || `shop_${i}`,
          name: r.title,
          brand: r.source || "",
          url: r.link,
          price: r.price ? { value: Number(String(r.price).replace(/[^\d.]/g, "")) || null, currency: (r.price || "").includes("₹") ? "INR" : "USD" } : null,
          snippet: r.snippet || "",
          source: "shopping",
        });
      });
      (data.organic_results || []).slice(0, 8).forEach((r, i) => {
        items.push({
          id: r.position ? `org_${r.position}` : `org_${i}`,
          name: r.title,
          brand: (r.displayed_link || "").split("/")[0],
          url: r.link,
          price: null,
          snippet: r.snippet || "",
          source: "organic",
        });
      });
      return items;
    };

    // --- 3) Score + explain ---
    const scoreProduct = (p, profile, intent) => {
      const text = `${p.name} ${p.snippet}`.toLowerCase();
      const activeHits = new Set();
      for (const actives of Object.values(ACTIVE_MAP)) actives.forEach(a => { if (text.includes(a)) activeHits.add(a); });
      let s = 0;
      for (const c of intent.concerns) {
        const bank = ACTIVE_MAP[c] || [];
        if (bank.some(a => text.includes(a))) s += 25;
      }
      if (intent.categories.includes("sunscreen") && /(spf|pa\+|sunscreen|uva|uvb)/.test(text)) s += 20;

      const type = profile?.skin?.type;
      if (type === "oily" && /(gel|fluid|oil[- ]?free|matte)/.test(text)) s += 8;
      if (type === "dry"  && /(cream|balm|rich|ceramide)/.test(text)) s += 8;
      if (type === "sensitive" && /(fragrance[- ]?free|mineral|zinc oxide|titanium dioxide|soothing)/.test(text)) s += 10;

      const sensitivities = profile?.skin?.sensitivities || [];
      if (sensitivities.includes("fragrance") && IRRITANTS.some(w => text.includes(w))) s -= 30;
      if ((profile?.skin?.concerns || []).includes("acne") && HIGH_COMEDO.some(w => text.includes(w))) s -= 12;

      const price = p?.price?.value;
      if (intent.budgetMax && price && price <= intent.budgetMax) s += 6;
      if (intent.budgetMax && price && price > intent.budgetMax) s -= 10;

      return s;
    };

    const explain = (p, score) => {
      const t = `${p.name} ${p.snippet}`;
      const bits = [];
      if (/(spf|pa\+|sunscreen)/i.test(t)) bits.push("broad-spectrum SPF");
      if (/vitamin c|arbutin|azelaic|niacinamide|salicylic/i.test(t)) bits.push("relevant active");
      if (score >= 20) bits.push("good match for your concerns");
      return bits.length ? `Picked for ${bits.join("; ")}.` : "Good overall fit.";
    };

    // --- 4) Build query, search, rank, return ---
    const region = (prefs?.region || "in").toLowerCase();
    const intent = parseIntent(query);

    const parts = [];
    if (intent.categories.includes("sunscreen")) parts.push("sunscreen");
    if (intent.categories.includes("serum")) parts.push("serum");
    if (intent.categories.includes("exfoliant")) parts.push("exfoliant");
    if (intent.concerns.includes("pigmentation")) parts.push("brightening", "vitamin c OR arbutin OR azelaic");
    if (intent.concerns.includes("acne")) parts.push("salicylic OR benzoyl peroxide");
    if (intent.concerns.includes("redness")) parts.push("azelaic OR centella OR niacinamide");
    if ((skin?.sensitivities || []).includes("fragrance")) parts.push('"fragrance-free"');

    const webQuery = `${parts.join(" ")} ${query} site:nykaa.com OR site:sephora.com OR site:amazon.${region}`;
    const candidates = await searchProductsSerp({ query: webQuery, region });

    const ranked = candidates
      .map(p => {
        const sc = scoreProduct(p, { skin, prefs }, intent);
        return { ...p, score: sc, why: explain(p, sc) };
      })
      .sort((a,b) => b.score - a.score)
      .slice(0, 12);

    return res.json({ queryUsed: webQuery, intent, results: ranked });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
