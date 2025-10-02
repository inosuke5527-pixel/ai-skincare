// api/recommend.js — sunscreen-friendly queries + robust fallbacks
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { skin = {}, prefs = {}, query = "" } = req.body || {};
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY" });

    // ---------- Small KB ----------
    const ACTIVE_MAP = {
      acne: ["salicylic", "benzoyl peroxide", "azelaic", "retinol", "adapalene", "niacinamide", "zinc"],
      pigmentation: ["vitamin c", "ascorbic", "arbutin", "kojic", "azelaic", "niacinamide", "tranexamic"],
      redness: ["azelaic", "niacinamide", "allantoin", "centella", "madecassoside", "panthenol"],
      dehydration: ["hyaluronic", "glycerin", "panthenol", "squalane", "ceramide"],
      oil: ["niacinamide", "zinc", "salicylic"]
    };
    const IRRITANTS = ["fragrance", "parfum", "linalool", "limonene", "eugenol", "citrus"];
    const HIGH_COMEDO = ["isopropyl myristate", "isopropyl palmitate", "coconut oil"];

    // ---------- Intent ----------
    const parseIntent = (text = "") => {
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
      const concerns = Object.entries(hits).filter(([, v]) => v).map(([k]) => k);
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

    const fetchJSON = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
      return await r.json();
    };

    const normPrice = (p) => {
      if (!p) return null;
      const v = Number(String(p).replace(/[^\d.]/g, "")) || null;
      const currency = /₹/.test(p) ? "INR" : /USD|\$/.test(p) ? "USD" : null;
      return { value: v, currency };
    };

    // ---------- SerpAPI searchers ----------
    async function googleShopping(q, region = "in") {
      const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q)}&hl=en&gl=${region}&google_domain=google.${region}&api_key=${SERPAPI_KEY}`;
      const data = await fetchJSON(url);
      return (data.shopping_results || []).map((r, i) => ({
        id: r.product_id || `gs_${i}`,
        name: r.title,
        brand: r.source || r.vendor || "",
        url: r.link,
        price: normPrice(r.price || r.extracted_price),
        rating: r.rating || null,
        reviews: r.reviews || null,
        snippet: r.snippet || r.title || "",
        source: "google_shopping"
      }));
    }

    async function googleWeb(q, region = "in") {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&hl=en&gl=${region}&google_domain=google.${region}&api_key=${SERPAPI_KEY}`;
      const data = await fetchJSON(url);
      const items = [];
      (data.shopping_results || []).forEach((r, i) => {
        items.push({
          id: r.product_id || `shop_${i}`,
          name: r.title,
          brand: r.source || "",
          url: r.link,
          price: normPrice(r.price),
          rating: r.rating || null,
          snippet: r.snippet || "",
          source: "google_web_shopping"
        });
      });
      (data.organic_results || []).slice(0, 12).forEach((r, i) => {
        items.push({
          id: r.position ? `org_${r.position}` : `org_${i}`,
          name: r.title,
          brand: (r.displayed_link || "").split("/")[0],
          url: r.link,
          price: null,
          rating: null,
          snippet: r.snippet || "",
          source: "google_web_organic"
        });
      });
      return items;
    }

    // ---------- Scoring ----------
    function scoreProduct(p, profile, intent) {
      const text = `${p.name} ${p.snippet}`.toLowerCase();
      let s = 0;

      // concern fit by actives (skip acne actives if we're explicitly doing sunscreen)
      const isSunscreen = intent.categories.includes("sunscreen");
      const concernKeys = intent.concerns;
      for (const c of concernKeys) {
        const bank = ACTIVE_MAP[c] || [];
        const filteredBank = isSunscreen && c === "acne"
          ? bank.filter(a => a !== "salicylic" && a !== "benzoyl peroxide") // these rarely appear on sunscreen pages
          : bank;
        if (filteredBank.some(a => text.includes(a))) s += 20;
      }

      if (isSunscreen && /(spf|pa\+|broad[- ]?spectrum|uva|uvb)/.test(text)) s += 25;

      const type = profile?.skin?.type;
      if (type === "oily" && /(gel|fluid|oil[- ]?free|matte|lightweight)/.test(text)) s += 10;
      if (type === "dry"  && /(cream|balm|rich|ceramide|shea)/.test(text)) s += 10;
      if (type === "sensitive" && /(fragrance[- ]?free|mineral|zinc oxide|titanium dioxide|soothing|centella)/.test(text)) s += 10;

      const sensitivities = profile?.skin?.sensitivities || [];
      if (sensitivities.includes("fragrance") && IRRITANTS.some(w => text.includes(w))) s -= 30;
      if ((profile?.skin?.concerns || []).includes("acne") && HIGH_COMEDO.some(w => text.includes(w))) s -= 12;

      const price = p?.price?.value;
      if (intent.budgetMax && price && price <= intent.budgetMax) s += 6;
      if (intent.budgetMax && price && price > intent.budgetMax) s -= 10;

      if (p.rating) s += Math.min(10, p.rating * 2);
      return s;
    }

    const explain = (p, sc) => {
      const t = `${p.name} ${p.snippet}`;
      const bits = [];
      if (/(spf|pa\+|sunscreen)/i.test(t)) bits.push("broad-spectrum SPF");
      if (/vitamin c|arbutin|azelaic|niacinamide|salicylic|tranexamic/i.test(t)) bits.push("relevant active");
      if (/fragrance[- ]?free/i.test(t)) bits.push("fragrance-free");
      if (/(gel|fluid|oil[- ]?free|matte)/i.test(t)) bits.push("good for oily skin");
      if (sc >= 20) bits.push("matches your concerns");
      return bits.length ? `Picked for ${bits.join("; ")}.` : "Good overall fit.";
    };

    // ---------- Build smarter queries ----------
    const region = (prefs?.region || "in").toLowerCase();
    const intent = parseIntent(query);

    // Base tokens by category
    const tokens = [];
    if (intent.categories.includes("sunscreen")) {
      tokens.push('sunscreen', 'SPF', 'PA++++');
      if ((skin?.type || "").toLowerCase() === "oily") tokens.push("gel OR matte OR oil-free OR lightweight");
      if ((skin?.sensitivities || []).includes("fragrance")) tokens.push('"fragrance-free"');
    } else {
      // non-sunscreen case: use actives for concerns
      if (intent.concerns.includes("pigmentation")) tokens.push('brightening "vitamin c" OR arbutin OR azelaic');
      if (intent.concerns.includes("acne")) tokens.push("salicylic OR benzoyl peroxide");
      if (intent.concerns.includes("redness")) tokens.push("azelaic OR centella OR niacinamide");
    }

    const siteFilter = `site:nykaa.com OR site:sephora.com OR site:amazon.${region}`;

    // Full strict (with site + user text)
    const qStrict = `${tokens.join(" ")} ${query} ${siteFilter}`.trim();
    // Relax: drop site filter
    const qRelax = `${tokens.join(" ")} ${query}`.trim();
    // Very broad fallback
    const qBroad = `${tokens.join(" ")} best ${intent.categories[0] || "skincare"} for ${skin?.type || "skin"}`.trim();

    // ---------- Try multiple passes ----------
    let candidates = [];

    // Pass 1: Shopping strict
    try { candidates = await googleShopping(qStrict, region); } catch {}

    // Pass 2: Web strict (shopping+organic)
    if (!candidates.length) { try { candidates = await googleWeb(qStrict, region); } catch {} }

    // Pass 3: Web relaxed (no site filter)
    if (!candidates.length) { try { candidates = await googleWeb(qRelax, region); } catch {} }

    // Pass 4: Web broad
    if (!candidates.length) { try { candidates = await googleWeb(qBroad, region); } catch {} }

    if (!candidates.length) {
      return res.json({ queryUsed: qBroad, intent, results: [] });
    }

    // ---------- Rank & trim ----------
    const ranked = candidates
      .map(p => { const sc = scoreProduct(p, { skin, prefs }, intent); return { ...p, score: sc, why: explain(p, sc) }; })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    return res.json({ queryUsed: candidates[0]?.source || "mixed", intent, results: ranked });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
