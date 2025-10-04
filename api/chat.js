// /api/chat.js  (in your GitHub repo that Vercel deploys)
export default async function handler(req, res) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).set(CORS).end();
  }

  if (req.method !== "POST") {
    return res.status(405).set(CORS).json({ error: "Use POST" });
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).set(CORS).json({ error: "messages array required" });
    }

    // --- call OpenAI (or your current LLM provider) ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: "You are a helpful skincare coach." },
          ...messages.map(m => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content || "").slice(0, 4000),
          })),
        ],
      }),
    });

    const payload = await r.json();
    if (!r.ok) {
      console.error("Upstream error:", payload);
      return res.status(500).set(CORS).json({ error: "upstream_error", detail: payload });
    }

    const reply = payload?.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).set(CORS).json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(500).set(CORS).json({ error: "server_error" });
  }
}
