// api/recommend.js — wide extraction + multiple fallbacks for India
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

    // ---------- tiny KB ----------
    const ACTIVE_MAP = {
      acne: ["salicylic", "benzoyl peroxide", "azelaic", "retinol", "adapalene", "niacinamide", "zinc"],
      pigmentation: ["vitamin c", "ascorbic", "arbutin", "kojic", "azelaic", "niacinamide", "tranexamic"],
      redness: ["azelaic", "niacinamide", "allantoin", "centella", "madecassoside", "panthenol"],
      dehydration: ["hyaluronic", "glycerin", "panthenol", "squalane", "ceramide"],
      oil: ["niacinamide", "zinc", "salicylic"]
    };
    const IRRITANTS = ["fragrance", "parfum", "linalool", "limonene", "eugenol", "citrus"];
    const HIGH_COMEDO = ["isopropyl myristate", "isopropyl palmitate", "coconut oil"];
    const BRAND_BOOST_IN = ["minimalist", "re'equil", "reequil", "aqualogica", "fixderma", "the derma co", "dr sheth", "dr. sheth"];

    const region = (prefs?.region || "IN").toLowerCase();
    const gl = region; // e.g., "in"

    // ---------- intent ----------
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
    const intent = parseIntent(query);

    // ---------- utils ----------
    const fetchJSON = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
      return r.json();
    };
    const normPrice = (p) => {
      if (!p) return null;
      const v = Number(String(p).replace(/[^\d.]/g, "")) || null;
      const currency = /₹/.test(p) ? "INR" : /\$|USD/.test(p) ? "USD" : null;
      return { value: v, currency };
    };

    // ---------- extractors ----------
    const extractAll = (data) => {
      const items = [];

      // 1) Shopping blocks
      (data.shopping_results || []).forEach((r, i) => {
        items.push({
          id: r.product_id || `shop_${i}`,
          name: r.title,
          brand: r.source || r.vendor || "",
          url: r.link,
          price: normPrice(r.price || r.extracted_price),
          rating: r.rating || null,
          reviews: r.reviews || null,
          snippet: r.snippet || r.title || "",
          source: "shopping_results",
        });
      });

      // 2) Inline shopping (often appears instead)
      (data.inline_shopping_results || []).forEach((r, i) => {
        items.push({
          id: r.product_id || `inline_${i}`,
          name: r.title,
          brand: r.source || r.vendor || "",
          url: r.link,
          price: normPrice(r.price || r.extracted_price),
          rating: r.rating || null,
          reviews: r.reviews || null,
          snippet: r.snippet || r.title || "",
          source: "inline_shopping_results",
        });
      });

      // 3) Organic links
      (data.organic_results || []).slice(0, 15).forEach((r, i) => {
        items.push({
          id: r.position ? `org_${r.position}` : `org_${i}`,
          name: r.title,
          brand: (r.displayed_link || "").split("/")[0],
          url: r.link,
          price: null,
          rating: null,
          snippet: r.snippet || "",
          source: "organic_results",
        });
      });

      return items;
    };

    // ---------- SERP callers ----------
    const googleShopping = async (q) => {
      const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q)}&hl=en&gl=${gl}&google_domain=google.${gl}&num=20&api_key=${SERPAPI_KEY}`;
      const data = await fetchJSON(url);
      return extractAll(data);
    };
    const googleWeb = async (q) => {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&hl=en&gl=${gl}&google_domain=google.${gl}&num=20&api_key=${SERPAPI_KEY}`;
      const data = await fetchJSON(url);
      return extractAll(data);
    };

    // ---------- scoring ----------
    const scoreProduct = (p, profile, intent) => {
      const text = `${p.name} ${p.snippet}`.toLowerCase();
      let s = 0;
      const isSunscreen = intent.categories.includes("sunscreen");

      // concerns by actives (but avoid acne actives on sunscreen pages)
      for (const c of intent.concerns) {
        let bank = ACTIVE_MAP[c] || [];
        if (isSunscreen && c === "acne") bank = bank.filter(a => a !== "salicylic" && a !== "benzoyl peroxide");
        if (bank.some(a => text.includes(a))) s += 18;
      }

      // sunscreen cues
      if (isSunscreen && /(spf|pa\+|broad[- ]?spectrum|uva|uvb)/.test(text)) s += 25;

      // skin type fits
      const type = (profile?.skin?.type || "").toLowerCase();
      if (type === "oily" && /(gel|fluid|oil[- ]?free|matte|lightweight)/.test(text)) s += 10;
      if (type === "dry"  && /(cream|balm|rich|ceramide|shea)/.test(text)) s += 10;
      if (type === "sensitive" && /(fragrance[- ]?free|mineral|zinc oxide|titanium dioxide|soothing|centella)/.test(text)) s += 10;

      // sensitivities
      const sensitivities = (profile?.skin?.sensitivities || []).map(x => x.toLowerCase());
      if (sensitivities.includes("fragrance") && IRRITANTS.some(w => text.includes(w))) s -= 30;

      // acne & comedogenic
      if ((profile?.skin?.concerns || []).includes("acne") && HIGH_COMEDO.some(w => text.includes(w))) s -= 12;

      // budget
      const price = p?.price?.value;
      if (intent.budgetMax && price && price <= intent.budgetMax) s += 6;
      if (intent.budgetMax && price && price > intent.budgetMax) s -= 10;

      // ratings
      if (p.rating) s += Math.min(10, p.rating * 2);

      // India brand boost
      const lowerName = `${p.name} ${p.brand}`.toLowerCase();
      if (BRAND_BOOST_IN.some(b => lowerName.includes(b))) s += 6;

      return s;
    };

    const explain = (p, sc) => {
      const t = `${p.name} ${p.snippet}`;
      const bits = [];
      if (/(spf|pa\+|sunscreen)/i.test(t)) bits.push("broad-spectrum SPF");
      if (/fragrance[- ]?free/i.test(t)) bits.push("fragrance-free");
      if (/(gel|fluid|oil[- ]?free|matte)/i.test(t)) bits.push("good for oily skin");
      if (/mineral|zinc oxide|titanium dioxide/i.test(t)) bits.push("mineral filters (sensitive-friendly)");
      if (/vitamin c|arbutin|azelaic|niacinamide|tranexamic/i.test(t)) bits.push("brightening actives");
      if (sc >= 20) bits.push("matches your concerns");
      return bits.length ? `Picked for ${bits.join("; ")}.` : "Good overall fit.";
    };

    // ---------- queries ----------
    const tokens = [];
    if (intent.categories.includes("sunscreen")) {
      tokens.push("sunscreen", "SPF", "PA++++");
      if ((skin?.type || "").toLowerCase() === "oily")
        tokens.push("gel OR matte OR oil-free OR lightweight");
      if ((skin?.sensitivities || []).map(x=>x.toLowerCase()).includes("fragrance"))
        tokens.push('"fragrance-free"');
    } else {
      if (intent.concerns.includes("pigmentation")) tokens.push('brightening "vitamin c" OR arbutin OR azelaic');
      if (intent.concerns.includes("acne")) tokens.push("salicylic OR benzoyl peroxide");
      if (intent.concerns.includes("redness")) tokens.push("azelaic OR centella OR niacinamide");
    }

    const siteFilter = `site:nykaa.com OR site:amazon.${gl} OR site:sephora.com`;

    // passes (strict → relaxed → broad + site sweeps)
    const q1 = `${tokens.join(" ")} ${query} ${siteFilter}`.trim();
    const q2 = `${tokens.join(" ")} ${query}`.trim();
    const q3 = `${tokens.join(" ")} best ${intent.categories[0] || "skincare"} for ${skin?.type || "skin"}`.trim();
    const siteSweeps = [
      `${tokens.join(" ")} ${query} site:nykaa.com`,
      `${tokens.join(" ")} ${query} site:amazon.${gl}`,
      `${tokens.join(" ")} ${query} site:sephora.com`,
    ];

    // ---------- run passes ----------
    let candidates = [];
    let queryUsed = q1;

    try { candidates = await googleShopping(q1); } catch {}

    if (!candidates.length) { try { candidates = await googleWeb(q1); } catch {} }
    if (!candidates.length) { queryUsed = q2; try { candidates = await googleWeb(q2); } catch {} }
    if (!candidates.length) { queryUsed = q3; try { candidates = await googleWeb(q3); } catch {} }

    if (!candidates.length) {
      // sweep sites individually (often helps)
      for (const q of siteSweeps) {
        try {
          const add = await googleWeb(q);
          candidates = candidates.concat(add);
          if (candidates.length) { queryUsed = q; break; }
        } catch {}
      }
    }

    if (!candidates.length) {
      return res.json({ queryUsed, intent, results: [] });
    }

    // rank & trim
    const ranked = candidates
      .map(p => { const sc = scoreProduct(p, { skin, prefs }, intent); return { ...p, score: sc, why: explain(p, sc) }; })
      .sort((a,b) => b.score - a.score)
      .slice(0, 15);

    return res.json({ queryUsed, intent, results: ranked });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
