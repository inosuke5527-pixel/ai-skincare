// /api/analyze.js

// ✅ config: Increase limit to handle 10 images at once
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", 
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
    const {
      images = [],       // ✅ Expecting an array of base64 strings
      imageBase64,       // (Fallback for old single-image calls)
      mode = "auto",
      locale = "auto",
      promptText = "",
    } = req.body || {};

    // 1. Consolidate inputs into a single array
    let targets = [];
    if (Array.isArray(images) && images.length > 0) {
      targets = images;
    } else if (imageBase64) {
      targets = [imageBase64];
    }

    if (targets.length === 0) {
      return res.status(400).json({ reply: "No images received." });
    }

    // 2. Prepare content for OpenAI (Text + Multiple Images)
    const normalizedMode = String(mode || "auto").toLowerCase();
    const lang = locale && locale !== "auto" ? String(locale) : "en";
    
    // Create the "User Message" content array
    const userContent = [];

    // Add the text prompt first
    const userInstruction = 
      (promptText ? `User question: ${promptText}\n\n` : "") +
      (normalizedMode === "product"
        ? "These are product photos. Analyze them."
        : "Analyze these images (could be products or skin).");
    
    userContent.push({ type: "text", text: userInstruction });

    // Add ALL images to the same message
    targets.forEach((b64) => {
      // Ensure prefix
      const url = b64.startsWith("data:") 
        ? b64 
        : `data:image/jpeg;base64,${b64}`;
      
      userContent.push({
        type: "image_url",
        image_url: { url: url, detail: "low" } // 'low' is faster & cheaper for batching
      });
    });

    // 3. System Prompt
    const system = `
      You are a skincare assistant with vision.
      You have received ${targets.length} image(s).
      
      Tasks:
      1. Identify ALL distinct skincare products visible across all images.
      2. If skin is visible, give general observations (no diagnosis).
      3. Return a SINGLE combined JSON object.

      Reply Language: ${lang}

      Return JSON format:
      {
        "reply": "Summary text mentioning what you found in these ${targets.length} photos.",
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

    // 4. Call OpenAI (One Request!)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Fast & capable of multi-image
        max_tokens: 1000,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: "OpenAI Error", details: errText });
    }

    const data = await upstream.json();
    const rawContent = data?.choices?.[0]?.message?.content || "";

    // 5. Parse JSON
    let out = {};
    try {
      // Clean markdown code blocks if present
      const clean = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
      out = JSON.parse(clean);
    } catch (e) {
      out = { reply: rawContent, products: [] };
    }

    // Safety checks
    out.reply = out.reply || "Done.";
    out.products = Array.isArray(out.products) ? out.products : [];

    return res.status(200).json(out);

  } catch (err) {
    console.error("Batch Analyze Error:", err);
    return res.status(500).json({ error: "Server Error", details: String(err) });
  }
}
