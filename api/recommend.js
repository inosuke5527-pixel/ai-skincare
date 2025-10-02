// api/recommend.js — India retailers + stronger extraction + diagnostics
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { skin = {}, prefs = {}, query = "", debug = false } = req.body || {};
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) return res.status(500).json({ error: "Missing SERPAPI_KEY" });

    // --- small KB ---
    const ACTIVE_MAP = {
      acne: ["salicylic","benzoyl peroxide","azelaic","retinol","adapalene","niacinamide","zinc"],
      pigmentation: ["vitamin c","ascorbic","arbutin","kojic","azelaic","niacinamide","tranexamic"],
      redness: ["azelaic","niacinamide","allantoin","centella","madecassoside","panthenol"],
      dehydration: ["hyaluronic","glycerin","panthenol","squalane","ceramide"],
      oil: ["niacinamide","zinc","salicylic"]
    };
    const IRRITANTS = ["fragrance","parfum","linalool","limonene","eugenol","citrus"];
    const HIGH_COMEDO = ["isopropyl myristate","isopropyl palmitate","coconut oil"];
    const BRAND_BOOST_IN = ["minimalist","re'equil","reequil","aqualogica","fixderma","the derma co","dr sheth","dr. sheth"];

    // --- intent ---
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

    const region = (prefs?.region || "IN").toUpperCase();
    const gl = region.toLowerCase();               // "in"
    const googleDomain = gl === "in" ? "google.co.in" : `google.${gl}`;

    const intent = parseIntent(query);

    // --- helpers ---
    const fetchJSON = async (url) => {
      const r = await fetch(url);
      const data = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return data;
    };
    const normPrice = (p) => {
      if (!p) return null;
      const v = Number(String(p).replace(/[^\d.]/g, "")) || null;
      const currency = /₹/.test(p) ? "INR" : (/\$|USD/.test(p) ? "USD" : null);
      return { value: v, currency };
    };

    // --- Serp callers ---
    const serpFetch = async (engine, q) => {
      const base = `https://serpapi.com/search.json`;
      const url = `${base}?engine=${engine}&q=${encodeURIComponent(q)}&hl=en&gl=${gl}&google_domain=${googleDomain}&location=${encodeURIComponent(region)}&num=20&api_key=${SERPAPI_KEY}`;
      const data = await fetchJSON(url);
      // handle soft errors from SerpAPI (quota, captcha)
      if (data.error) return { data, items: [] };
      return { data, items: extractAll(data) };
    };

    const extractAll = (data) => {
      const items = [];

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

      (data.organic_results || []).slice(0, 20).forEach((r, i) => {
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

    // --- scoring ---
    const scoreProduct = (p, profile, intent) => {
      const text = `${p.name} ${p.snippet}`.toLowerCase();
      let s = 0;
      const isSunscreen = intent.categories.includes("sunscreen");

      for (const c of intent.concerns) {
        let bank = ACTIVE_MAP[c] || [];
        if (isSunscreen && c === "acne") bank = bank.filter(a => a !== "salicylic" && a !== "benzoyl peroxide");
        if (bank.some(a => text.includes(a))) s += 18;
      }

      if (isSunscreen && /(spf|pa\+|broad[- ]?spectrum|uva|uvb)/.test(text)) s += 25;

      const type = (profile?.skin?.type || "").toLowerCase();
      if (type === "oily" && /(gel|fluid|oil[- ]?free|matte|lightweight)/.test(text)) s += 10;
      if (type === "dry"  && /(cream|balm|rich|ceramide|shea)/.test(text)) s += 10;
      if (type === "sensitive" && /(fragrance[- ]?free|mineral|zinc oxide|titanium dioxide|soothing|centella)/.test(text)) s += 10;

      const sensitivities = (profile?.skin?.sensitivities || []).map(x => x.toLowerCase());
      if (sensitivities.includes("fragrance") && IRRITANTS.some(w => text.includes(w))) s -= 30;
      if ((profile?.skin?.concerns || []).includes("acne") && HIGH_COMEDO.some(w => text.includes(w))) s -= 12;

      const price = p?.price?.value;
      if (intent.budgetMax && price && price <= intent.budgetMax) s += 6;
      if (intent.budgetMax && price && price > intent.budgetMax) s -= 10;

      if (p.rating) s += Math.min(10, p.rating * 2);

      const lower = `${p.name} ${p.brand}`.toLowerCase();
      if (BRAND_BOOST_IN.some(b => lower.includes(b))) s += 6;

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

    // --- query tokens ---
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

    // Indian retailers & brand sites
    const sites = [
      "nykaa.com",
      `amazon.${gl}`,
      "flipkart.com",
      "tirabeauty.com",
      "purplle.com",
      "1mg.com",
      "minimalist.co.in",
      "reequil.com",
      "aqualogica.in",
      "fixderma.com"
    ];

    // passes
    const strictSites = `site:${sites.join(" OR site:")}`;
    const qStrict = `${tokens.join(" ")} ${query} ${strictSites}`.trim();
    const qRelax  = `${tokens.join(" ")} ${query}`.trim();
    const qBroad  = `${tokens.join(" ")} best ${intent.categories[0] || "skincare"} for ${skin?.type || "skin"}`.trim();

    let allCandidates = [];
    let queryUsed = qStrict;
    const diags = [];

    // Pass 1: Shopping strict
    let r = await serpFetch("google_shopping", qStrict);
    diags.push({ pass: "shopping_strict", count: r.items.length, err: r.data?.error });
    allCandidates = allCandidates.concat(r.items);

    // Pass 2: Web strict
    if (allCandidates.length < 8) {
      r = await serpFetch("google", qStrict);
      diags.push({ pass: "web_strict", count: r.items.length, err: r.data?.error });
      allCandidates = allCandidates.concat(r.items);
    }

    // Pass 3: Web relax
    if (allCandidates.length < 8) {
      queryUsed = qRelax;
      r = await serpFetch("google", qRelax);
      diags.push({ pass: "web_relax", count: r.items.length, err: r.data?.error });
      allCandidates = allCandidates.concat(r.items);
    }

    // Pass 4: Web broad
    if (allCandidates.length < 8) {
      queryUsed = qBroad;
      r = await serpFetch("google", qBroad);
      diags.push({ pass: "web_broad", count: r.items.length, err: r.data?.error });
      allCandidates = allCandidates.concat(r.items);
    }

    // Pass 5: per-site sweeps
    if (allCandidates.length < 8) {
      for (const s of sites) {
        const q = `${tokens.join(" ")} ${query} site:${s}`.trim();
        r = await serpFetch("google", q);
        diags.push({ pass: `site_${s}`, count: r.items.length, err: r.data?.error });
        allCandidates = allCandidates.concat(r.items);
        if (allCandidates.length >= 8) { queryUsed = q; break; }
      }
    }

    if (!allCandidates.length) {
      return res.json({ queryUsed, intent, results: [], diag: debug ? diags : undefined });
    }

    // Helpers
const isProductUrl = (u) =>
  /amazon\.[a-z.]+\/(dp|gp\/product)\//i.test(u) ||
  /nykaa\.com\/.+\/p\//i.test(u) ||
  /flipkart\.com\/.+\/p\/itm/i.test(u) ||
  /purplle\.com\/product\//i.test(u) ||
  /tirabeauty\.com\/product/i.test(u) ||
  /1mg\.com\/otc/i.test(u) ||
  /aqualogica\.in\/products\//i.test(u) ||
  /reequil\.com\/products\//i.test(u) ||
  /minimalist\.co\.in\/products\//i.test(u) ||
  /fixderma\.com\/products\//i.test(u);

const inferPriceFromText = (t) => {
  const m = String(t).match(/₹\s?(\d{2,6})/);
  return m ? { value: Number(m[1]), currency: "INR" } : null;
};

const storeFromUrl = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch { return ""; }
};

// De-dup by URL
const seen = new Set();
const unique = allCandidates.filter(p => {
  if (!p.url) return false;
  const key = p.url.split("#")[0];
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Keep product-like URLs, infer price & store, honor budget
const cleaned = unique
  .filter(p => isProductUrl(p.url))
  .map(p => ({
    ...p,
    price: p.price || inferPriceFromText(`${p.name} ${p.snippet}`),
    store: storeFromUrl(p.url)
  }))
  .filter(p => !intent.budgetMax || !p.price || p.price.value <= intent.budgetMax);

// If nothing after cleaning, fall back to top unique items
const pool = cleaned.length ? cleaned : unique;


    const ranked = pool
  .map(p => { const sc = scoreProduct(p, { skin, prefs }, intent); return { ...p, score: sc, why: explain(p, sc) }; })
  .sort((a,b) => b.score - a.score)
  .slice(0, 15);

return res.json({ queryUsed, intent, results: ranked, diag: debug ? diags : undefined });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
