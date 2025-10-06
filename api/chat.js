// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- SYSTEM PROMPT ----------
const SYSTEM_PROMPT = process.env.SKIN_COACH_SYSTEM_PROMPT ?? `
You are “Skin Coach”, a friendly, casual, dermatologist-informed assistant for skin and hair care.

You help with: skincare, haircare, scalp issues, acne, pigmentation, dandruff, hair fall, dryness/oil control, routines (AM/PM), ingredients, and general care tips.
If it's not related → gently say you can only help with skin/hair care and suggest a related example.

STYLE:
- Be warm, simple, and casual like a friendly coach.
- Keep replies short, 2–4 sentences max.
- If user is confused (“I don’t understand”, “what do you mean”, “explain again”), respond naturally: simplify, rephrase, and encourage.
- Use simple language and emojis when natural, like 😊💆‍♀️✨
- Always try to help even if info is partial; don’t refuse unless it’s clearly unrelated.

FOLLOW-UPS:
- If the user asks for a routine, give a safe starter routine right away and then 1 quick follow-up to personalize.
- Avoid diagnosis or medical terms; suggest dermatologist for serious issues.
`;

// ---------- HELPERS ----------
function isGreeting(t = "") {
  return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t);
}

function isConfused(t = "") {
  return /\b(i don.?t understand|what do you mean|explain|confused|can you clarify)\b/i.test(t.toLowerCase());
}

function isDermTopic(t = "") {
  const allow = [
    "skin","skincare","dermatology","routine","am","pm","night","morning","evening","acne",
    "pimple","pigmentation","hair","dandruff","hair fall","dryness","oily","serum","spf",
    "cleanser","moisturizer","toner","scalp","redness","pores","wrinkle","blackhead","whitehead"
  ];
  const x = t.toLowerCase();
  return allow.some((w) => x.includes(w));
}

function askedForRoutine(t = "") {
  return /\b(routine|before bed|night|pm|am|morning|evening)\b/i.test(t);
}

function sanitize(text = "", hide) {
  if (!hide) return text;
  return text
    .replace(/https?:\/\/\S+/g, "[link hidden]")
    .replace(/[₹$]\s?\d[\d,.,]*/g, "[price hidden]");
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
    const userText = (lastUser?.content || "").trim();

    // ✅ If user says “I don’t understand” → simplify instead of blocking
    if (isConfused(userText)) {
      return res.status(200).json({
        reply: "no worries 😊 let me put it simply — i just meant: cleanse your skin gently, use a light serum, then moisturizer before bed. would you like me to show a quick example night routine?",
        products: []
      });
    }

    // ✅ Greeting
    if (isGreeting(userText)) {
      return res.status(200).json({
        reply: "hey! 👋 tell me your skin or scalp type (oily, dry, combo, sensitive) and your top goal — acne, pigmentation, dandruff, hair fall, etc. i’ll tailor a quick plan.",
        products: []
      });
    }

    // ✅ Routine request (casual start)
    if (askedForRoutine(userText)) {
      const starter = [
        "here’s a simple **night routine** to start:",
        "• Cleanse → gentle gel or foaming cleanser",
        "• Treat → hydrating or calming serum (e.g., niacinamide or hyaluronic acid)",
        "• Moisturize → light gel or cream moisturizer",
        "",
        "AM tip 🌤️: gentle cleanse → moisturizer → SPF 30+ sunscreen.",
        "",
        "want me to tweak it for oily, dry, or sensitive skin?"
      ].join("\n");
      return res.status(200).json({ reply: starter, products: [] });
    }

    // ✅ Out of scope
    if (!isDermTopic(userText)) {
      return res.status(200).json({
        reply: "i focus on skin & hair care 🌸. want help with acne, pigmentation, dandruff, or a daily routine?",
        products: []
      });
    }

    // ✅ Normal chat completion
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
      "hmm, could you say that differently?";
    reply = sanitize(reply, false);

    return res.status(200).json({ reply, products: [] });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(200).json({ reply: "oops, something went wrong.", products: [] });
  }
}
