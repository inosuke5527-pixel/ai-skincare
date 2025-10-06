// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- SYSTEM PROMPT (casual + helpful) ----------
const SYSTEM_PROMPT = process.env.SKIN_COACH_SYSTEM_PROMPT ?? `
You are “Skin Coach”, a friendly, casual dermatologist-informed assistant for skin + hair care.

SCOPE: Help with dermatology, skincare, and haircare: skin/scalp types, acne, pigmentation, dandruff, hair fall, dryness/oil control, routines (AM/PM), ingredients, suitability, patch testing, lifestyle.
If it’s not related → gently say you can only help with skin/hair care and offer examples.

STYLE: Warm, short, and practical. Avoid long paragraphs. Use simple bullets when helpful. No links/prices unless asked.

INTAKE: When needed, ask at most 1–2 tiny questions at a time:
- skin/scalp type (oily/dry/combination/sensitive/normal)
- top 1–2 concerns (acne, pigmentation, dandruff, hair fall, redness, wrinkles)
- sensitivities/allergies or special cases (pregnancy, isotretinoin)

IMPORTANT: If the user asks for a routine (e.g., “night routine”), give a safe starter routine immediately (even if intake is incomplete), then ask 1 follow-up to personalize. Don’t block.

FOLLOW-UPS: If asked “Is this product good for me?”, give a brief verdict based on their profile + a quick patch-test tip. Encourage seeing a dermatologist for severe or persistent issues.
`;

// ---------- HELPERS ----------
function isGreeting(t = "") {
  return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t);
}

function isDermTopic(t = "") {
  const allow = [
    // general
    "skin","skincare","dermatology","routine","am routine","pm routine","night routine","before bed",
    // concerns
    "acne","pimple","blackhead","whitehead","hyperpigmentation","pigmentation","melasma","dark spots",
    "wrinkle","fine lines","redness","sensitive","texture","pores","oil","oily","dry","combination","normal",
    // hair & scalp
    "hair","scalp","dandruff","seborrheic","hair fall","hair loss","oily scalp","dry scalp","frizz",
    // ingredients / products
    "spf","sunscreen","cleanser","moisturizer","toner","serum","gel","cream",
    "niacinamide","retinol","retinoid","aha","bha","salicylic","glycolic","lactic","azelaic",
    "ceramide","benzoyl peroxide","vitamin c","ascorbic","fragrance-free","non-comedogenic","patch test"
  ];
  const x = t.toLowerCase();
  return allow.some((w) => x.includes(w));
}

function intakeComplete(intake) {
  if (!intake) return false;
  const req = ["skinType", "concerns", "sensitivities", "routineBasics"];
  return req.every((k) => intake[k] && String(intake[k]).trim().length > 0);
}

function sanitize(text = "", hide) {
  if (!hide) return text;
  return text
    .replace(/https?:\/\/\S+/g, "[link hidden until we finish your profile]")
    .replace(/[₹$]\s?\d[\d,.,]*/g, "[price hidden until we finish your profile]");
}

function askedForRoutine(t = "") {
  return /\b(routine|regimen|night|before bed|pm|am|morning|evening)\b/i.test(t);
}

// ---------- (optional) PRODUCTS ----------
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
  return (j.shopping_results || []).slice(0, 6).map((p) => {
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
  }).filter((p) => p.title && p.image);
}

// ---------- MAIN ----------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      reply: "Server error: OPENAI_API_KEY is missing.",
      products: []
    });
  }

  try {
    const body = req.body || {};
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    let intake = body?.intake || {};
    const allowProducts = !!body?.allowProducts;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = (lastUser?.content || "").trim();
    const lower = userText.toLowerCase();

    // light intake auto-fill
    if (/oily|dry|combination|sensitive|normal/.test(lower)) intake.skinType ??= userText;
    if (/acne|pigment|wrinkle|dandruff|hair fall|redness|texture/.test(lower)) intake.concerns ??= userText;
    if (/\b(none|nothing|no allergies?)\b/.test(lower)) intake.sensitivities ??= "none";

    // Greeting → ask casually
    if (isGreeting(userText) && !intakeComplete(intake)) {
      return res.status(200).json({
        reply: "hey! 👋 tell me your skin or scalp type (oily, dry, combo, sensitive) and your top goal — acne, pigmentation, dandruff, hair fall, etc. i’ll tailor a quick plan.",
        products: [],
        intake
      });
    }

    // If user asked for a routine at any point → give a starter plan + 1 quick follow-up
    if (askedForRoutine(userText)) {
      const type = intake.skinType ? intake.skinType.toLowerCase() : "";
      const isOily = /oily/.test(type);
      const isDry = /dry/.test(type);
      const baseCleanser = isDry ? "gentle, non-foaming cleanser" : "gentle gel/foaming cleanser";
      const baseMoist = isOily ? "light gel moisturizer" : "cream moisturizer";
      const activeNight = intake.concerns?.toLowerCase().includes("acne")
        ? "salicylic acid (2–3x/week) or a tiny amount of benzoyl peroxide"
        : intake.concerns?.toLowerCase().includes("pigment")
        ? "azelaic acid or niacinamide (most nights)"
        : "a simple hydrating serum (most nights)";
      const spfTip = "broad-spectrum SPF 30+ every morning";

      const starter = [
        "here’s a simple **night routine** to start:",
        `• Cleanse: ${baseCleanser}`,
        `• Treat: ${activeNight}`,
        `• Moisturize: ${baseMoist}`,
        "",
        "AM reminder: gentle cleanse → moisturizer → " + spfTip + ".",
        "",
        "quick q: any sensitivities (fragrance, strong acids) or special cases (pregnancy, isotretinoin)?"
      ].join("\n");

      return res.status(200).json({
        reply: starter,
        products: [],
        intake
      });
    }

    // Out of scope (softer)
    if (!isDermTopic(userText) && !intakeComplete(intake)) {
      return res.status(200).json({
        reply: "i stick to skin & hair care. want help with a routine, acne, pigmentation, dandruff, or hair fall?",
        products: [],
        intake
      });
    }

    const needsIntake = !intakeComplete(intake);
    const metaGuard = needsIntake
      ? "INTAKE_NOT_DONE: keep it casual; ask at most 1–2 tiny questions. No links/prices. Offer quick tips even with partial info."
      : (allowProducts
          ? "User may want product suggestions. Keep it concise and practical."
          : "No links/prices unless asked. Keep it practical.");

    // Completion
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: metaGuard },
        ...messages,
      ],
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "could you say that a different way?";
    reply = sanitize(reply, needsIntake || !allowProducts);

    // Optional products
    let products = [];
    if (allowProducts) {
      const askForOptions = /\b(show|recommend|suggest|options|buy|links?)\b/i.test(userText);
      if (askForOptions) products = await fetchProducts(userText || "skincare");
    }

    return res.status(200).json({ reply, products, intake });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(200).json({ reply: "oops, something went wrong.", products: [] });
  }
}
