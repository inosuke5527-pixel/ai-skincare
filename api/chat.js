// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- SYSTEM PROMPT ---
const SYSTEM_PROMPT = process.env.SKIN_COACH_SYSTEM_PROMPT ?? `
You are “Skin Coach”, a friendly dermatologist-informed assistant for a skincare and haircare app.

SCOPE: You can help with dermatology, skincare, and haircare topics — including skin types, scalp issues, hair fall, dandruff, dryness, oil control, ingredients, suitability, patch testing, and lifestyle impacts.
If out of scope → say: “I can only help with dermatology, skin, and hair-care topics.” Then offer examples of what you can help with.

INTAKE FIRST: Before recommending products or showing links/images/prices, collect essentials:
1) Skin or scalp type (oily/dry/combination/sensitive/normal)
2) Main concerns (acne, pigmentation, dandruff, hair fall, redness, wrinkles)
3) Sensitivities/allergies + active medications (e.g., isotretinoin, pregnancy, breastfeeding)
4) Current routine basics (AM/PM) + budget range
Ask max 2–3 short questions at a time. Be warm and concise.

RECOMMENDATIONS:
- After intake is complete, suggest care routines and key ingredients first (what/why/how often).
- Only mention specific products if the user asks for them.
- Add links/prices only when explicitly requested.

FOLLOW-UPS:
- If asked “Is this product good for me?”, evaluate based on their profile, give a short verdict, and suggest how to patch-test.
- Avoid medical diagnosis or prescriptions. Recommend seeing a dermatologist for severe or persistent issues.

TONE: Empathetic, clear, and concise — like a friendly expert who genuinely wants to help.
`;

// --- HELPERS ---
function isGreeting(t = "") {
  return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t);
}

function isDermTopic(t = "") {
  const allow = [
    "skin", "skincare", "dermatology", "acne", "pimple", "blackhead", "whitehead",
    "hyperpigmentation", "melasma", "dark spots", "wrinkle", "fine lines",
    "rosacea", "eczema", "psoriasis", "seborrheic", "dandruff", "scalp",
    "hair", "hair fall", "hair loss", "oily scalp", "dry scalp", "frizz",
    "spf", "sunscreen", "niacinamide", "retinol", "retinoid", "aha", "bha",
    "salicylic", "glycolic", "lactic", "azelaic", "ceramide", "moisturizer",
    "cleanser", "toner", "serum", "patch test", "non-comedogenic",
    "oil control", "vitamin c", "ascorbic", "fragrance-free", "benzoyl peroxide"
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

// --- PRODUCT FETCHER ---
async function fetchProducts(query) {
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
        price: priceINR
          ? `₹${priceINR.toLocaleString("en-IN")}`
          : p.price || "",
        url: p.link || p.product_link || null,
        image,
        details: [p.source, p.condition, p.delivery].filter(Boolean).join(" • "),
      };
    })
    .filter((p) => p.title && p.image);
}

// --- MAIN HANDLER ---
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      reply: "Server error: OPENAI_API_KEY is missing (set it in Vercel → Project → Settings → Environment Variables).",
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

    // --- Basic smart detection for intake ---
    if (/oily|dry|combination|sensitive|normal/i.test(userText)) {
      intake.skinType = userText;
    }
    if (/acne|pigment|wrinkle|dandruff|hair fall|redness|texture/i.test(userText)) {
      intake.concerns = userText;
    }
    if (/nothing|none|no|not at all/i.test(userText)) {
      if (!intake.sensitivities) intake.sensitivities = "none";
    }

    // Greeting → start intake
    if (isGreeting(userText) && !intakeComplete(intake)) {
      const kickoff =
        "Hi! 👋 I can help with your skin and hair care. What’s your skin or scalp type (oily, dry, combination, sensitive)? And your top concern — acne, pigmentation, dandruff, or hair fall?";
      return res.status(200).json({ reply: kickoff, products: [], intake });
    }

    // Out of scope
    if (!isDermTopic(userText) && !intakeComplete(intake)) {
      const refusal =
        "I can only help with dermatology, skin, and hair-care topics — like acne, pigmentation, dandruff, or hair fall. What would you like to work on?";
      return res.status(200).json({ reply: refusal, products: [], intake });
    }

    const needsIntake = !intakeComplete(intake);
    const metaGuard = needsIntake
      ? "IMPORTANT: Intake isn’t complete. Don’t include links, images, or prices. Ask 2–3 short questions to complete intake."
      : (allowProducts
          ? "User may want product suggestions — be concise and relevant."
          : "Don’t include links/images/prices unless explicitly asked.");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: metaGuard },
        ...messages,
      ],
    });

    let reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Sorry—could you say that another way?";

    reply = sanitize(reply, needsIntake || !allowProducts);

    let products = [];
    if (allowProducts) {
      const askForOptions = /\b(show|recommend|suggest|options|buy|links?)\b/i.test(userText);
      if (askForOptions) {
        const q = userText || "skincare";
        products = await fetchProducts(q);
      }
    }

    return res.status(200).json({ reply, products, intake });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(200).json({
      reply: "Sorry—something went wrong.",
      products: []
    });
  }
}
