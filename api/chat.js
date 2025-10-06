// api/chat.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // ✅ Allow browser apps (Expo, Hoppscotch, etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages = [], intake = {}, allowProducts = false } = req.body || {};

    // --- Remember user info ---
    const last = (messages[messages.length - 1]?.content || "").toLowerCase();
    const newIntake = { ...intake };

    const typeMatch = last.match(/\b(oily|dry|combination|combo|sensitive|normal)\b/);
    if (typeMatch)
      newIntake.skinType =
        typeMatch[1] === "combo" ? "combination" : typeMatch[1];

    const concernMatch = last.match(
      /\b(acne|pigmentation|wrinkles|redness|dullness|dark spots|hair fall|dandruff)\b/
    );
    if (concernMatch) newIntake.concern = concernMatch[1];

    // --- System context ---
    let context =
      "You are a friendly skincare & haircare AI coach. Keep answers short, warm, and easy to follow. Use emojis sometimes. Do not ask again for info already given.";
    if (newIntake.skinType) context += ` User has ${newIntake.skinType} skin.`;
    if (newIntake.concern) context += ` Concern: ${newIntake.concern}.`;

    if (allowProducts) {
      context +=
        " If user asks what product to use, give 2–3 real product names per step (cleanser, serum, moisturizer). No links unless asked.";
    }

    const chat = [
      { role: "system", content: context },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: chat,
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() || "Okay!";

    res.status(200).json({
      reply,
      intake: newIntake,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    res.status(200).json({
      reply: "Oops! Something went wrong on the server.",
      intake: {},
    });
  }
}
