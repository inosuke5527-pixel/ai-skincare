// /api/analyze.js
export default async function handler(req, res) {
  // Allow from your Expo app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ reply: "No image received.", products: [] });
    }

    // Fake “analysis” for now — replace later with a real AI call
    const reply =
      "I looked at your photo and noticed some shine in your T-zone and small spots. " +
      "It seems like a combination skin type. I recommend a gentle cleanser, oil-free moisturizer, " +
      "and lightweight sunscreen.";

    // Example product cards
    const products = [
      {
        title: "Minimalist 2% Salicylic Acid Serum",
        priceINR: 549,
        url: "https://www.google.com/search?q=Minimalist+2%25+Salicylic+Acid+Serum",
        image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR8WJq7YBzVQxQ",
        details: "For acne-prone or oily skin • Use at night 2-3x a week",
      },
      {
        title: "Plum Green Tea Oil-Free Moisturizer",
        priceINR: 399,
        url: "https://www.google.com/search?q=Plum+Green+Tea+Oil+Free+Moisturizer",
        image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTgK6K7rfYv4kA",
        details: "Hydrating and non-sticky • Great for daily use",
      },
    ];

    return res.status(200).json({ reply, products });
  } catch (err) {
    console.error("Analyze API error:", err);
    return res
      .status(500)
      .json({ reply: "⚠️ Error analyzing the image.", products: [] });
  }
}
