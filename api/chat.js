// /api/chat.js
import { getDb, requireUser, admin } from "./_firebaseAdmin.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);

    // retry on rate limit / temporary server errors
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
      await sleep(900 * (attempt + 1)); // 0.9s, 1.8s, 2.7s
      continue;
    }

    return res;
  }
}
// ✅ AI daily limit
const FREE_DAILY_LIMIT = 5;

function dayKeyInKolkata(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export default async function handler(req, res) {
  // ---- CORS ----
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
    // ✅ IMPORTANT: show clear error if API key missing
    if (!process.env.OPENAI_API_KEY) {
      return send(500, {
        error: "Server misconfigured",
        message: "OPENAI_API_KEY is missing in Vercel environment variables.",
      });
    }

    const body = req.body || {};
    const {
      messages = [],
      locale: localeFromApp = "auto",
      systemPrompt: systemPromptFromApp = "",
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return send(400, { error: "messages array required" });
    }
// ✅ Check login + daily limit
const decoded = await requireUser(req);
if (!decoded?.uid) {
  return send(401, { error: "UNAUTHORIZED", message: "Login required" });
}

const uid = decoded.uid;
const db = getDb();
const userRef = db.collection("users").doc(uid);

const todayKey = dayKeyInKolkata();
let info = { isPremium: false, used: 0, limit: FREE_DAILY_LIMIT };

await db.runTransaction(async (tx) => {
  const snap = await tx.get(userRef);
  const data = snap.exists ? snap.data() : {};

  const isPremium = !!data?.premium?.isPremium;

  const ai = data?.ai || {};
  const lastResetKey = ai?.lastResetKey || null;
  let dailyUsed = Number(ai?.dailyUsed || 0);

  if (lastResetKey !== todayKey) {
    dailyUsed = 0;
    tx.set(userRef, { ai: { dailyUsed: 0, lastResetKey: todayKey } }, { merge: true });
  }

  const limit = isPremium ? 999999 : FREE_DAILY_LIMIT;
  info = { isPremium, used: dailyUsed, limit };

  if (!isPremium && dailyUsed >= limit) return;

  tx.set(
    userRef,
    { ai: { dailyUsed: admin.firestore.FieldValue.increment(1), lastResetKey: todayKey } },
    { merge: true }
  );
});

if (!info.isPremium && info.used >= info.limit) {
  return send(200, {
    error: "LIMIT_REACHED",
    message: "Daily free AI limit reached. Upgrade to Premium.",
  });
}

    const cleanedMessages = (messages || []).filter((m) => {
  const c = String(m?.content || "").trim().toLowerCase();
  if (!c) return false;
  //if (c === "hello" || c === "hi") return false;
  if (c === "thinking..." || c === "analyzing...") return false;
  return m.role === "user" || m.role === "assistant";
});

const trimmedMessages = cleanedMessages.slice(-6); // ✅ now it works
    
    // ---- Helpers ----
const lastUser = [...messages].reverse().find((m) => m?.role === "user");
const lastTextRaw = (lastUser?.content || "").trim();
const lastText = lastTextRaw.toLowerCase();

const detectLang = (s = "") => {
  if (/[ऀ-ॿ]/.test(s)) return "hi";
  if (/[اأإآء-ي]/.test(s)) return "ar";
  if (/[а-яё]/i.test(s)) return "ru";
  if (/[ğüşöçıİĞÜŞÖÇ]/i.test(s)) return "tr";
  if (/\b(kaise|kese|kya|kyu|nahi|haan|madad|meri|mera|chehra|chehre|dard|khujli|daane|daag)\b/i.test(s))
    return "hi";
  return "en";
};

// ✅ MOVE THIS UP HERE (before SORRY / off-topic checks)
const userLang =
  localeFromApp && localeFromApp !== "auto"
    ? localeFromApp
    : detectLang(lastTextRaw);


    const isGreeting = /\b(hi|hello|hey|yo|namaste|namaskar|salam|as-?salaam|what'?s up|sup|hola|merhaba|privet)\b/i.test(
      lastText
    );

    const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const containsWord = (list, text) =>
      list.some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(text));

    const offTopicTerms = [
      "laptop",
      "notebook",
      "macbook",
      "ipad",
      "tablet",
      "phone",
      "mobile",
      "iphone",
      "android",
      "computer",
      "pc",
      "gpu",
      "cpu",
      "tv",
      "camera",
      "drone",
      "headphone",
      "speaker",
      "printer",
      "cars",
      "car insurance",
      "car loan",
      "bike",
      "motorcycle",
      "truck",
      "flight",
      "ticket",
      "hotel",
      "visa",
      "passport",
      "crypto",
      "bitcoin",
      "stocks",
      "tax",
      "loan",
      "mortgage",
      "football",
      "game",
      "match",
      "score",
      "coding",
      "react",
      "javascript",
      "python",
      "homework",
      "math",
      "recipe",
      "food",
      "restaurant",
    ];

    const skincareTerms = [
      "skincare",
      "skin care",
      "routine",
      "steps",
      "order",
      "beginner",
      "acne",
      "pimples",
      "dark spots",
      "pigmentation",
      "marks",
      "spots",
      "sunscreen",
      "spf",
      "moisturizer",
      "cleanser",
      "serum",
      "retinol",
      "vitamin c",
      "niacinamide",
      "salicylic",
      "benzoyl",
      "haircare",
      "hair care",
      "dandruff",
      "hairfall",
      "itchy scalp",
      "cure",
      "treat",
      "treatment",
      "manage",
      "results",
      "ingredients",
      "active",
    ];

    const isSkincareQuestion = containsWord(skincareTerms, lastText);
    const isClearlyOffTopic = !isSkincareQuestion && containsWord(offTopicTerms, lastText);

    if (isClearlyOffTopic) {
      const SORRY = {
        hi: "माफ़ कीजिए—मैं सिर्फ़ स्किनकेयर/हेयरकेयर में मदद कर सकता/सकती हूँ। अगर त्वचा या बालों से जुड़ा सवाल है, बताइए 🙂",
        ar: "عذرًا—أستطيع المساعدة فقط في العناية بالبشرة أو الشعر. إن كان سؤالك عنهما فأخبرني 🙂",
        tr: "Üzgünüm—yalnızca cilt ve saç bakımı konusunda yardımcı olabiliyorum. Bu konularda soruların varsa memnuniyetle 🙂",
        ru: "Извини — я помогаю только с уходом за кожей и волосами. Если вопрос об этом — с радостью помогу 🙂",
        en: "Sorry—I can help only with skincare and haircare. If you have a skin or hair question, I’m all yours 🙂",
      };
      return send(200, { reply: SORRY[userLang] || SORRY.en });
    }

    const systemBase =
  "You are a friendly dermatology assistant. " +
  "Only discuss skincare/haircare. " +
  "Always reply in the user's language. " +
  "Be concise. Ask at most 1 follow-up question if needed. " +
  "Prefer simple routines (cleanser, moisturizer, sunscreen)." +
  "\n\nVERY IMPORTANT OUTPUT FORMAT:" +
  "\n1) Write the normal helpful answer first." +
  "\n2) Then at the VERY END output the block exactly like this:" +
  "\nROUTINE_PRODUCTS:" +
  "\nPRODUCT: <Category> — <Real example product name> (morning)" +
  "\nPRODUCT: <Category> — <Real example product name> (evening)" +
  "\nRules:" +
  "\n- Category must be one of: Cleanser, Toner, Serum, Moisturizer, Sunscreen, Night Treatment." +
  "\n- Use ONLY (morning) or (evening)." +
  "\n- Max 6 PRODUCT lines total." +
  "\n- Each PRODUCT line must include a real buyable example (brand + product name)." +
  "\n- Do NOT repeat the same product name in both morning and evening. If cleanser is needed at night, use a DIFFERENT cleanser name for evening." +
  "\n- Do NOT write anything after the last PRODUCT line.";







    const profileHint =
  systemPromptFromApp && String(systemPromptFromApp).trim()
    ? `\n\nUSER PROFILE (IMPORTANT: personalize using this):\n${String(systemPromptFromApp).trim()}\n\nRules:\n- Use Skin Type + Concerns + Routine time when giving routine.\n- If user says "add those products to my routine", you must output routine products in the format below.`
    : "";


const systemMessage = {
  role: "system",
  content: systemBase + profileHint,
};


    

    const finalMessages = [systemMessage, ...trimmedMessages];
    const upstream = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 500,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
        messages: finalMessages,
      }),
    });

    const rawText = await upstream.text();

    // ✅ IMPORTANT: return real OpenAI error text in "message" so app shows it
    if (!upstream.ok) {
      return send(upstream.status, {
        error: "OpenAI upstream error",
        message: rawText.slice(0, 1200),
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return send(502, { error: "Bad JSON from upstream", message: rawText.slice(0, 1200) });
    }

    const reply = data?.choices?.[0]?.message?.content || "Sorry, I couldn’t respond right now.";
    return send(200, { reply });
  } catch (err) {
    return send(500, { error: "Server error", message: String(err?.message || err) });
  }
}
