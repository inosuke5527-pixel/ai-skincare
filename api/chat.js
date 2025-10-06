import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages = [], intake = {}, allowProducts = true } = req.body || {};
    const userText = messages[messages.length - 1]?.content?.toLowerCase() || "";
    let newIntake = { ...intake };

    // Remember skin type
    const matchType = userText.match(/\b(oily|dry|combination|combo|sensitive|normal)\b/);
    if (matchType) newIntake.skinType = matchType[1] === "combo" ? "combination" : matchType[1];

    const matchConcern = userText.match(/\b(acne|pigmentation|wrinkles|dullness|dark spots|redness|hair fall|dandruff)\b/);
    if (matchConcern) newIntake.concern = matchConcern[1];

    // Helper: product list by type
    const productList = {
      oily: {
        Cleanser: ["CeraVe Foaming Cleanser", "La Roche-Posay Effaclar Gel", "Minimalist Salicylic Acid Face Wash"],
        Serum: ["The Ordinary Niacinamide 10% + Zinc 1%", "Minimalist Niacinamide 10%", "Paula’s Choice BHA 2%"],
        Moisturizer: ["Neutrogena Hydro Boost Water Gel", "Re’equil Oil-Free Moisturizer", "Clinique Hydrating Jelly"]
      },
      dry: {
        Cleanser: ["CeraVe Hydrating Cleanser", "Cetaphil Gentle Cleanser", "Simple Micellar Gel Wash"],
        Serum: ["The Ordinary Hyaluronic Acid 2% + B5", "Plum Hyaluronic Serum", "La Roche-Posay Hyalu B5"],
        Moisturizer: ["CeraVe Moisturizing Cream", "Cetaphil Moisturising Cream", "Avene Hydrance"]
      },
      combination: {
        Cleanser: ["Simple Refreshing Cleanser", "Neutrogena Gentle Cleanser", "CeraVe Foaming Cleanser"],
        Serum: ["Niacinamide 10%", "Hyaluronic Acid 2%", "Minimalist Sepicalm 3%"],
        Moisturizer: ["Re’equil Ceramide & HA Moisturizer", "CeraVe Daily Moisturizing Lotion", "Cetaphil Oil-Free Lotion"]
      },
      sensitive: {
        Cleanser: ["Avene Gentle Cleanser", "Bioderma Sensibio", "Simple Refreshing Cleanser"],
        Serum: ["Minimalist Sepicalm 3%", "Avene Hydrance", "La Roche-Posay Hyalu B5"],
        Moisturizer: ["La Roche-Posay Toleriane", "Simple Rich Moisturizer", "Avene Hydrance Riche"]
      }
    };

    // Handle "which products" questions
    if (/\b(which|what|recommend|product|use|should i)\b/.test(userText)) {
      if (!newIntake.skinType) {
        return res.status(200).json({
          reply: "Sure 😊 but first — what’s your skin type? oily, dry, combination, or sensitive?",
          intake: newIntake,
          products: []
        });
      }

      const items = productList[newIntake.skinType] || productList.normal;
      const reply =
        `Based on your **${newIntake.skinType} skin**, here are some trusted options 💧:\n\n` +
        `**Cleanser:** ${items.Cleanser.join(" / ")}\n` +
        `**Serum:** ${items.Serum.join(" / ")}\n` +
        `**Moisturizer:** ${items.Moisturizer.join(" / ")}\n\n` +
        `Would you like me to show links and prices for these?`;

      return res.status(200).json({ reply, intake: newIntake, products: [] });
    }

    // Handle general conversation
    const context = `You are a friendly skincare & haircare coach. 
If the skin type is known, never ask it again — just use it. 
Keep tone warm, short, and clear with emojis.
User skin type: ${newIntake.skinType || "unknown"}. 
Concern: ${newIntake.concern || "unspecified"}.
Offer tailored help for skincare & haircare only.`;

    const chat = [
      { role: "system", content: context },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: chat,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || "Okay!";
    res.status(200).json({ reply, intake: newIntake, products: [] });

  } catch (err) {
    console.error("API error:", err);
    res.status(200).json({ reply: "Something went wrong 💔", intake: {}, products: [] });
  }
}
