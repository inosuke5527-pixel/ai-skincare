// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- SYSTEM PROMPT ----------
const SYSTEM_PROMPT = process.env.SKIN_COACH_SYSTEM_PROMPT ?? `
You are “Skin Coach”, a friendly dermatologist-informed assistant for skincare and haircare.

SCOPE: 
Help with skincare and haircare — including skin/scalp types, acne, pigmentation, dandruff, hair fall, dryness/oil control, and AM/PM routines. 
You can also suggest types of **products or ingredients** (like "salicylic acid cleanser", "niacinamide serum", "oil-free moisturizer"). 
If the user asks "which product should I use?", give **general safe suggestions**, not medical prescriptions.

STYLE:
- Friendly, conversational, and short (2–5 sentences).
- Use emojis casually (🌸💆‍♀️✨).
- When user asks for help choosing a product, give clear examples (e.g., “You could try a gentle foaming cleanser with salicylic acid, like CeraVe or Minimalist”).
- Avoid brand bias or strong claims — keep it general and safe.
- If something is unrelated, gently redirect to skincare/haircare topics.
- If user seems confused ("I don't understand" / "I don't know"), explain in simpler terms and re-engage kindly.

RULES:
- Only mention links or prices if user explicitly asks (“show me products” or “where to buy”).
- If asked for “product names”, share 2–3 general, safe brand examples.
- Encourage dermatologist visits for serious conditions.
`;

// ---------- HELPERS ----------
function isGreeting(t = "") {
  return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t);
}

function isConfused(t = "") {
  return /\b(i don.?t know|i don.?t understand|what|confused|can you explain|not sure)\b/i.test(t.toLowerCase());
}

function isProductQuestion(t = "") {
  return /\b(which|what|recommend|suggest|product|use|buy|brand)\b/i.test(t.toLowerCase()) &&
         /\b(cleanser|serum|moisturizer|sunscreen|toner|oil|cream|mask|shampoo|conditioner|hair)\b/i.test(t.toLowerCase());
}

function isDermTopic(t = "") {
  const allow = [
    "skin","skincare","dermatology","routine","acne","pigmentation","pimple","blackhead","hair",
    "dandruff","hair fall","oily","dry","combination","sensitive","spf","cleanser","moisturizer",
    "serum","toner","redness","pores","wrinkle","glow","scalp","night","am","pm","morning","evening"
  ];
  const x = t.toLowerCase();
  return allow.some((w) => x.includes(w));
}

function askedForRoutine(t = "") {
  return /\b(routine|before bed|night|pm|am|morning|evening)\b/i.test(t);
}

function sanitize(text = "", hide) {
  if (!hide) return text;
  return text.replace(/https?:\/\/\S+/g, "[link hidden]").replace(/[₹$]\s?\d[\d,.,]*/g, "[price hidden]");
}

// ---------- MAIN ----------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      reply: "Server error: missing OPENAI_API_KEY.",
      products: []
    });
  }

  try {
    const body = req.body || {};
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = (lastUser?.content || "").trim().toLowerCase();

    // 🟢 Greeting
    if (isGreeting(userText)) {
      return res.status(200).json({
        reply: "hey! 👋 tell me your skin or scalp type (oily, dry, combo, sensitive) and your top goal — acne, pigmentation, dandruff, hair fall, etc. i’ll make a simple plan 💆‍♀️",
        products: []
      });
    }

    // 🟢 Routine
    if (askedForRoutine(userText)) {
      const starter = [
        "here’s a simple **night routine** 🌙:",
        "• Cleanse → gentle gel or foaming cleanser",
        "• Treat → calming serum (niacinamide or hyaluronic acid)",
        "• Moisturize → oil-free gel or light cream",
        "",
        "AM ☀️: gentle cleanse → moisturizer → SPF 30+ sunscreen",
        "",
        "want me to personalize it for oily, dry, or sensitive skin?"
      ].join("\n");
      return res.status(200).json({ reply: starter, products: [] });
    }

    // 🟢 Product Recommendation
    if (isProductQuestion(userText)) {
      const suggestion = [
        "no worries 🌸 here are a few safe picks you can look for:",
        "• Cleanser → gentle gel one with **salicylic acid** (CeraVe, Minimalist, or Simple)",
        "• Serum → **niacinamide** or **hyaluronic acid** based (The Ordinary, Plum, or Dot & Key)",
        "• Moisturizer → **oil-free gel** type (Neutrogena Hydro Boost, Re’equil, or Cetaphil)",
        "",
        "if you tell me your **budget or concern** (like acne or glow), i can narrow it down more 💬"
      ].join("\n");
      return res.status(200).json({ reply: suggestion, products: [] });
    }

    // 🟢 Confused / Unsure
    if (isConfused(userText)) {
      return res.status(200).json({
        reply: "no problem 😊 i just meant: cleanse → serum → moisturizer → sunscreen. want me to show a quick example with simple products?",
        products: []
      });
    }

    // 🟡 Off-topic
    if (!isDermTopic(userText)) {
      return res.status(200).json({
        reply: "i can help with skin & hair care 🌿 — routines, acne, pigmentation, dandruff, or what products to use. what do you want to focus on?",
        products: []
      });
    }

    // 🟢 Regular chat
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
    });

    let reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "could you say that another way?";
    reply = sanitize(reply, false);

    return res.status(200).json({ reply, products: [] });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(200).json({ reply: "oops, something went wrong.", products: [] });
  }
}
