// /api/chat.js
export default async function handler(req, res) {
  // --- CORS (same as your original) ---
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };
  const send = (status, obj) => {
    res.writeHead(status, CORS);
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") return send(200, { ok: true });
  if (req.method !== "POST") return send(405, { error: "Use POST" });

  try {
    const {
      messages = [],
      profile = {},
      // optional hints from frontend (safe to ignore if missing)
      systemPrompt,
      locale,
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return send(400, { error: "messages array required" });
    }

    // -------- Language utilities --------
    const detectLang = (s = "") => {
      if (/[ऀ-ॿ]/.test(s)) return "hi";             // Hindi (Devanagari)
      if (/[اأإآء-ي]/.test(s)) return "ar";         // Arabic
      if (/[а-яё]/i.test(s)) return "ru";           // Russian
      if (/[ğüşöçıİĞÜŞÖÇ]/i.test(s)) return "tr";  // Turkish
      return "en";
    };

    // -------- Simple in-domain check (skincare/hair/derm) --------
    const IN_DOMAIN = [
      // general skincare
      "skin","skincare","derma","dermatology","spf","sunscreen","routine","moisturizer","serum",
      "acne","pimple","blackhead","whitehead","pigmentation","melasma","rosacea","eczema","psoriasis",
      "oil","oily","dry","sensitive","combination","redness","dark spot","wrinkle","aging","retinol",
      "niacinamide","salicylic","glycolic","aha","bha","vitamin c","hyaluronic","cleanser","toner",
      // haircare
      "hair","scalp","dandruff","hairfall","hair loss","minoxidil","finasteride","shampoo",
      "conditioner","heat protect","split ends","seborrheic","alopecia",
    ];
    const isDermQuery = (txt = "") => IN_DOMAIN.some((k) => txt.toLowerCase().includes(k));

    // -------- Last user message & routing --------
    const lastUser = [...messages].reverse().find((m) => m?.role === "user");
    const lastText = (lastUser?.content || "");
    const userLang = detectLang(lastText);

    // Hard scope gate: refuse off-topic before calling OpenAI
    if (!isDermQuery(lastText)) {
      const REFUSALS = {
        hi: "माफ़ कीजिए, मैं केवल स्किनकेयर, हेयरकेयर और डर्मेटोलॉजी से जुड़े सवालों में मदद कर सकता/सकती हूँ। कृपया इन्हीं विषयों पर पूछें।",
        ar: "عذرًا، أستطيع المساعدة فقط في العناية بالبشرة والشعر والجلدية. من فضلك اسأل ضمن هذه المواضيع.",
        ru: "Извините, я отвечаю только на вопросы по уходу за кожей, волосами и дерматологии. Пожалуйста, задайте вопрос по этой теме.",
        tr: "Üzgünüm, yalnızca cilt bakımı, saç bakımı ve dermatoloji konularında yardımcı olabilirim. Lütfen bu konularda sorun.",
        en: "Sorry—I can help only with skincare, haircare, and dermatology. Please ask within those topics.",
      };
      return send(200, { reply: REFUSALS[userLang] || REFUSALS.en });
    }

    // Hair-only hint
    const isHair = /\b(hair|shampoo|conditioner|scalp|dandruff|hairfall|hair loss|split ends|heat protect|wash my hair)\b/i.test(
      lastText.toLowerCase()
    );

    // -------- System prompts --------
    const langSystem = {
      role: "system",
      content: systemPrompt || "Always reply in the SAME LANGUAGE as the user's latest message.",
    };

    const systemMessage = {
      role: "system",
      content: `
You are a friendly AI coach for skincare, haircare, and dermatology ONLY.
Reject any request outside these topics with a one-sentence apology and a reminder of your scope.
Use the user's language. Be concise, practical, and non-alarmist.
If the message is about HAIR, answer only about hair (do NOT ask for skin type).
If it's about SKIN, use the profile data; ask for missing info only once.
Avoid repeating the same question.
Prefer bullet points; include 2–3 product examples only if the user asks for products.
User profile: ${JSON.stringify(profile)}
`.trim(),
    };

    const hairHint = isHair
      ? { role: "system", content: "This user is asking about HAIR. Focus only on haircare." }
      : null;

    // Optional extra nudge that copies a slice of the last user text
    const langHint = lastUser
      ? { role: "system", content: "Reply in the same language as this text: " + lastUser.content.slice(0, 240) }
      : null;

    // Final message order matters: language rule first, then domain rules, then hints, then conversation
    const finalMessages = [
      langSystem,
      systemMessage,
      ...(langHint ? [langHint] : []),
      ...(hairHint ? [hairHint] : []),
      ...messages,
    ];

    // -------- OpenAI call --------
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: finalMessages,
        // You can also send user language as a hint via "user" or "metadata" if you wish
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
      return send(upstream.status, {
        error: "OpenAI upstream error",
        detail: rawText.slice(0, 2000),
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return send(502, { error: "Bad JSON from upstream", detail: rawText.slice(0, 2000) });
    }

    const reply = data?.choices?.[0]?.message?.content || "Sorry, I couldn’t respond right now.";
    return send(200, { reply });
  } catch (err) {
    return send(500, { error: String(err) });
  }
}
