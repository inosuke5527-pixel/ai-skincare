// /api/analyze.js

// ✅ Increase body size to handle image base64 payload
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "35mb",
    },
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Try to parse JSON from OpenAI error text safely
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Extract JSON from model output (sometimes wrapped in ```json)
function extractJsonFromText(raw = "") {
  const txt = String(raw || "").trim();

  // remove ```json fences
  const cleaned = txt
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  // try direct parse
  const direct = safeJsonParse(cleaned);
  if (direct) return direct;

  // try to find first {...} block
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1);
    const maybe = safeJsonParse(slice);
    if (maybe) return maybe;
  }

  return null;
}

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      images = [],       // array of base64 strings
      imageBase64,       // fallback for single image
      mode = "auto",
      locale = "auto",
      promptText = "",
    } = req.body || {};

    // 1) consolidate image input
    let targets = [];
    if (Array.isArray(images) && images.length > 0) {
      targets = images;
    } else if (imageBase64) {
      targets = [imageBase64];
    }

    if (targets.length === 0) {
      return res.status(400).json({ reply: "No images received.", products: [] });
    }

    // ✅ IMPORTANT: keep image count small to avoid TPM explosion
    // You can change this number if needed, but 1–2 is safest.
    const MAX_IMAGES = 2;
    targets = targets.slice(0, MAX_IMAGES);

    const normalizedMode = String(mode || "auto").toLowerCase();
    const lang = locale && locale !== "auto" ? String(locale) : "en";

    // 2) build multimodal user message
    const userContent = [];

    const userInstruction =
      (promptText ? `User question: ${promptText}\n\n` : "") +
      (normalizedMode === "product"
        ? "These are product photos. Identify the product names and how to use them."
        : "Analyze these images. If products are visible, identify them. If skin is visible, give general observations (no diagnosis).");

    userContent.push({ type: "text", text: userInstruction });

    targets.forEach((b64) => {
      const url = String(b64 || "").startsWith("data:")
        ? b64
        : `data:image/jpeg;base64,${b64}`;

      userContent.push({
        type: "image_url",
        image_url: { url, detail: "low" }, // low = cheaper/faster
      });
    });

    // 3) system prompt
    const system = `
You are a skincare assistant with vision.

Tasks:
1) Identify ALL distinct skincare products visible across all images.
2) If skin is visible, give general observations (no diagnosis).
3) Respond in ${lang}.
4) Return a SINGLE JSON object ONLY (no extra text).

Return JSON format:
{
  "reply": "short helpful summary",
  "products": [
    {
      "name": "string",
      "type": "cleanser|moisturizer|sunscreen|serum|treatment|other",
      "when": "morning|evening|both",
      "howToUse": "short instruction",
      "cautions": "short caution"
    }
  ],
  "detected": { "kind": "mixed", "confidence": 1, "notes": "processed batch" }
}
`.trim();

    // 4) call OpenAI with retry on 429
    const url = "https://api.openai.com/v1/chat/completions";
    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      // ✅ reduce max_tokens to reduce TPM usage
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    };

    const MAX_RETRIES = 3;
    let upstream = null;
    let errText = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      // ✅ If rate-limited, wait and retry
      if (upstream.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = upstream.headers.get("retry-after");
        const waitMs = retryAfter
          ? Math.ceil(parseFloat(retryAfter) * 1000)
          : 1200 * (attempt + 1); // 1.2s, 2.4s, 3.6s
        await sleep(waitMs);
        continue;
      }

      break;
    }

    if (!upstream || !upstream.ok) {
      errText = upstream ? await upstream.text() : "No upstream response";
      const errJson = safeJsonParse(errText);

      // ✅ friendly rate limit response for your app UI
      if (upstream && upstream.status === 429) {
        return res.status(429).json({
          error: "RATE_LIMIT",
          message: "Too many requests right now. Please try again in a moment.",
          details: errJson || errText,
        });
      }

      return res.status(upstream ? upstream.status : 500).json({
        error: "OpenAI Error",
        message: "AI service failed. Please try again.",
        details: errJson || errText,
      });
    }

    const data = await upstream.json();
    const rawContent = data?.choices?.[0]?.message?.content || "";

    // 5) parse JSON output safely
    let out = extractJsonFromText(rawContent);
    if (!out) out = { reply: String(rawContent || "Done."), products: [] };

    // safety normalize
    out.reply = out.reply || "Done.";
    out.products = Array.isArray(out.products) ? out.products : [];

    return res.status(200).json(out);
  } catch (err) {
    console.error("Batch Analyze Error:", err);
    return res.status(500).json({
      error: "Server Error",
      message: "Server crashed while analyzing.",
      details: String(err?.message || err),
    });
  }
}
