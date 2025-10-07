import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  // ---- CORS setup ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages = [], intake = {}, allowProducts = true } = req.body || {};
    const userText = messages[messages.length - 1]?.content?.toLowerCase() || "";
    let newIntake = { ...intake };

    // --- detect & store user info ---
    const skinMatch = userText.match(
      /\b(oily|dry|combination|combo|sensitive|normal)\b/
    );
    if (skinMatch)
      newIntake.skinType =
        skinMatch[1] === "combo" ? "combination" : skinMatch[1];

    const concernMatch = userText.match(
      /\b(acne|pigmentation|wrinkles|redness|dullness|dark spots|hair fall|dandruff)\b/
    );
    if (concernMatch) newIntake.concern = concernMatch[1];

    const hasSkinType = !!newIntake.skinType;

    // --- detect topic intent ---
    const isFoodQuestion = /\b(food|eat|diet|nutrition|fruit|vegetable|drink|what should i eat)\b/.test(
      userText
    );
    const isProductQuestion = /\b(which|what|recommend|product|use|should i)\b/.test(
      userText
    );

    // --- product list by skin type ---
    const productList = {
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
          "Cetaphil Gentle Cleanser",
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

    // --- food recommendations by skin type ---
    const foodTips = {
      oily: `For oily skin 🍋:
• Eat zinc-rich foods (pumpkin seeds, lentils)
• Add omega-3 (salmon, chia seeds, walnuts)
• Fresh veggies like spinach & cucumber
• Avoid fried foods & too much dairy
Drink plenty of water 💧 to control oil.`,
      dry: `For dry skin 🥑:
• Include healthy fats (avocado, olive oil, nuts)
• Eat vitamin E foods (almonds, sunflower seeds)
• Drink more water & coconut water
• Add sweet potatoes, carrots, and berries for glow ✨`,
      combination: `For combination skin 🍎:
• Balance with fruits like apple, orange, papaya
• Eat vitamin A & C foods (carrot, citrus, kiwi)
• Stay hydrated
• Avoid too much sugar or spicy foods.`,
      sensitive: `For sensitive skin 🍓:
• Eat anti-inflammatory foods (oats, blueberries, turmeric)
• Include omega-3 (flaxseed, salmon)
• Avoid spicy foods & processed snacks
• Drink chamomile or green tea ☕ for calming effect.`,
    };

    // --- if user asks about food ---
    if (isFoodQuestion) {
      if (!hasSkinType) {
        return res.status(200).json({
          reply:
            "Sure 😊 first tell me your skin type — oily, dry, combination, or sensitive — so I can suggest the right foods for you!",
          intake: newIntake,
          products: [],
        });
      }
      const reply = foodTips[newIntake.skinType] || foodTips.combination;
      return res.status(200).json({ reply, intake: newIntake, products: [] });
    }

    // --- if user asks about products ---
    if (isProductQuestion) {
      if (!hasSkinType) {
        return res.status(200).json({
          reply:
            "Sure 😊 but first — what’s your skin type? oily, dry, combination, or sensitive?",
          intake: newIntake,
          products: [],
        });
      }
      const list = productList[newIntake.skinType];
      const reply =
        `For your **${newIntake.skinType} skin**, here are some great picks 💧:\n\n` +
        `**Cleanser:** ${list.Cleanser.join(" / ")}\n` +
        `**Serum:** ${list.Serum.join(" / ")}\n` +
        `**Moisturizer:** ${list.Moisturizer.join(" / ")}\n\n` +
        `Want me to show links and prices too?`;
      return res.status(200).json({ reply, intake: newIntake, products: [] });
    }

    // --- General fallback (chat memory) ---
    const context = `
You are "AI Coach", a friendly skincare & haircare guide 🧴✨
You remember user info and personalize responses.
Skin type: ${newIntake.skinType || "unknown"}.
Concern: ${newIntake.concern || "none"}.
If user already told skin type, never ask again.
Keep tone short, caring, and emoji-friendly.
`;

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
    console.error("chat error:", err);
    res.status(200).json({
      reply: "Oops 😅 something went wrong. Try again!",
      intake: {},
      products: [],
    });
  }
}
