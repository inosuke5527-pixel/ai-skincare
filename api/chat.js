// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------ Skin Coach personality ------------------------ */
const SYSTEM_PROMPT = `
You are “Skin Coach”, a friendly, casual assistant for skincare & haircare.

Help with: skin/scalp types, acne, pigmentation, redness, pores, wrinkles, dandruff, hair fall,
dryness/oil control, AM/PM routines, ingredients, and product guidance.
Style: short, warm, practical (2–6 lines). Light bullets when helpful. Emojis okay 🌿✨.
Give safe, general advice; no medical diagnoses. Suggest seeing a dermatologist for severe/persistent issues.

Key behaviors:
• If the user asks for a routine (night/morning/AM/PM), give a safe starter routine immediately and then ask ONE quick follow-up to tailor.
• If the user asks “which product should I use?”, suggest product TYPES + ingredients and 2–3 common brand examples (balanced, not promotional).
• Only include links/prices when the user explicitly asks (“links”, “show products”, “price”, “where to buy”, “buy”).
• If the user is confused (“I don’t understand / IDK”), re-explain simply and invite them to pick a goal.
`;

/* ------------------------------- Helpers -------------------------------- */
const L = (t = "") => t.toLowerCase();

function isGreeting(t = "") {
  return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t);
}
function isConfused(t = "") {
  return /\b(i don.?t (know|understand)|what do you mean|explain|confused|idk)\b/i.test(L(t));
}
function askedForRoutine(t = "") {
  return /\b(routine|regimen|before bed|night|pm|am|morning|evening)\b/i.test(t);
}
function askedForProducts(t = "") {
  return /\b(show|links?|prices?|price|buy|where to buy|options)\b/i.test(t);
}
// 🔥 improved detector for “what should I use?”-type asks
function asksWhichProduct(t = "") {
  const x = L(t);
  const productWords = /\b(cleanser|face ?wash|serum|moisturizer|cream|gel|toner|sunscreen|spf|mask|exfoliator|peel|shampoo|conditioner|product|routine)\b/;
  const askWords = /\b(which|what|recommend|suggest|use|good|best|tell me|should i|pick|choose|go for)\b/;
  return askWords.test(x) || (productWords.test(x) && /\b(use|buy|choose|pick|go for|tell|need)\b/.test(x));
}
function mentionsBudget(t = "") {
  return /\b(budget|under|below|affordable|cheap|expensive|price range)\b/i.test(L(t));
}
function isDermTopic(t = "") {
  const allow = [
    "skin","skincare","dermatology","routine","am","pm","night","morning","evening",
    "acne","pimple","blackhead","whitehead","pigment","hyperpigmentation","melasma",
    "redness","sensitive","texture","pores","wrinkle","fine lines","glow",
    "oil","oily","dry","combination","normal","dehydrated",
    "hair","scalp","dandruff","seborrheic","hair fall","hair loss","frizz","oily scalp","dry scalp",
    "cleanser","face wash","serum","toner","moisturizer","cream","gel",
    "sunscreen","spf","mask","exfoliator","peel","retinol","retinoid",
    "aha","bha","pha","salicylic","glycolic","lactic","mandelic","azelaic",
    "niacinamide","vitamin c","ascorbic","ceramide","benzoyl peroxide","fragrance-free","non-comedogenic",
  ];
  const x = L(t);
  return allow.some((w) => x.includes(w));
}

function sanitize(text = "", hide) {
  if (!hide) return text;
  return text
    .replace(/https?:\/\/\S+/g, "[link hidden]")
    .replace(/[₹$]\s?\d[\d,.,]*/g, "[price hidden]");
}

/* ---------- Light intake memory (auto-fill from user’s wording) ---------- */
function updateIntakeFromUtterance(intake = {}, userText = "") {
  const x = L(userText);

  if (/\boily\b/.test(x)) intake.skinType ??= "oily";
  else if (/\bdry\b/.test(x)) intake.skinType ??= "dry";
  else if (/\bcombo|combination\b/.test(x)) intake.skinType ??= "combination";
  else if (/\bsensitive\b/.test(x)) intake.skinType ??= "sensitive";
  else if (/\bnormal\b/.test(x)) intake.skinType ??= "normal";

  if (/\bacne|pimple|breakout\b/.test(x)) intake.concerns ??= "acne";
  else if (/\bpigment|dark spot|melasma\b/.test(x)) intake.concerns ??= "pigmentation";
  else if (/\bredness|rosacea\b/.test(x)) intake.concerns ??= "redness";
  else if (/\bwrinkle|fine line\b/.test(x)) intake.concerns ??= "wrinkles";
  else if (/\bdandruff|flakes?\b/.test(x)) intake.concerns ??= "dandruff";
  else if (/\bhair ?fall|hair ?loss\b/.test(x)) intake.concerns ??= "hair fall";

  if (/\b(none|nothing|no allergies?)\b/.test(x)) intake.sensitivities ??= "none";

  return intake;
}
function intakeComplete(intake) {
  if (!intake) return false;
  const must = ["skinType", "concerns"];
  return must.every((k) => intake[k] && String(intake[k]).trim());
}

/* -------------------------- Google Shopping cards ------------------------ */
async function fetchProducts(query) {
  if (!process.env.SERPAPI_KEY) return [];
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", "in");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", process.env.SERPAPI_KEY);

  const r = await fetch(url.toString(), { cache: "no-store" });
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
      url: p.link || p.product_link || "",
      image:
        p.thumbnail ||
        p.product_photos?.[0]?.link ||
        p.image ||
        p.rich_product?.images?.[0] ||
        "",
      details: [p.source, p.condition, p.delivery].filter(Boolean).join(" • "),
    }))
    .filter((p) => p.title && p.image);
}

/* -------------------------------- Handler -------------------------------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Env guard (never crash)
  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      reply: "Server error: OPENAI_API_KEY is missing.",
      products: [],
    });
  }

  try {
    const body = req.body || {};
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    let intake = body?.intake || {};
    const allowProducts = body?.allowProducts ?? true; // allow product cards by default
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = (lastUser?.content || "").trim();

    // update intake from the latest user message
    intake = updateIntakeFromUtterance(intake, userText);

    // 0) Greeting
    if (isGreeting(userText)) {
      return res.status(200).json({
        reply:
          "hey! 👋 tell me your skin or scalp type (oily, dry, combo, sensitive) and your top goal — acne, glow, dandruff, hair fall, etc. i’ll give you a quick plan.",
        products: [],
        intake,
      });
    }

    // 1) Confusion → clarify
    if (isConfused(userText)) {
      return res.status(200).json({
        reply:
          "no worries 😊 here’s the simple flow: cleanse → serum → moisturize → sunscreen (AM). want me to tailor it for your skin type, or show product examples?",
        products: [],
        intake,
      });
    }

    // 2) Routine asked → give starter immediately + 1 follow-up
    if (askedForRoutine(userText)) {
      const type = intake.skinType || "";
      const oily = /oily/i.test(type);
      const dry = /dry/i.test(type);
      const baseCleanser = dry ? "gentle, non-foaming cleanser" : "gentle gel/foaming cleanser";
      const baseMoist = oily ? "oil-free gel moisturizer" : "light cream moisturizer";

      const byConcern =
        /acne/i.test(intake.concerns || "")
          ? "salicylic acid (2–3×/week) or a tiny amount of benzoyl peroxide"
          : /pigment|dark spot|melasma/i.test(intake.concerns || "")
          ? "niacinamide (daily) or azelaic acid (most nights)"
          : "a hydrating/calming serum (niacinamide or hyaluronic acid)";

      const starter =
        `here’s a simple **night routine** 🌙:\n` +
        `• Cleanse → ${baseCleanser}\n` +
        `• Treat → ${byConcern}\n` +
        `• Moisturize → ${baseMoist}\n\n` +
        `AM ☀️: gentle cleanse → moisturizer → SPF 30+.\n\n` +
        `quick q: any sensitivities (fragrance/strong acids) or a budget i should keep in mind?`;

      return res.status(200).json({ reply: starter, products: [], intake });
    }

    // 3) “Which product should I use?” → ingredient + 2–3 brand examples
    if (asksWhichProduct(userText)) {
      const skin = intake.skinType || "skin";
      const concern = intake.concerns || "general care";
      const tip = [
        `for ${skin} + ${concern}:`,
        "• Cleanser → gentle gel; acne-prone can try **salicylic acid**",
        "• Serum → **niacinamide** (oil & pores) or **hyaluronic acid** (hydration)",
        "• Moisturizer → **oil-free gel** if oily; light cream if dry/sensitive",
        "",
        "common examples you can look up: CeraVe / Minimalist / The Ordinary / Neutrogena / Re’equil.",
        "say “links” or “show products” if you want prices & images 🛍️",
      ].join("\n");
      return res.status(200).json({ reply: tip, products: [], intake });
    }

    // 4) Budget mention → acknowledge & invite product search
    if (mentionsBudget(userText)) {
      return res.status(200).json({
        reply:
          "got it — i’ll keep it budget-friendly. want me to **show products with prices** for your routine? just say “show products for cleanser/serum/moisturizer”.",
        products: [],
        intake,
      });
    }

    // 5) Links / prices / show products → fetch shopping cards
    if (allowProducts && askedForProducts(userText)) {
      // Build a simple query using intake + last message
      const qParts = [];
      if (/\b(cleanser|face ?wash)\b/i.test(userText)) qParts.push("cleanser");
      if (/\b(serum)\b/i.test(userText)) qParts.push("serum");
      if (/\b(moisturizer|cream|gel)\b/i.test(userText)) qParts.push("moisturizer");
      if (/\b(sunscreen|spf)\b/i.test(userText)) qParts.push("sunscreen");
      if (/\b(shampoo|conditioner)\b/i.test(userText)) qParts.push("shampoo");
      if (intake.concerns) qParts.push(intake.concerns);
      if (intake.skinType) qParts.push(intake.skinType);
      const query = (qParts.join(" ") || userText || "skincare").trim();

      const products = await fetchProducts(query);
      const reply = products.length
        ? `here are some options for **${query}**. want me to narrow by budget or ingredients?`
        : `i couldn’t find good matches for **${query}**. try “show products for niacinamide serum” or “oil-free gel moisturizer”.`;

      return res.status(200).json({ reply, products, intake });
    }

    // 6) Out of scope (gentle)
    if (!isDermTopic(userText)) {
      return res.status(200).json({
        reply:
          "i focus on skin & hair care 🌿 — routines, acne, pigmentation, dandruff, hair fall, and what products to use. what would you like help with?",
        products: [],
        intake,
      });
    }

    // 7) Normal AI reply (reasoning/chat)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.45,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
    });

    let reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "could you say that a bit differently?";
    reply = sanitize(reply, false);

    return res.status(200).json({ reply, products: [], intake });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(200).json({ reply: "oops, something went wrong.", products: [] });
  }
}
