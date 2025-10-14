export default async function handler(req, res) {
  // === CORS headers ===
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
    const { messages = [], profile = {} } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0)
      return send(400, { error: "messages array required" });

    // === detect last user message ===
    const lastUser = [...messages].reverse().find((m) => m?.role === "user");
    const lastTextRaw = lastUser?.content || "";
    const lastText = lastTextRaw.toLowerCase();

    // === quick language detection ===
    const detectLang = (s = "") => {
  // Script-based
  if (/[ऀ-ॿ]/.test(s)) return "hi"; // Devanagari Hindi
  if (/[اأإآء-ي]/.test(s)) return "ar"; // Arabic
  if (/[а-яё]/i.test(s)) return "ru"; // Russian
  if (/[ğüşöçıİĞÜŞÖÇ]/i.test(s)) return "tr"; // Turkish

  // Roman Hindi / Hinglish words
  if (/\b(kaise|kese|ho|nahi|haan|mera|meri|tum|tera|acha|acne|chehra|bal|skin|dikh|help kar|hai|madad)\b/i.test(s))
    return "hi";

  // Default fallback
  return "en";
};
    const userLang = detectLang(lastTextRaw);

    // === greetings ===
    const isGreeting = /\b(hi|hello|hey|yo|hola|merhaba|नमस्ते|salam|selam|सलाम|kese ho|how are you)\b/i.test(
      lastTextRaw
    );

    // === domain keywords (skin / hair) ===
    const IN_DOMAIN = [
      "skin","skincare","derma","sunscreen","spf","routine","moisturizer","serum","cleanser",
      "toner","mask","cream","gel","acne","pimple","blackhead","pigmentation","eczema",
      "dry","oily","combination","wrinkle","aging","retinol","vitamin c","hair","scalp",
      "dandruff","hairfall","hair fall","shampoo","conditioner","heat protect"
    ];
    const isDermQuery = IN_DOMAIN.some((k) => lastText.includes(k));

    // === Handle greetings nicely ===
    if (isGreeting && !isDermQuery) {
  const HELLO = {
    hi: "अरे नमस्ते! 😊 मैं ठीक हूँ, आप कैसे हैं? 🌿 वैसे मैं स्किन या हेयर केयर में मदद कर सकता/सकती हूँ — बताइए क्या परेशानी है?",
    ar: "مرحبًا! 😊 أنا بخير، وأنت؟ 🌿 يمكنني مساعدتك في العناية بالبشرة أو الشعر، ما المشكلة؟",
    tr: "Merhaba! 😊 Ben iyiyim, ya sen? 🌿 Cilt veya saç bakımı hakkında da yardımcı olabilirim.",
    ru: "Привет! 😊 У меня всё хорошо, а у тебя? 🌿 Помогу с уходом за кожей или волосами, если нужно.",
    en: "Hey! 😊 I’m doing great — how about you? 🌿 By the way, I can also help with skincare or haircare if you’d like.",
  };
  return send(200, { reply: HELLO[userLang] || HELLO.en });
}

    // === Off-topic filter ===
    if (!isDermQuery) {
      const REFUSALS = {
        hi: "माफ़ कीजिए, मैं केवल स्किनकेयर या हेयरकेयर से जुड़े सवालों में मदद कर सकता/सकती हूँ।",
        ar: "عذرًا، أستطيع المساعدة فقط في العناية بالبشرة أو الشعر.",
        tr: "Üzgünüm, yalnızca cilt ve saç bakımıyla ilgili konularda yardımcı olabilirim.",
        ru: "Извините, я отвечаю только на вопросы по уходу за кожей или волосами.",
        en: "Sorry — I can help only with skincare or haircare topics.",
      };
      return send(200, { reply: REFUSALS[userLang] || REFUSALS.en });
    }

    // === hair intent check ===
    const isHair = /\b(hair|shampoo|conditioner|scalp|dandruff|hairfall|hair fall|split ends|heat protect)\b/i.test(
      lastTextRaw
    );

    // === system instructions for OpenAI ===
    const systemMessage = {
      role: "system",
      content: `
You are a friendly AI expert for skincare, haircare, and dermatology.
Always reply in the SAME LANGUAGE as the user.
If about hair, talk only about hair.
If about skin, use skincare info.
Keep tone warm, short, and practical. Use emojis lightly 🌿💧✨.
User profile: ${JSON.stringify(profile)}.
      `.trim(),
    };

    const hairHint = isHair
      ? { role: "system", content: "This user is asking about HAIR. Focus only on haircare." }
      : null;

    const messagesForAI = [systemMessage, ...(hairHint ? [hairHint] : []), ...messages];

    // === call OpenAI ===
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.5,
        messages: messagesForAI,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok)
      return send(upstream.status, { error: "OpenAI error", detail: rawText.slice(0, 2000) });

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return send(502, { error: "Bad JSON from OpenAI", detail: rawText.slice(0, 2000) });
    }

    let reply = data?.choices?.[0]?.message?.content?.trim() || "";

    if (!reply || reply.toLowerCase().includes("okay")) {
      const friendly = {
        hi: "ज़रूर 🌿! बताइए, आपकी स्किन या बालों से जुड़ी क्या परेशानी है?",
        ar: "بالطبع 🌿! أخبرني ما المشكلة في بشرتك أو شعرك؟",
        tr: "Tabii ki 🌿! Cilt veya saçınla ilgili hangi konuda yardım istiyorsun?",
        ru: "Конечно 🌿! Расскажи, что беспокоит твою кожу или волосы?",
        en: "Sure 🌿! Tell me what’s bothering your skin or hair.",
      };
      reply = friendly[userLang] || friendly.en;
    }

    return send(200, { reply });
  } catch (err) {
    return send(500, { error: String(err) });
  }
}
