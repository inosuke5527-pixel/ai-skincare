import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // --- CORS setup ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages = [], intake = {}, allowProducts = true } = req.body || {};
    const lastMsg = messages[messages.length - 1]?.content?.toLowerCase() || "";
    let newIntake = { ...intake };

    // --- detect & store info ---
    const skinMatch = lastMsg.match(
      /\b(oily|dry|combination|combo|sensitive|normal)\b/
    );
    if (skinMatch)
      newIntake.skinType =
        skinMatch[1] === "combo" ? "combination" : skinMatch[1];

    const concernMatch = lastMsg.match(
      /\b(acne|pigmentation|wrinkles|redness|dullness|dark spots|hair fall|dandruff)\b/
    );
    if (concernMatch) newIntake.concern = concernMatch[1];

    // --- product list by skin type ---
    const products = {
      oily: {
        Cleanser: [
          "CeraVe Foaming Facial Cleanser",
          "La Roche-Posay Effaclar Gel",
          "Minimalist Salicylic Acid Face Wash",
        ],
        Serum: [
          "The Ordinary Niacinamide 10% + Zinc 1%",
          "Minimalist Niacinamide 10%",
          "Paula’s Choice BHA 2%",
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
          "Avene Hydrance",
        ],
      },
      combination: {
        Cleanser: [
          "Simple Refreshing Cleanser",
          "Neutrogena Gentle Cleanser",
          "CeraVe Foaming Cleanser",
        ],
        Serum: [
          "Niacinamide 10%",
          "Hyaluronic Acid 2%",
          "Minimalist Sepicalm 3%",
        ],
        Moisturizer: [
          "Re’equil Ceramide & HA Moisturizer",
          "CeraVe Daily Moisturizing Lotion",
          "Cetaphil Oil-Free Lotion",
        ],
      },
      sensitive: {
        Cleanser: [
          "Avene Gentle Cleanser",
          "Bioderma Sensibio",
          "Simple Refreshing Cleanser",
        ],
        Serum: [
          "Minimalist Sepicalm 3%",
          "Avene Hydrance",
          "La Roche-Posay Hyalu B5",
        ],
        Moisturizer: [
          "La Roche-Posay Toleriane",
          "Simple Rich Moisturizer",
          "Avene Hydrance Riche",
        ],
      },
    };

    // --- when user asks about products ---
    if (/\b(which|what|recommend|product|use|should i)\b/.test(lastMsg)) {
      if (!newIntake.skinType) {
        return res.status(200).json({
          reply:
            "Sure 😊 but first — could you tell me your skin type? oily, dry, combination, or sensitive?",
          intake: newIntake,
          products: [],
        });
      }
      const list = products[newIntake.skinType] || products.normal;
      const reply = `For your **${newIntake.skinType} skin**, here are some good picks 💧:\n\n` +
        `**Cleanser:** ${list.Cleanser.join(" / ")}\n` +
        `**Serum:** ${list.Serum.join(" / ")}\n` +
        `**Moisturizer:** ${list.Moisturizer.join(" / ")}\n\n` +
        `Want me to show links and prices too?`;
      return res.status(200).json({ reply, intake: newIntake, products: [] });
    }

    // --- special rule: if skin type known, don’t re-ask ---
    const hasSkin = !!newIntake.skinType;

    // --- improved system prompt ---
    const systemPrompt = `
You are "Skin Coach", a friendly beauty & skincare AI 🧴✨
- You remember user's skin type and concern.
- If already known, never ask again.
- You can also give food, nutrition, lifestyle, or hair advice that supports healthy skin.
- Always stay warm, short, and friendly with emojis.
User skin type: ${newIntake.skinType || "unknown"}.
Main concern: ${newIntake.concern || "none"}.
`;

    // --- combine messages ---
    const chat = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: chat,
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "Okay!";
    if (!hasSkin && !/skin type/i.test(reply)) {
      reply +=
        "\n(Oh, btw — what’s your skin type? oily, dry, combination, or sensitive?)";
    }

    res.status(200).json({ reply, intake: newIntake, products: [] });
  } catch (err) {
    console.error("chat error:", err);
    res.status(200).json({
      reply: "Oops 😅 something went wrong.",
      intake: {},
      products: [],
    });
  }
}
