// /api/chat.js
export default async function handler(req, res) {
  // --- CORS ---
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (req.method === "OPTIONS") {
    return res.status(200).set(CORS).end();
  }
  if (req.method !== "POST") {
    return res.status(405).set(CORS).json({ error: "Use POST" });
  }

  try {
    const { messages = [], profile = {} } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).set(CORS).json({ error: "messages array required" });
    }

    // --- Detect hair queries to avoid asking for skin type redundantly ---
    const lastUser = [...messages].reverse().find(m => m?.role === "user");
    const lastText = (lastUser?.content || "").toLowerCase();
    const isHair =
      /\b(hair|shampoo|conditioner|condition|scalp|dandruff|hairfall|split ends|heat protect|wash my hair)\b/i.test(
        lastText
      );

    // --- System instructions for the model ---
    const sys = {
      role: "system",
      content: `
You are a friendly AI coach that helps with **skincare and haircare**.
User profile (may be empty): ${JSON.stringify(profile)}

Rules:
- If the question is about **HAIR**, focus on haircare only. Do *not* ask for skin type.
- If the question is about **SKIN**, use profile data when possible (type, concerns, routine time). Ask for *missing* info only once.
- Avoid repeating the same clarification.
- Give concise, practical steps and bullet points. Offer product-type examples (not strict brand names unless asked).
- If user asks for product names, include 3–5 examples available in India when possible.
      `.trim(),
    };

    const hairHint = isHair
      ? {
          role: "system",
          content:
            "The last user message is about HAIR. Answer strictly about haircare and do not ask for skin-type.",
        }
      : null;

    const modelMessages = hairHint ? [sys, hairHint, ...messages] : [sys, ...messages];

    // --- Call OpenAI ---
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: modelMessages,
        temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return res
        .status(resp.status)
        .set(CORS)
        .json({ error: "LLM request failed", detail: errText });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || "Sorry, I couldn't respond right now.";

    return res.status(200).set(CORS).json({
      reply,
      model: data?.model,
      usage: data?.usage,
    });
  } catch (e) {
    return res.status(500).set(CORS).json({ error: e.message || "Server error" });
  }
}
