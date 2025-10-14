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
    const isGreeting = /\b(hi|hello|hey|yo|hola|merhaba|नमस्ते|salam|selam|सलाम)\b/i.test(lastTextRaw);

    // Hard scope gate: refuse off-topic before calling OpenAI
    if (!isDermQuery(lastText)) {
  if (isGreeting) {
    const HELLO = {
      hi: "नमस्ते! 🌿 मैं स्किन/हेयर के बारे में मदद कर सकता/सकती हूँ — किस परेशानी में मदद चाहिए?",
      ar: "مرحبًا! 🌿 أستطيع مساعدتك في العناية بالبشرة أو الشعر — ما الذي يزعجك؟",
      tr: "Merhaba! 🌿 Cilt veya saç bakımı hakkında yardımcı olabilirim — sorun nedir?",
      ru: "Привет! 🌿 Помогу с уходом за кожей или волосами — что беспокоит?",
      en: "Hey there! 🌿 I can help with skincare or haircare — what’s bothering you?",
    };
    return send(200, { reply: HELLO[userLang] || HELLO.en });
  }
  const REFUSALS = {
    hi: "माफ़ कीजिए, मैं केवल स्किनकेयर/हेयरकेयर में मदद करता/करती हूँ। कृपया इसी विषय में पूछें।",
    ar: "عذرًا، يمكنني المساعدة فقط في العناية بالبشرة والشعر والأمراض الجلدية.",
    tr: "Üzgünüm, yalnızca cilt ve saç bakımı/dermatoloji konularında yardımcı olabilirim.",
    ru: "Извините, я отвечаю только по уходу за кожей, волосами и дерматологии.",
    en: "Sorry—I can help only with skincare, haircare, and dermatology.",
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
You are "Nia", a friendly, caring skincare assistant.
Speak like a kind friend who gives skincare and haircare advice with empathy and encouragement.
Always reply in the same language the user speaks.
If the question is NOT related to skincare, haircare, or dermatology, gently guide them back with a short and polite message — for example:
- Hindi: "Hey, main skincare aur haircare expert hoon 🌸, batao tumhara concern kya hai?"
- English: "Hey! I'm your skincare & haircare buddy 🌿 — tell me your skin concern!"
Avoid sounding robotic or overly professional.
Keep your tone warm, positive, short, and use simple language with light emojis when fitting.
When giving skincare tips, sound encouraging and natural like a beauty influencer or best friend.
User profile (may be empty): ${JSON.stringify(profile)}
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
