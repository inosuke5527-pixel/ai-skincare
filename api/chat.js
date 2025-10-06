// /api/chat.js
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------ personality ------------------------ */
const SYSTEM_PROMPT = `
You are “Skin Coach”, a friendly skincare & haircare guide.
Be short, clear, and casual. Emojis okay 🌿
Help with routines, product ideas, and gentle advice (not medical).
If skin type is unknown, ask for it BEFORE giving product names.
If skin type is known, tailor suggestions to that type and don't list all types.
`;

/* -------------------------- helpers -------------------------- */
const L = (t = "") => t.toLowerCase();
const isGreeting = (t="") => /\b(hi|hello|hey|hola|namaste)\b/i.test(t);
const isConfused = (t="") => /\b(i don.?t (know|understand)|idk|confused)\b/i.test(L(t));
const askedForRoutine = (t="") => /\b(routine|night|before bed|morning|am|pm)\b/i.test(t);
const askedForProducts = (t="") => /\b(show|link|price|prices|buy|where to buy|shopping)\b/i.test(t);
const asksWhichProduct = (t="") => {
  const x = L(t);
  return /\b(which|what|recommend|suggest|use|good|best|product|products|name|should i)\b/.test(x)
      || /\b(i don.?t know( the)? product name)\b/.test(x);
};

function updateIntakeFromUtterance(intake = {}, text = "") {
  const x = L(text);
  if (/\boily\b/.test(x)) intake.skinType = "oily";
  else if (/\bdry\b/.test(x)) intake.skinType = "dry";
  else if (/\bcombo|combination\b/.test(x)) intake.skinType = "combination";
  else if (/\bsensitive\b/.test(x)) intake.skinType = "sensitive";
  else if (/\bnormal\b/.test(x)) intake.skinType = "normal";

  if (/\bacne|pimple|breakout\b/.test(x)) intake.concerns ??= "acne";
  else if (/\bpigment|dark spot|melasma\b/.test(x)) intake.concerns ??= "pigmentation";
  else if (/\bdandruff\b/.test(x)) intake.concerns ??= "dandruff";
  else if (/\bhair ?fall|hair ?loss\b/.test(x)) intake.concerns ??= "hair fall";
  return intake;
}

// curated name lists per type (no links)
function productNamesByType(type = "normal") {
  switch (type) {
    case "oily":
      return {
        Cleanser: ["CeraVe Foaming Facial Cleanser", "La Roche-Posay Effaclar Purifying Gel", "Minimalist Salicylic Acid Face Wash"],
        Serum: ["The Ordinary Niacinamide 10% + Zinc 1%", "Minimalist Niacinamide 10%", "Paula’s Choice 2% BHA (sparingly)"],
        Moisturizer: ["Neutrogena Hydro Boost Water Gel", "Re’equil Oil-Free Moisturizer", "Clinique Hydrating Jelly"]
      };
    case "dry":
      return {
        Cleanser: ["CeraVe Hydrating Cleanser", "Cetaphil Gentle Skin Cleanser", "Simple Micellar Gel Wash"],
        Serum: ["The Ordinary Hyaluronic Acid 2% + B5", "Plum 2% Hyaluronic Serum", "La Roche-Posay Hyalu B5"],
        Moisturizer: ["CeraVe Moisturizing Cream", "Cetaphil Moisturising Cream", "La Roche-Posay Toleriane Sensitive"]
      };
    case "combination":
      return {
        Cleanser: ["CeraVe Foaming Cleanser", "Simple Refreshing Face Wash", "Neutrogena Ultra Gentle Daily Cleanser"],
        Serum: ["Niacinamide 10% (Minimalist / The Ordinary)", "Hyaluronic Acid 2% (The Ordinary)", "Minimalist Sepicalm 3% (calming)"],
        Moisturizer: ["CeraVe Daily Moisturizing Lotion", "Re’equil Ceramide & HA Moisturizer", "Cetaphil Oil-Free Hydrating Lotion"]
      };
    case "sensitive":
      return {
        Cleanser: ["Bioderma Sensibio", "Simple Refreshing Cleanser", "Avene Extremely Gentle Cleanser"],
        Serum: ["Minimalist Sepicalm 3%", "La Roche-Posay Hyalu B5", "Avene Hydrance"],
        Moisturizer: ["Avene Hydrance Rich Cream", "La Roche-Posay Toleriane Dermallergo", "Simple Replenishing Rich"]
      };
    default:
      return {
        Cleanser: ["CeraVe Foaming Cleanser", "Simple Micellar Gel Wash", "Neutrogena Gentle Cleanser"],
        Serum: ["The Ordinary Hyaluronic Acid 2% + B5", "Minimalist Niacinamide 10%", "Dot & Key Niacinamide"],
        Moisturizer: ["CeraVe Daily Moisturizing Lotion", "Cetaphil Moisturising Lotion", "Re’equil Ceramide & HA Moisturizer"]
      };
  }
}

/* --------------- optional: shopping cards via SerpAPI ---------------- */
async function fetchProducts(query) {
  if (!process.env.SERPAPI_KEY) return [];
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", query);
  u.searchParams.set("gl", "in");
  u.searchParams.set("hl", "en");
  u.searchParams.set("api_key", process.env.SERPAPI_KEY);
  const r = await fetch(u.toString(), { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.shopping_results || []).slice(0,6).map(p => ({
    title: p.title || "",
    price: p.price || (typeof p.extracted_price === "number" ? `₹${Math.round(p.extracted_price).toLocaleString("en-IN")}` : ""),
    url: p.link || "",
    image: p.thumbnail || p.image || p.product_photos?.[0]?.link || "",
    details: [p.source, p.condition, p.delivery].filter(Boolean).join(" • ")
  })).filter(x => x.title && x.image);
}

/* --------------------------- API handler --------------------------- */
export default async function handler(req, res) {
  // CORS for Expo/Web
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ reply: "Server missing OPENAI_API_KEY.", products: [], intake: {} });
  }

  try {
    const { messages = [], intake = {}, allowProducts = true } = req.body || {};
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const userText = (lastUser?.content || "").trim();

    // remember new info
    let remembered = updateIntakeFromUtterance({ ...intake }, userText);

    // 0) greeting / confused
    if (isGreeting(userText)) {
      return res.status(200).json({
        reply: "hey! 👋 tell me your skin type (oily, dry, combo, sensitive) and your top goal — acne, glow, dandruff, hair fall — i’ll tailor a quick plan.",
        products: [],
        intake: remembered
      });
    }
    if (isConfused(userText)) {
      return res.status(200).json({
        reply: "no worries 😊 start with your skin type (oily, dry, combo, sensitive) and goal (acne, glow, etc.). i’ll guide you step by step.",
        products: [],
        intake: remembered
      });
    }

    // 1) routine request
    if (askedForRoutine(userText)) {
      return res.status(200).json({
        reply: "here’s a quick **night routine** 🌙\n• Cleanse → gentle cleanser\n• Serum → niacinamide or hyaluronic acid\n• Moisturizer → light cream\nAM ☀️ → Cleanse → Moisturize → SPF 30+.\nwant me to tailor it for your skin type?",
        products: [],
        intake: remembered
      });
    }

    // 2) user asks which product → gate on skin type
    if (asksWhichProduct(userText)) {
      if (!remembered.skinType) {
        return res.status(200).json({
          reply: "sure! before i name products, what’s your skin type — oily, dry, combo, or sensitive?",
          products: [],
          intake: remembered
        });
      }
      const names = productNamesByType(remembered.skinType);
      const reply =
        `based on your **${remembered.skinType} skin**, try these:\n` +
        `• **Cleanser** → ${names.Cleanser.join(" / ")}\n` +
        `• **Serum** → ${names.Serum.join(" / ")}\n` +
        `• **Moisturizer** → ${names.Moisturizer.join(" / ")}\n\n` +
        `want **links & prices** too? say “show products for cleanser/serum/moisturizer”.`;
      return res.status(200).json({ reply, products: [], intake: remembered });
    }

    // 3) links/prices/cards
    if (allowProducts && askedForProducts(userText)) {
      const qParts = [];
      if (remembered.skinType) qParts.push(remembered.skinType);
      if (remembered.concerns) qParts.push(remembered.concerns);
      const query = (qParts.join(" ") || userText || "skincare").trim();
      const products = await fetchProducts(query);
      const reply = products.length
        ? `here are some options for **${query}**. want me to narrow by budget or ingredients?`
        : `i couldn’t find good matches for **${query}**. try “show products for niacinamide serum” or “oil-free gel moisturizer”.`;
      return res.status(200).json({ reply, products, intake: remembered });
    }

    // 4) normal chat fallback (keeps memory)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.45,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
      ]
    });
    const reply = completion.choices?.[0]?.message?.content?.trim() || "okay!";
    return res.status(200).json({ reply, products: [], intake: remembered });

  } catch (err) {
    console.error("chat error:", err);
    return res.status(200).json({ reply: "oops, something went wrong.", products: [], intake: {} });
  }
}
