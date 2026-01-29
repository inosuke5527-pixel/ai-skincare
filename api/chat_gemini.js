// /api/chat_gemini.js

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST" });

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key missing",
      });
    }

    const { messages = [], locale = "en" } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages required" });
    }

    // Take last user message only (cheaper + cleaner)
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const userText = lastUser?.content || "";

    const prompt = `
You are a friendly skincare and haircare assistant.
Only answer skincare or haircare questions.
Give clear, practical, step-by-step advice.
Do NOT give medical diagnosis.
Reply in the same language as the user.

User question:
${userText}
`;

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(200).json({
        reply:
          "⚠️ AI is temporarily unavailable. Please try again later 🙂",
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn’t respond right now.";

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(200).json({
      reply: "⚠️ AI is currently offline. Please try again later 🙂",
    });
  }
}
