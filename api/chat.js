// api/chat.js
export default async function handler(req, res) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(200, CORS);
    return res.end();
  }

  if (req.method !== "POST") {
    res.writeHead(405, CORS);
    return res.end(JSON.stringify({ error: "Use POST" }));
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, CORS);
    return res.end(JSON.stringify({ error: "messages array required" }));
  }

  if (!process.env.OPENAI_API_KEY) {
    res.writeHead(500, CORS);
    return res.end(JSON.stringify({ error: "OPENAI_API_KEY missing on server" }));
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
    if (!r.ok) {
      res.writeHead(r.status, CORS);
      return res.end(JSON.stringify(data));
    }

    const reply = data.choices?.[0]?.message?.content ?? "";
    res.writeHead(200, CORS);
    return res.end(JSON.stringify({ reply }));
  } catch (e) {
    res.writeHead(500, CORS);
    return res.end(JSON.stringify({ error: String(e) }));
  }
}
