// api/chat.js
export default async function handler(req, res) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (req.method === "OPTIONS") return res.status(200).set(CORS).end();
  if (req.method !== "POST") return res.status(405).set(CORS).json({ error: "Use POST" });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).set(CORS).json({ error: "messages array required" });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).set(CORS).json({ error: "OPENAI_API_KEY missing on server" });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).set(CORS).json(data);

    const reply = data.choices?.[0]?.message?.content ?? "";
    return res.status(200).set(CORS).json({ reply });
  } catch (e) {
    return res.status(500).set(CORS).json({ error: String(e) });
  }
}
