// /api/chat.js
export default async function handler(req, res) {
  // ---- CORS ----
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
  const send = (status, obj) => {
    res.writeHead(status, CORS);
    res.end(JSON.stringify(obj));
  };
  if (req.method === "OPTIONS") return send(200, { ok: true });
  if (req.method !== "POST")   return send(405, { error: "Use POST" });

  try {
    const body = req.body || {};
    const {
      messages = [],
      intake = {},
      allowProducts = false,
      // Optional hints from the app:
      locale: localeFromApp = "auto",
      systemPrompt: systemPromptFromApp = ""
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return send(400, { error: "messages array required" });
    }

    // ---- Helpers ----
    const lastUser = [...messages].reverse().find(m => m?.role === "user");
    const lastTextRaw = (lastUser?.content || "").trim();
    const lastText = lastTextRaw.toLowerCase();

    const detectLang = (s = "") => {
      // Script-based
      if (/[ऀ-ॿ]/.test(s)) return "hi";         // Hindi (Devanagari)
      if (/[اأإآء-ي]/.test(s)) return "ar";       // Arabic
      if (/[а-яё]/i.test(s)) return "ru";        // Russian
      if (/[ğüşöçıİĞÜŞÖÇ]/i.test(s)) return "tr";// Turkish
      // Roman Hindi / Hinglish
      if (/\b(kaise|kese|kya|kyu|nahi|haan|madad|meri|mera|chehra|dikh|acne|pimples|sunscreen|moisturizer|baal|bal|dandruff|scalp)\b/i.test(s))
        return "hi";
      return "en";
    };

    const userLang = localeFromApp && localeFromApp !== "auto"
      ? localeFromApp
      : detectLang(lastTextRaw);

    const isGreeting = /\b(hi|hello|hey|yo|namaste|namaskar|salam|as\-?salaam|kaise ho|kese ho|what's up|sup)\b/i.test(lastText);

    // Topics we support (dermatology: skin + hair)
    const dermTerms = [
      // skin
      "skin","skincare","pimple","pimples","acne","acnes","zit","blackhead","whitehead",
      "sunscreen","sun screen","spf","moisturizer","moisturiser","cleanser","facewash","face wash",
      "toner","serum","retinol","niacinamide","vitamin c","glycolic","salicylic","aha","bha",
      "hyperpigmentation","melasma","dark spots","redness","rosacea","eczema","psoriasis","dermatitis",
      // hair
      "hair","haircare","shampoo","conditioner","scalp","dandruff","hairfall","hair loss","split ends","heat protect"
    ];
    const offTopicTerms = [
      "laptop","phone","mobile","iphone","android","computer","pc","gpu","cpu","tv","camera",
      "car","bike","crypto","bitcoin","stocks","tax","visa","flight","hotel","football","game"
    ];

    const contains = (list, text) => list.some(w => text.includes(w));
    const isDermQuery = contains(dermTerms, lastText);
    const isClearlyOffTopic = contains(offTopicTerms, lastText);

    // Refuse only if it's clearly off-topic (laptops, phones, etc.)
if (isClearlyOffTopic) {
  const SORRY = {
    hi: "माफ़ कीजिए—मैं सिर्फ़ स्किनकेयर/हेयरकेयर में मदद कर सकता/सकती हूँ. अगर त्वचा या बालों से जुड़ा सवाल है, बताइए 🙂",
    ar: "عذرًا—يمكنني المساعدة فقط في العناية بالبشرة أو الشعر. إن كان لديك سؤال متعلق بهما فأخبرني 🙂",
    tr: "Üzgünüm—yalnızca cilt ve saç bakımı konusunda yardımcı olabiliyorum. Bu konularda soruların varsa memnuniyetle 🙂",
    ru: "Извини — я помогаю только с уходом за кожей и волосами. Если вопрос об этом — с радостью помогу 🙂",
    en: "Sorry—I can help only with skincare and haircare. If you have a skin or hair question, I’m all yours 🙂"
  };
  return send(200, { reply: SORRY[userLang] || SORRY.en });
}

    // Friendly off-topic refusal
    if (!isDermQuery || isClearlyOffTopic) {
      const SORRY = {
        hi: "माफ़ कीजिए—मैं सिर्फ़ स्किनकेयर/हेयरकेयर में मदद कर सकता/सकती हूँ. अगर त्वचा या बालों से जुड़ा सवाल है, बताइए 🙂",
        ar: "عذرًا—يمكنني المساعدة فقط في العناية بالبشرة أو الشعر. إن كان لديك سؤال متعلق بهما فأخبرني 🙂",
        tr: "Üzgünüm—yalnızca cilt ve saç bakımı konusunda yardımcı olabiliyorum. Bu konularda soruların varsa memnuniyetle 🙂",
        ru: "Извини — я помогаю только с уходом за кожей и волосами. Если вопрос об этом — с радостью помогу 🙂",
        en: "Sorry—I can help only with skincare and haircare. If you have a skin or hair question, I’m all yours 🙂"
      };
      // If message is just small talk like “help” without derm words, we still respond politely:
      if (!isDermQuery) return send(200, { reply: SORRY[userLang] || SORRY.en });
    }

    // ---- Build model messages ----
    const systemBase =
      "You are a warm, friendly dermatology assistant. " +
      "Only discuss skincare, haircare, and dermatology. " +
      "If the user asks about anything else, politely refuse and redirect. " +
      "Be concise, practical, and human—sound like a helpful friend. " +
      "Use short paragraphs or bullets. " +
      "Always reply in the same language as the user's latest message.";

    const systemMessage = {
      role: "system",
      content: (systemPromptFromApp && String(systemPromptFromApp).trim())
        ? `${systemBase}\n\nAdditional app hint: ${systemPromptFromApp}`
        : systemBase
    };

    // Optional hint for language
    const langHint = { role: "system", content: `User language: ${userLang}.` };

    const finalMessages = [systemMessage, langHint, ...messages];

    // ---- Call OpenAI ----
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.5,
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
    return send(200, { reply, intake, allowProducts });
  } catch (err) {
    return send(500, { error: String(err) });
  }
}
