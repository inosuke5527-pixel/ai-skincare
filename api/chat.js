// /api/chat.js
export default async function handler(req, res) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
  const send = (status, obj) => { res.writeHead(status, CORS); res.end(JSON.stringify(obj)); };

  if (req.method === "OPTIONS") return send(200, { ok: true });
  if (req.method !== "POST")   return send(405, { error: "Use POST" });

  try {
    const { messages = [], profile = {}, systemPrompt, locale } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return send(400, { error: "messages array required" });
    }

    // ----- hair vs skin routing -----
    const lastUser = [...messages].reverse().find(m => m?.role === "user");
    const lastText = (lastUser?.content || "").toLowerCase();
    const isHair = /\b(hair|shampoo|conditioner|scalp|dandruff|hairfall|split ends|heat protect|wash my hair)\b/i.test(lastText);

    // ----- language mirroring -----
    const defaultSystemLang = "Always reply in the SAME LANGUAGE as the user's latest message.";
    const langSystem = { role: "system", content: systemPrompt || defaultSystemLang };
    const langHint = lastUser
      ? { role: "system", content: "Reply in the same language as this text: " + lastUser.content.slice(0, 240) }
      : null;

    // ----- your domain rules -----
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
    const hairHint = isHair ? { role: "system", content: "This user is asking about HAIR. Focus only on haircare." } : null;

    // Final message order is important
    const finalMessages = [
      langSystem,
      systemMessage,
      ...(langHint ? [langHint] : []),
      ...(hairHint ? [hairHint] : []),
      ...messages,
    ];

    // ----- OpenAI call -----
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

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return send(upstream.status, { error: "OpenAI upstream error", detail: rawText.slice(0, 2000) });
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch { return send(502, { error: "Bad JSON from upstream", detail: rawText.slice(0, 2000) }); }

    const reply = data?.choices?.[0]?.message?.content || "Sorry, I couldn’t respond right now.";
    return send(200, { reply });
  } catch (err) {
    return send(500, { error: String(err) });
  }
}
