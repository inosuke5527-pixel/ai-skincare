// /api/chat.js
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are “Skin Coach”, a friendly skincare & haircare guide.
Speak casually (like texting a friend) — short, warm, practical, with emojis (🌿✨😊).
Help with skincare & haircare: routines, product types, and general guidance. No medical advice.
If skin type or concern is unknown, ask about it before suggesting products.
`;

const L = (t = "") => t.toLowerCase();

function isGreeting(t = "") {
  return /\b(hi|hello|hey|hola|namaste)\b/i.test(t);
}
function isConfused(t = "") {
  return /\b(i don.?t (know|understand)|idk|confused)\b/i.test(L(t));
}
function askedForRoutine(t = "") {
  return /\b(routine|before bed|night|morning|am|pm)\b/i.test(t);
}
function askedForProducts(t = "") {
  return /\b(show|link|price|buy|shop|where to buy)\b/i.test(t);
}
function asksWhichProduct(t = "") {
  const x = L(t);
  return (
    /\b(which|what|recommend|suggest|use|good|best|product|name|should i)\b/i.test(x) ||
    /\b(i don.?t know|i don.?t knwo|product name)\b/i.test(x)
  );
}
function mentionsBudget(t = "") {
  return /\b(budget|cheap|expensive|under|affordable|price range)\b/i.test(L(t));
}

function updateIntakeFromUtterance(intake = {}, text = "") {
  const x = L(text);
  if (/\boily\b/.test(x)) intake.skinType = "oily";
  else if (/\bdry\b/.test(x)) intake.skinType = "dry";
  else if (/\bcombo|combination\b/.test(x)) intake.skinType = "combination";
  else if (/\bsensitive\b/.test(x)) intake.skinType = "sensitive";
  if (/\bacne\b/.test(x)) intake.concerns = "acne";
  else if (/\bpigment|dark spot\b/.test(x)) intake.concerns = "pigmentation";
  else if (/\bhair fall|dandruff\b/.test(x)) intake.concerns = "haircare";
  return intake;
}

function exampleNames(type = "normal") {
  switch (type) {
    case "oily":
      return {
        Cleanser: ["CeraVe Foaming Facial Cleanser", "La Roche-Posay Effaclar Gel", "Minimalist Salicylic Acid Wash"],
        Serum: ["The Ordinary Niacinamide 10% + Zinc 1%", "Minimalist Niacinamide 10%", "Dot & Key Niacinamide Serum"],
        Moisturizer: ["Neutrogena Hydro Boost Gel", "Re’equil Oil-Free Moisturizer", "Clinique Hydrating Jelly"],
      };
    case "dry":
      return {
        Cleanser: ["CeraVe Hydrating Cleanser", "Cetaphil Gentle Cleanser", "Simple Micellar Gel Wash"],
        Serum: ["The Ordinary Hyaluronic Acid 2% + B5", "Plum Hyaluronic Serum", "Minimalist Sepicalm 3%"],
        Moisturizer: ["CeraVe Moisturizing Cream", "Cetaphil Cream", "La Roche-Posay Toleriane Sensitive"],
      };
    case "sensitive":
      return {
        Cleanser: ["Avene Cleanance Hydrating Gel", "Simple Refreshing Cleanser", "Bioderma Sensibio"],
        Serum: ["Avene Hydrance Serum", "La Roche-Posay Hyalu B5", "Minimalist Sepicalm 3%"],
        Moisturizer: ["Avene Hydrance Rich Cream", "Simple Replenishing Cream", "La Shield Calming Moisturizer"],
      };
    default:
      return {
        Cleanser: ["CeraVe Foaming Cleanser", "Simple Refreshing Cleanser", "Neutrogena Gentle Cleanser"],
        Serum: ["The Ordinary Hyaluronic Acid 2%", "Minimalist Niacinamide 10%", "Plum Hyaluronic Serum"],
        Moisturizer: ["CeraVe Lotion", "Cetaphil Moisturizer", "Re’equil Ceramide Lotion"],
      };
  }
}

async function fetchProducts(query) {
  if (!process.env.SERPAPI_KEY) return [];
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", query);
  u.searchParams.set("gl", "in");
  u.searchParams.set("hl", "en");
  u.searchParams.set("api_key", process.env.SERPAPI_KEY);
  const r = await fetch(u);
  const j = await r.json();
  return (j.shopping_results || [])
    .slice(0, 6)
    .map((p) => ({
      title: p.title,
      price: p.price || "",
      url: p.link,
      image: p.thumbnail,
    }))
    .filter((x) => x.title);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  if (!process.env.OPENAI_API_KEY)
    return res.status(200).json({ reply: "Server missing API key.", products: [] });

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    let intake = body.intake || {};
    const allowProducts = body.allowProducts ?? true;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = (lastUser?.content || "").trim();
    intake = updateIntakeFromUtterance(intake, text);

    // 👋 Greeting
    if (isGreeting(text))
      return res.status(200).json({
        reply: "hey! 👋 tell me your skin or scalp type (oily, dry, combo, sensitive) — i’ll suggest products that really suit you.",
        products: [],
        intake,
      });

    // 🤔 Confused
    if (isConfused(text))
      return res.status(200).json({
        reply: "no worries 😊 just tell me your skin type (oily, dry, combo, sensitive) and your main concern — like acne or dullness — i’ll guide you!",
        products: [],
        intake,
      });

    // 🧴 Product question
    if (asksWhichProduct(text)) {
      if (!intake.skinType)
        return res.status(200).json({
          reply: "sure 😊 before i suggest exact products, could you tell me your skin type — oily, dry, combo, or sensitive?",
          products: [],
          intake,
        });

      const list = exampleNames(intake.skinType);
      const r = [
        `based on your **${intake.skinType} skin**, here are some product examples 👇`,
        `• **Cleanser** → ${list.Cleanser.join(" / ")}`,
        `• **Serum** → ${list.Serum.join(" / ")}`,
        `• **Moisturizer** → ${list.Moisturizer.join(" / ")}`,
        "",
        "want to see prices or links? just say “show products for cleanser/serum/moisturizer 💸”.",
      ].join("\n");
      return res.status(200).json({ reply: r, products: [], intake });
    }

    // 💸 Show products with links
    if (allowProducts && askedForProducts(text)) {
      const query = `${intake.skinType || ""} ${intake.concerns || ""} skincare`;
      const products = await fetchProducts(query);
      return res.status(200).json({
        reply: `here are some options for **${query}**! want me to sort by budget?`,
        products,
        intake,
      });
    }

    // 🌙 Routine
    if (askedForRoutine(text))
      return res.status(200).json({
        reply:
          "here’s a quick **night routine** 🌙\n• Cleanse → gentle cleanser\n• Serum → niacinamide or hyaluronic acid\n• Moisturizer → light cream\nAM ☀️ → Cleanse → Moisturize → SPF 30+.\nwant me to tailor it for your skin type?",
        products: [],
        intake,
      });

    // 💬 Fallback AI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.45,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "could you repeat that for me?";
    return res.status(200).json({ reply, products: [], intake });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ reply: "something went wrong.", products: [] });
  }
}
