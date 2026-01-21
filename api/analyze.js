// /api/analyze.js

// ✅ IMPORTANT: allow bigger base64 payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb", // increase if needed
    },
  },
};

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { imageBase64, mode = "auto", locale = "auto" } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ reply: "No image received.", products: [], detected: { kind: "unknown" } });
    }

    // If base64 already has a prefix, keep it; otherwise add jpeg prefix
    const isDataUrl = /^data:image\/[a-zA-Z]+;base64,/.test(imageBase64);
    const dataUrl = isDataUrl ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;

    const normalizedMode = String(mode || "auto").toLowerCase();

    // ---- Language hint (simple) ----
    const lang =
      locale && locale !== "auto"
        ? String(locale)
        : "en"; // keep English if you don't pass locale

    // ---- Prompt ----
    const system = `
You are a careful skincare assistant with vision.
You will look at the image and respond ONLY with valid JSON.
Do NOT include markdown. Do NOT include extra text outside JSON.

Rules:
- If the image is a PRODUCT photo: identify the product if possible (brand/name/variant) and give usage + safety tips.
- If the image is a FACE/SKIN photo: give general observations (oiliness, redness, acne-like spots) WITHOUT diagnosing.
- Be honest if you are not sure.
- Keep advice practical and safe.
- Reply language: ${lang}.
Return JSON with this exact shape:
{
  "detected": { "kind": "product" | "skin" | "unknown", "confidence": 0-1, "notes": "short" },
  "reply": "string",
  "products": [
    {
      "name": "string",
      "type": "cleanser|moisturizer|sunscreen|serum|treatment|other",
      "when": "morning|evening|both",
      "howToUse": "string",
      "cautions": "string"
    }
  ]
}

Important:
- Do not invent exact ingredients list if not visible.
- If you can read the label, mention what you can read.
- If mode is "${normalizedMode}" follow it: product => treat as product, skin => treat as skin.
`;

    const userText =
      normalizedMode === "product"
        ? "This is a product photo. Analyze the product."
        : normalizedMode === "skin"
        ? "This is a skin/selfie photo. Analyze the skin."
        : "Decide whether this is a product photo or a skin photo, then analyze accordingly.";

    // ---- Call OpenAI (Vision) ----
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: system.trim() },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        reply: "⚠️ OpenAI error while analyzing the image.",
        products: [],
        detected: { kind: "unknown", confidence: 0, notes: raw.slice(0, 300) },
      });
    }

    let parsedUpstream;
    try {
      parsedUpstream = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        reply: "⚠️ Bad response from AI (not JSON).",
        products: [],
        detected: { kind: "unknown", confidence: 0, notes: raw.slice(0, 300) },
      });
    }

    const content = parsedUpstream?.choices?.[0]?.message?.content || "";

    // The model should return JSON string. Parse it.
    let out;
    try {
      out = JSON.parse(content);
    } catch {
      // fallback if the model accidentally returned text around JSON
      const first = content.indexOf("{");
      const last = content.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        try {
          out = JSON.parse(content.slice(first, last + 1));
        } catch {
          out = null;
        }
      }
    }

    if (!out || typeof out !== "object") {
      return res.status(200).json({
        reply: "I couldn’t reliably read that image. Try a clearer photo with good lighting.",
        products: [],
        detected: { kind: "unknown", confidence: 0.2, notes: "parse_failed" },
      });
    }

    // Normalize output safety
    const reply = typeof out.reply === "string" ? out.reply : "Done.";
    const products = Array.isArray(out.products) ? out.products.slice(0, 6) : [];
    const detected =
      out.detected && typeof out.detected === "object"
        ? out.detected
        : { kind: "unknown", confidence: 0.2, notes: "" };

    return res.status(200).json({ reply, products, detected });
  } catch (err) {
    console.error("Analyze API error:", err);
    return res.status(500).json({ reply: "⚠️ Error analyzing the image.", products: [], detected: { kind: "unknown" } });
  }
}
