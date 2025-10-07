// /api/chat.js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ----------------------- helper: intent checks ----------------------- */
const L = (t = "") => t.toLowerCase();
const isFoodQ = (t) =>
  /\b(food|eat|diet|nutrition|fruit|vegetable|drink|what should i eat)\b/.test(L(t));
const isProductQ = (t) =>
  /\b(which|what|recommend|suggest|product|products|use|should i|brand)\b/.test(L(t));
const isRoutineQ = (t) =>
  /\b(routine|am|pm|morning|night|before bed|how to clean|steps?)\b/.test(L(t));
const isIngredientQ = (t) =>
  /\b(ingredient|ingredients|actives?|what to (use|avoid)|avoid|suitable)\b/.test(L(t));

/* --------------- detect + normalize skin type & concern -------------- */
function enrichIntake(prev = {}, userText = "") {
  const x = L(userText);
  const next = { ...prev };

  const skinMatch = x.match(/\b(oily|dry|combination|combo|sensitive|normal)\b/);
  if (skinMatch) next.skinType = skinMatch[1] === "combo" ? "combination" : skinMatch[1];

  // map various ways users say concerns
  const concernMap = [
    ["acne", /\b(acne|pimples?|breakouts?|blackheads?|whiteheads?)\b/],
    ["pigmentation", /\b(pigment|dark spots?|melasma|post[- ]?acne marks?)\b/],
    ["glow", /\b(glow|dull(ness)?|brighten|radiance)\b/],
    ["wrinkles", /\b(aging|anti[- ]?age|wrinkles?|fine lines?)\b/],
    ["redness", /\b(redness|rosacea|irritation|sensitivity)\b/],
    ["pores/oil", /\b(pores?|oil(y|iness)?|sebum|shine)\b/],
    ["dryness/barrier", /\b(dry|flaky|dehydrated|tight|barrier|eczema)\b/],
    ["dandruff", /\b(dandruff|flaking scalp)\b/],
    ["hair fall", /\b(hair ?fall|hair ?loss|thin(n)?ing)\b/],
  ];
  for (const [label, rx] of concernMap) {
    if (rx.test(x)) {
      next.concern = label;
      break;
    }
  }
  return next;
}

/* ---------------- ingredient advisor (smart rules) ------------------- */
function ingredientAdvice(concern = "", skinType = "") {
  const S = (a) => a.join(" / ");

  const byConcern = {
    "acne": {
      use: [
        "Salicylic Acid (BHA) 0.5–2%",
        "Benzoyl Peroxide 2.5–5% (spots)",
        "Niacinamide 4–10%",
        "Azelaic Acid 10%",
        "Adapalene (over-the-counter retinoid, PM)"
      ],
      avoid: [
        "Heavy comedogenic oils",
        ...(skinType === "sensitive" ? ["Strong fragrance", "High alcohol toners"] : []),
      ],
      notes: "Start 3–4×/week, patch test, moisturize. Use SPF daily."
    },
    "pigmentation": {
      use: [
        "Vitamin C (L-ascorbic 8–15% or stable derivatives)",
        "Azelaic Acid 10%",
        "Niacinamide 4–10%",
        "Mandelic/Glycolic (AHA) 5–10% (PM)",
        "Retinoid (PM)"
      ],
      avoid: ["Harsh scrubs", "Sun exposure without SPF 30–50"],
      notes: "SPF is essential or spots will return."
    },
    "glow": {
      use: [
        "Vitamin C serum (AM)",
        "Hyaluronic Acid 2% (layer under moisturizer)",
        "Niacinamide 4–10%",
        skinType === "dry" ? "Lactic Acid 5–10% (PM, gentle)" : "Mandelic/AHA 5–10% (PM, gentle)"
      ],
      avoid: ["Over-exfoliation", "Hot water"],
      notes: "Hydration + consistent SPF give the biggest glow."
    },
    "wrinkles": {
      use: [
        "Retinol/Retinal (PM)",
        "Peptides",
        "Vitamin C (AM)",
        "Hyaluronic Acid",
        "Ceramides"
      ],
      avoid: ["Daily strong exfoliants", "Unprotected sun"],
      notes: "Introduce retinoids slowly (1–2×/wk → build up)."
    },
    "redness": {
      use: [
        "Azelaic Acid 10%",
        "Niacinamide 4–5%",
        "Centella/Allantoin/Panthenol",
        "Mineral SPF"
      ],
      avoid: ["Strong fragrance", "High alcohol toners", "Hot water"],
      notes: "Keep routine short; patch test."
    },
    "pores/oil": {
      use: [
        "Salicylic Acid (BHA) 0.5–2%",
        "Niacinamide 4–10%",
        "Oil-free moisturizer",
        "Clay mask 1×/wk"
      ],
      avoid: ["Heavy occlusives during day"],
      notes: "Gentle cleanse; don’t strip — it can trigger more oil."
    },
    "dryness/barrier": {
      use: [
        "Ceramides + Cholesterol + Fatty acids",
        "Hyaluronic Acid",
        "Urea 5%",
        "Squalane"
      ],
      avoid: ["Strong foaming cleansers", "Daily acids"],
      notes: "Layer moisturizer on damp skin; humidify room if needed."
    },
    "dandruff": {
      use: [
        "Zinc Pyrithione or Ketoconazole shampoo",
        "Salicylic Acid scalp treatment"
      ],
      avoid: ["Heavy styling products on scalp"],
      notes: "Use medicated shampoo 2–3×/wk; leave on 3–5 min."
    },
    "hair fall": {
      use: [
        "Gentle shampoo + balanced diet (protein/iron/omega-3)",
        "Derm-advised actives if persistent"
      ],
      avoid: ["Tight hairstyles", "Harsh chemical treatments"],
      notes: "If shedding persists >3 months, consider dermatology consult."
    }
  };

  const found = byConcern[concern] || null;
  if (!found) return null;

  // tiny tailoring by skin type
  const extraAvoid =
    skinType === "oily"
      ? ["Rich buttery creams (day)"]
      : skinType === "dry"
      ? ["High-alcohol gels/toners"]
      : skinType === "sensitive"
      ? ["Strong fragrance", "Peppermint/menthol"]
      : [];

  const lines = [
    `**Ingredients to try (${concern}${skinType ? ` • ${skinType}` : ""})**`,
    `• Use → ${S(found.use)}`,
    `• Avoid → ${S([...found.avoid, ...extraAvoid])}`,
    `• Tips → ${found.notes}`
  ];
  return lines.join("\n");
}

/* ---------------- products per skin type (names only) ---------------- */
const productNames = {
  oily: {
    Cleanser: [
      "CeraVe Foaming Facial Cleanser",
      "La Roche-Posay Effaclar Purifying Gel",
      "Minimalist Salicylic Acid Face Wash",
    ],
    Serum: [
      "The Ordinary Niacinamide 10% + Zinc 1%",
      "Minimalist Niacinamide 10%",
      "Paula’s Choice 2% BHA (sparingly)",
    ],
    Moisturizer: [
      "Neutrogena Hydro Boost Water Gel",
      "Re’equil Oil-Free Moisturizer",
      "Clinique Hydrating Jelly",
    ],
  },
  dry: {
    Cleanser: [
      "CeraVe Hydrating Cleanser",
      "Cetaphil Gentle Skin Cleanser",
      "Simple Micellar Gel Wash",
    ],
    Serum: [
      "The Ordinary Hyaluronic Acid 2% + B5",
      "Plum Hyaluronic Serum",
      "La Roche-Posay Hyalu B5",
    ],
    Moisturizer: [
      "CeraVe Moisturizing Cream",
      "Cetaphil Moisturising Cream",
      "La Roche-Posay Toleriane Sensitive",
    ],
  },
  combination: {
    Cleanser: [
      "CeraVe Foaming Cleanser",
      "Simple Refreshing Face Wash",
      "Neutrogena Ultra Gentle Cleanser",
    ],
    Serum: [
      "Niacinamide 10% (Minimalist / The Ordinary)",
      "Hyaluronic Acid 2% (The Ordinary)",
      "Minimalist Sepicalm 3%",
    ],
    Moisturizer: [
      "CeraVe Daily Moisturizing Lotion",
      "Re’equil Ceramide & HA Moisturizer",
      "Cetaphil Oil-Free Hydrating Lotion",
    ],
  },
  sensitive: {
    Cleanser: [
      "Bioderma Sensibio",
      "Simple Refreshing Cleanser",
      "Avene Extremely Gentle Cleanser",
    ],
    Serum: [
      "Minimalist Sepicalm 3%",
      "La Roche-Posay Hyalu B5",
      "Avene Hydrance",
    ],
    Moisturizer: [
      "Avene Hydrance Rich Cream",
      "La Roche-Posay Toleriane Dermallergo",
      "Simple Replenishing Rich",
    ],
  },
};

/* ---------------- food tips per skin type (short) ------------------- */
const foodTips = {
  oily:
    "For oily skin 🍋\n• Zinc: pumpkin seeds, lentils\n• Omega-3: salmon, chia, walnuts\n• Lots of veggies (spinach, cucumber)\n• Go easy on fried + excess dairy\n• Hydrate well 💧",
  dry:
    "For dry skin 🥑\n• Healthy fats: avocado, olive oil, nuts\n• Vitamin E: almonds, sunflower seeds\n• Sweet potato, carrots, berries\n• Water + coconut water 💧",
  combination:
    "For combination skin 🍎\n• Fruits: apple, orange, papaya\n• Vit A & C: carrot, citrus, kiwi\n• Hydrate well\n• Limit excess sugar/spicy foods",
  sensitive:
    "For sensitive skin 🍓\n• Anti-inflammatory: oats, blueberries, turmeric\n• Omega-3: flaxseed, salmon\n• Avoid very spicy/processed snacks\n• Green or chamomile tea ☕",
};

/* ------------------- optional shopping (links/prices) ---------------- */
async function fetchProducts(query) {
  if (!process.env.SERPAPI_KEY) return [];
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", query);
  u.searchParams.set("gl", "in");
  u.searchParams.set("hl", "en");
  u.searchParams.set("api_key", process.env.SERPAPI_KEY);
  const r = await fetch(u.toString(), { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.shopping_results || [])
    .slice(0, 6)
    .map((p) => ({
      title: p.title || "",
      price:
        p.price ||
        (typeof p.extracted_price === "number"
          ? `₹${Math.round(p.extracted_price).toLocaleString("en-IN")}`
          : ""),
      url: p.link || "",
      image:
        p.thumbnail || p.image || p.product_photos?.[0]?.link || "",
      details: [p.source, p.condition, p.delivery].filter(Boolean).join(" • "),
    }))
    .filter((x) => x.title && x.image);
}

/* ------------------------------- handler ----------------------------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ reply: "Server missing OPENAI_API_KEY.", products: [], intake: {} });
  }

  try {
    const { messages = [], intake = {}, allowProducts = true } = req.body || {};
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const text = (lastUserMsg?.content || "").trim();
    let remembered = enrichIntake(intake, text);

    // 1) Ingredient advisor triggers:
    const wantIngredients = isIngredientQ(text) || !!remembered.concern; // auto if concern detected
    if (wantIngredients && remembered.concern) {
      const tip = ingredientAdvice(remembered.concern, remembered.skinType || "");
      if (tip) {
        return res.status(200).json({
          reply: `${tip}\n\nWant product name examples too? say “show product names”.`,
          products: [],
          intake: remembered,
        });
      }
    }

    // 2) Food questions
    if (isFoodQ(text)) {
      if (!remembered.skinType) {
        return res.status(200).json({
          reply: "sure 😊 tell me your skin type first — oily, dry, combination, or sensitive — so I can tailor food tips.",
          products: [],
          intake: remembered,
        });
      }
      return res.status(200).json({
        reply: foodTips[remembered.skinType] || foodTips.combination,
        products: [],
        intake: remembered,
      });
    }

    // 3) Product names (no links) when asked
    if (isProductQ(text)) {
      if (!remembered.skinType) {
        return res.status(200).json({
          reply: "got it! before I name products, what’s your skin type — oily, dry, combination, or sensitive?",
          products: [],
          intake: remembered,
        });
      }
      const list = productNames[remembered.skinType] || productNames.combination;
      const reply =
        `based on your **${remembered.skinType} skin**, here are some examples:\n` +
        `• **Cleanser** → ${list.Cleanser.join(" / ")}\n` +
        `• **Serum** → ${list.Serum.join(" / ")}\n` +
        `• **Moisturizer** → ${list.Moisturizer.join(" / ")}\n\n` +
        `want **links & prices**? say “show products for cleanser/serum/moisturizer”.`;
      return res.status(200).json({ reply, products: [], intake: remembered });
    }

    // 4) Links & prices on demand
    if (allowProducts && /\b(show|link|price|buy|shopping|where to buy)\b/i.test(text)) {
      const q = `${remembered.skinType || ""} ${remembered.concern || ""} skincare`.trim() || text;
      const products = await fetchProducts(q || "skincare");
      const reply = products.length
        ? `here are some options for **${q}**. want me to sort by budget?`
        : `couldn’t find good matches for **${q}**. try “show products for niacinamide serum”.`;
      return res.status(200).json({ reply, products, intake: remembered });
    }

    // 5) Routine quick reply
    if (isRoutineQ(text)) {
      return res.status(200).json({
        reply:
          "here’s a simple **night routine** 🌙\n• Cleanse → gentle cleanser\n• Serum → niacinamide or hyaluronic acid\n• Moisturize → light cream\nAM ☀️ → Cleanse → Moisturize → SPF 30+.\nwant me to tailor this for your skin type?",
        products: [],
        intake: remembered,
      });
    }

    // 6) General chat fallback (keeps memory)
    const systemPrompt = `
You are “Skin Coach”, a friendly skincare & haircare guide.
Keep it short, warm, and practical. Use emojis sparingly.
Remember user info and never re-ask if already known.
User: skinType=${remembered.skinType || "unknown"}, concern=${remembered.concern || "none"}.
Only discuss skincare/haircare, lifestyle, and nutrition that impact skin. No diagnosis.
`;
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.45,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    });
    const reply = completion.choices?.[0]?.message?.content?.trim() || "okay!";
    return res.status(200).json({ reply, products: [], intake: remembered });
  } catch (err) {
    console.error("chat error:", err);
    return res.status(200).json({ reply: "oops 😅 something went wrong.", products: [], intake: {} });
  }
}
