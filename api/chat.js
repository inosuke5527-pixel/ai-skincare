// ai-skincare/api/chat.js
import OpenAI from "openai";

// Connect to your OpenAI key from Vercel
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// System prompt — your skin coach personality
const SYSTEM_PROMPT = `
You are “Skin Coach”, a friendly dermatologist-informed assistant for a skincare app.
SCOPE: Only talk about dermatology and skincare (skin types, concerns, routines, ingredients, suitability, patch testing, lifestyle).
If user asks about unrelated topics → politely say:
"I can only help with dermatology and skin-care topics. 😊"
INTAKE FIRST:
Before suggesting products, ask short questions like:
1. What's your skin type? (oily/dry/combination/sensitive)
2. What are your main concerns? (acne, pigmentation, wrinkles, redness)
3. Any sensitivities or allergies?
Keep messages warm, short, and clear.
`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content?.trim() || "";

    // Guard for out-of-scope topics
    const skincareWords = [
      "skin","acne","pimple","cream","moisturizer","serum","spf","sunscreen",
      "blackhead","whitehead","pigmentation","toner","cleanser","retinol",
      "niacinamide","salicylic","glycolic","aha","bha","ceramide","oil","dryness"
    ];
    const isSkincare = skincareWords.some((w) => text.toLowerCase().includes(w));

    if (!isSkincare && !/hi|hello|hey/i.test(text)) {
      return res.status(200).json({
        reply: "I can only help with dermatology and skin-care topics. 😊",
        products: [],
      });
    }

    // Greeting
    if (/hi|hello|hey/i.test(text)) {
      return res.status(200).json({
        reply: "Hi! 👋 I'm your Skin Coach. What’s your skin type (oily, dry, combination, sensitive)?",
        products: [],
      });
    }

    // Ask OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn’t understand. Could you rephrase?";

    res.status(200).json({ reply, products: [] });
  } catch (err) {
    console.error("Chat API error:", err);
    res.status(500).json({ reply: "Server error: " + (err.message || String(err)), products: [] });
  }
}
