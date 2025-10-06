// ai-skincare/api/chat.js
// Works on Vercel. Needs your OpenAI key.
// Simple version — just copy–paste and deploy.

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,   // 👈 this will read your key from Vercel
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content?.trim() || "";

    // Simple “hello” and out-of-scope checks
    if (/hi|hello|hey/i.test(userText)) {
      return res.status(200).json({
        reply:
          "Hi! 👋 I’m your Skin Coach. What’s your skin type (oily/dry/combination/sensitive)?",
        products: [],
      });
    }

    if (
      !/skin|acne|pimple|cream|moisturizer|spf|sunscreen|serum/i.test(userText)
    ) {
      return res.status(200).json({
        reply:
          "I can only help with skincare or dermatology topics. Try asking me about your skin routine or concerns 😊",
        products: [],
      });
    }

    // Ask OpenAI for an answer
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are a friendly dermatologist-informed assistant. Only talk about skincare topics.",
        },
        ...messages,
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn’t understand. Could you rephrase?";

    res.status(200).json({ reply, products: [] });
  } catch (err) {
    console.error("Chat API error:", err);
    res
      .status(200)
      .json({ reply: "Server error: " + (err.message || err), products: [] });
  }
}
