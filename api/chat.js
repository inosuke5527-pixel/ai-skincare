// ai-skincare/api/chat.js
// Crash-proof chat route. Returns JSON even if OpenAI package or key is missing.

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1) Check env
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(200).json({
        reply: "Server error: OPENAI_API_KEY is missing (set it in Vercel → Project → Settings → Environment Variables).",
        products: [],
      });
    }

    // 2) Load OpenAI safely (won’t crash if not installed)
    let OpenAI;
    try {
      ({ default: OpenAI } = await import("openai")); // dynamic import, safe in any module mode
    } catch (e) {
      return res.status(200).json({
        reply: "Server error: The 'openai' package is not installed. Run 'npm i openai' in the repo and redeploy.",
        products: [],
      });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // 3) Read request
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = (lastUser?.content || "").trim();

    // 4) Scope + greeting guards (simple, you can expand later)
    if (/^(hi|hello|hey)\b/i.test(text)) {
      return res.status(200).json({
        reply: "Hi! 👋 I’m your Skin Coach. What’s your skin type (oily, dry, combination, sensitive)?",
        products: [],
      });
    }
    const skincareWords = [
      "skin","skincare","dermatology","acne","pimple","blackhead","whitehead",
      "pigmentation","melasma","dark spots","wrinkle","fine lines","rosacea",
      "eczema","psoriasis","dandruff","spf","sunscreen","niacinamide","retinol",
      "salicylic","glycolic","aha","bha","ceramide","moisturizer","cleanser",
      "toner","serum","barrier","oil control","sensitive","dry","oily","combination"
    ];
    const inScope = skincareWords.some((w) => text.toLowerCase().includes(w));
    if (!inScope) {
      return res.status(200).json({
        reply: "I can only help with dermatology and skin-care topics. 😊 Tell me your skin type and main concern?",
        products: [],
      });
    }

    // 5) Actual completion
    const SYSTEM_PROMPT = `
You are “Skin Coach”, a friendly dermatologist-informed assistant.
Only discuss dermatology and skincare. Be short, warm, and clear.
Before suggesting products, ask for skin type, main concerns, and sensitivities.
`;

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
      "Sorry, could you rephrase that?";

    return res.status(200).json({ reply, products: [] });
  } catch (err) {
    console.error("Chat API error:", err);
    return res
      .status(200)
      .json({ reply: "Server error: " + (err?.message || String(err)), products: [] });
  }
}
