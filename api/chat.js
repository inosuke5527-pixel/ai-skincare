// api/chat.js
export default async function handler(req, res) {
  // --- Allow CORS so your app can call this from anywhere ---
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // --- Handle browser preflight ---
  if (req.method === "OPTIONS") {
    return res.status(200).set(CORS).end();
  }

  // --- Only accept POST requests ---
  if (req.method !== "POST") {
    return res.status(405).set(CORS).json({ error: "Use POST" });
  }

  try {
    const { messages = [], profile = {} } = req.body || {};

    if (!Array.isArray(messages)) {
      return res
        .status(400)
        .set(CORS)
        .json({ error: "messages array required" });
    }

    // --- Check if message is about hair ---
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastText = (lastUser?.content || "").toLowerCase();
    const isHair =
      /\b(hair|shampoo|conditioner|scalp|dandruff|hairfall|split ends|heat protect|wash my hair)\b/i.test(
        lastText
      );

    // --- System prompt for the AI ---
    const systemMessage = {
      role: "system",
      content: `
You are a friendly AI skincare and haircare coach.
User profile: ${JSON.stringify(profile)}

Rules:
- If the question is about HAIR, answer only about hair — don’t ask for skin type.
- If the question is about SKIN, use the saved skin type from profile if available.
- Don’t repeat questions like “what’s your skin type” more than once.
- Use short, clear bullet points for advice.
- Offer gentle tone, emojis allowed but not too many.
- If user asks for product examples, give 2–3 common items available in India.
    `.trim(),
    };

    // --- If it’s about hair, add a quick note ---
    const hairHint = isHair
      ? {
          role: "system",
          content:
            "The user is asking about hair. Focus strictly on haircare (avoid skin talk).",
        }
      : null;

    const finalMessages = hairHint
      ? [systemMessage, hairHint, ...messages]
      : [systemMessage, ...messages];

    // --- Call OpenAI ChatGPT API ---
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: finalMessages,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return res
        .status(response.status)
        .set(CORS)
        .json({ error: "OpenAI request failed", details: errText });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content ||
      "Sorry, I couldn’t get a response right now.";

    return res.status(200).set(CORS).json({ reply });
  } catch (err) {
    return res
      .status(500)
      .set(CORS)
      .json({ error: err.message || "Server error" });
  }
}
