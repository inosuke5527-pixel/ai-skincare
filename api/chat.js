// ai-skincare/api/chat.js
// Single-file chat endpoint. Works on Vercel. Requires: npm i openai

const OpenAI = require("openai");

// ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY; // optional
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// SYSTEM PROMPT
const SYSTEM_PROMPT = process.env.SKIN_COACH_SYSTEM_PROMPT ?? `
You are “Skin Coach”, a friendly dermatologist-informed assistant for a skincare app.

SCOPE: Dermatology/skin care only (skin types, concerns, routines, ingredients, suitability, patch testing, lifestyle impacts).
If out of scope → say: “I can only help with dermatology and skin-care topics.” Then offer examples of what you CAN help with.

INTAKE FIRST: Before recommending products or showing links/images/prices, collect essentials:
1) Skin type (oily/dry/combination/sensitive/normal/unknown)
2) Main concerns (acne, pigmentation, redness, wrinkles, texture, pores)
3) Sensitivities/allergies + active meds (e.g., isotretinoin, pregnancy/breastfeeding)
4) Current routine basics (AM/PM) + budget range
Ask max 2–3 concise questions at a time. Be warm and concise.

RECOMMENDATIONS:
- After intake is complete, suggest routine and ingredients first (what/why/how often).
- Products only if the user asks. Plain text first; add links/prices only on request.

FOLLOW-UPS:
- If asked “Is this product good for me?”, evaluate fit vs their profile, give a short verdict, usage tips, and patch-test advice.
- Avoid diagnosis or cures; suggest seeing a dermatologist for severe/persistent issues.

TONE: Empathetic, clear, brief.
`;

// Helpers
function isGreeting(t=""){ return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t); }
function isDermTopic(t=""){
  const allow=["skin","skincare","dermatology","acne","pimple","blackhead","whitehead","hyperpigmentation","melasma","dark spots","wrinkle","fine lines","rosacea","eczema","psoriasis","seborrheic","dandruff","spf","sunscreen","niacinamide","retinol","retinoid","aha","bha","salicylic","glycolic","lactic","azelaic","ceramide","moisturizer","cleanser","toner","serum","patch test","comedogenic","non-comedogenic","oil control","sebum","barrier repair","fragrance-free","benzoyl peroxide","vitamin c","ascorbic"];
  const x=t.toLowerCase(); return allow.some(w=>x.includes(w));
}
function intakeComplete(i){ if(!i) return false; return ["skinType","concerns","sensitivities","routineBasics"].every(k=>i[k]&&String(i[k]).trim()); }
function sanitize(text="",hide){ if(!hide) return text; return text.replace(/https?:\/\/\S+/g,"[link hidden until we finish your skin profile]").replace(/[₹$]\s?\d[\d,.,]*/g,"[price hidden until we finish your skin profile]"); }

// Optional product fetcher (only if you set SERPAPI_KEY and allowProducts = true)
async function fetchProducts(query){
  try{
    if(!SERPAPI_KEY) return [];
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine","google_shopping");
    url.searchParams.set("q",query);
    url.searchParams.set("gl","in");
    url.searchParams.set("hl","en");
    url.searchParams.set("api_key",SERPAPI_KEY);
    const r = await fetch(url.toString(),{ cache:"no-store" });
    if(!r.ok) return [];
    const j = await r.json();
    return (j.shopping_results||[]).slice(0,6).map(p=>{
      const image = p.thumbnail || p.product_photos?.[0]?.link || p.image || p.rich_product?.images?.[0] || null;
      const priceINR = typeof p.extracted_price==="number" ? Math.round(p.extracted_price) : null;
      return {
        title: p.title || "",
        priceINR,
        price: priceINR ? `₹${priceINR.toLocaleString("en-IN")}` : (p.price || ""),
        url: p.link || p.product_link || null,
        image,
        details: [p.source,p.condition,p.delivery].filter(Boolean).join(" • "),
      };
    }).filter(p=>p.title && p.image);
  }catch{ return []; }
}

// Handler
module.exports = async function handler(req, res){
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return res.status(405).json({ error:"Method not allowed" });

  try{
    if(!OPENAI_API_KEY){
      return res.status(200).json({ reply:"Server error: OPENAI_API_KEY is missing.", products:[] });
    }

    const body = req.body || {};
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const intake = body?.intake || {};
    const allowProducts = !!body?.allowProducts;

    const lastUser = [...messages].reverse().find(m=>m.role==="user");
    const userText = (lastUser?.content || "").trim();

    // Friendly start
    if(isGreeting(userText) && !intakeComplete(intake)){
      return res.status(200).json({
        reply: "Hi! I can help with skin care. What’s your skin type (oily/dry/combination/sensitive)? And your top 1–2 concerns (e.g., acne, pigmentation, redness)?",
        products: []
      });
    }

    // Scope guard (before intake)
    if(!isDermTopic(userText) && !intakeComplete(intake)){
      return res.status(200).json({
        reply: "I can only help with dermatology and skin-care topics. For example: build a routine, pick a sunscreen, evaluate an ingredient, or get acne/pigmentation support. What would you like to work on?",
        products: []
      });
    }

    const needsIntake = !intakeComplete(intake);
    const metaGuard = needsIntake
      ? "IMPORTANT: Intake isn’t complete. Do NOT include links, images, or prices. Ask up to 2–3 short questions to complete intake."
      : (allowProducts ? "User may want product suggestions. Keep reasoning first and concise."
                       : "Do NOT include links/images/prices unless the user explicitly asks.");

    // AI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: metaGuard },
        ...messages,
      ],
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "Sorry—could you say that another way?";
    reply = sanitize(reply, needsIntake || !allowProducts);

    // Optional product cards (only when allowed AND user asked)
    let products = [];
    if(allowProducts){
      const askForOptions = /\b(show|recommend|suggest|options|buy|links?)\b/i.test(userText);
      if(askForOptions){
        const q = userText || "skincare";
        products = await fetchProducts(q);
      }
    }

    return res.status(200).json({ reply, products });
  }catch(err){
    console.error("Chat API error:", err);
    const msg = err?.message || String(err);
    return res.status(200).json({ reply: "Server error: " + msg, products: [] });
  }
};
