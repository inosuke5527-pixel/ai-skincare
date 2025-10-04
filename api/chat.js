// Vercel Serverless Function (Node 18+)
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { messages, profile } = req.body ?? {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages[] required" });
    }

    // NEVER expose your API key in the client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // You can pass lightweight system context (skin type, concerns, region) here
    const system = [
      `You are a skincare coach inside a mobile app.`,
      `User profile: ${JSON.stringify(profile ?? {})}`,
      `Be concise, safe, and prefer India-available products when region=IN.`,
    ].join("\n");

    // Simple non-streaming call using the Responses API
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-5",                 // latest flagship model
        input: messages.map(m => ({ role: m.role, content: m.content })),
        system,                         // system context
        temperature: 0.7
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }

    const data = await r.json();
    // Normalize a plain string back for the client
    const text =
      data?.output?.[0]?.content?.[0]?.text ??
      data?.output_text ??               // fallback if available
      "";

    return res.status(200).json({ reply: text, raw: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}
