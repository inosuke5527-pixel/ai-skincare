// api/chat.js
export default async function handler(req, res) {
  // CORS headers for browser tools (Hoppscotch/Postman in browser)
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  // Helper to send JSON with headers
  function send(status, obj) {
    res.writeHead(status, CORS);
    res.end(JSON.stringify(obj));
  }

  if (req.method === "OPTIONS") return send(200, { ok: true });
  if (req.method !== "POST")   return send(405, { error: "Use POST" });

  try {
    const { messages = [], profile = {} } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return send(400, { error: "messages array required" });
    }

    // Detect hair intent so it won’t ask about skin type on hair questions
    const lastUser = [...messages].reverse().find(m => m?.role === "user");
    const lastText = (lastUser?.content || "").toLowerCase();
    const isHair = /\b(hair|shampoo|conditioner|scalp|dandruff|hairfall|split ends|heat protect|wash my hair)\b/i.test(lastText);

    const systemMessage = {
      role: "system",
      content: `
You are a friendly AI coach for skincare & haircare.
User profile: ${JSON.stringify(profile)}
Rules:
- If the message is about HAIR, answer only about hair (do NOT ask for skin type).
- If it's about SKIN, use the profile data; ask for missing info only once.
- Avoid repeating the same question.
- Keep it concise with practical bullet points; 2–3 example products if asked.
`.trim()
    };

    const hairHint = isHair
      ? { role: "system", content: "This user is asking about HAIR. Focus only on haircare." }
      : null;

    const finalMessages = hairHint ? [systemMessage, hairHint, ...messages] : [systemMessage, ...messages];

    // Call OpenAI
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: finalMessages
      })
    });

    // If upstream fails, return the text so you can see why in Hoppscotch
    const rawText = await upstream.text();
    if (!upstream.ok) {
      return send(upstream.status, { error: "OpenAI upstream error", detail: rawText.slice(0, 2000) });
    }

    let data;
    try { data = JSON.parse(rawText); } catch {
      return send(502, { error: "Bad JSON from upstream", detail: rawText.slice(0, 2000) });
    }

    const reply = data?.choices?.[0]?.message?.content || "Sorry, I couldn’t respond right now.";
    return send(200, { reply });
  } catch (err) {
    return send(500, { error: String(err) });
  }
}
