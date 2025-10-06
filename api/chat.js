// /api/chat.js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { messages, intake = {}, allowProducts = false } = req.body;

  // --- Detect if user gave skin type or concern ---
  let newIntake = { ...intake };

  const lastMsg = messages[messages.length - 1]?.content?.toLowerCase() || "";
  if (/(oily|dry|combination|combo|sensitive|normal)\b/.test(lastMsg)) {
    const skinType = lastMsg.match(
      /(oily|dry|combination|combo|sensitive|normal)\b/
    )[1];
    newIntake.skinType = skinType === "combo" ? "combination" : skinType;
  }
  if (/(acne|pigmentation|wrinkles|redness|dullness|dark spots|hair fall|dandruff)\b/.test(lastMsg)) {
    const concern = lastMsg.match(
      /(acne|pigmentation|wrinkles|redness|dullness|dark spots|hair fall|dandruff)\b/
    )[1];
    newIntake.concern = concern;
  }

  // --- Build base prompt with remembered info ---
  let context = "You are a friendly skincare and haircare AI coach.\n";
  if (newIntake.skinType) context += `User has ${newIntake.skinType} skin. `;
  if (newIntake.concern)
    context += `Main concern: ${newIntake.concern}. `;
  context +=
    "Always give short, natural, easy-to-understand answers. " +
    "Use emojis occasionally. Don’t repeat questions already answered.";

  if (allowProducts) {
    context +=
      " If user asks about product suggestions, recommend specific product NAMES (2–3) for cleanser, serum, moisturizer, etc., like CeraVe, La Roche-Posay, The Ordinary — no links unless user says 'link' or 'price'.";
  }

  // --- Combine with chat history ---
  const chat = [
    { role: "system", content: context },
    ...messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  ];

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chat,
      temperature: 0.7,
    });

    const reply = completion.choices?.[0]?.message?.content || "Okay!";

    res.status(200).json({
      reply,
      intake: newIntake, // ✅ return remembered info
    });
  } catch (e) {
    console.error("Chat error:", e);
    res.status(500).json({ error: e.message });
  }
}
