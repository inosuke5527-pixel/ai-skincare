// api/chat.js  (CommonJS, safe on Vercel without ESM)
// Requires: npm i openai

const OpenAI = require("openai");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY; // optional

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const SYSTEM_PROMPT = process.env.SKIN_COACH_SYSTEM_PROMPT ?? `
You are “Skin Coach”, a friendly dermatologist-informed assistant for a skincare app.
SCOPE: Dermatology/skin care only…
(INTAKE FIRST / RECOMMENDATIONS / FOLLOW-UPS / TONE — same as before)
`;

function isGreeting(t=""){ return /\b(hi|hello|hey|hola|namaste|yo)\b/i.test(t); }
function isDermTopic(t=""){
  const allow=["skin","skincare","dermatology","acne","pimple","blackhead","whitehead","hyperpigmentation","melasma","dark spots","wrinkle","fine lines","rosacea","eczema","psoriasis","seborrheic","dandruff","spf","sunscreen","niacinamide","retinol","retinoid","aha","bha","salicylic","glycolic","lactic","azelaic","ceramide","moisturizer","cleanser","toner","serum","patch test","comedogenic","non-comedogenic","oil control","sebum","barrier repair","fragrance-free","benzoyl peroxide","vitamin c","ascorbic"];
  const x=t.toLowerCase(); return allow.some(w=>x.includes(w));
}
function intakeComplete(i){ if(!i) return false; return ["skinType","concerns","sensitivities","routineBasics"].every(k=>i[k]&&String(i[k]).trim()); }
function sanitize(text="",hide){ if(!hide) return text; return text.replace(/https?:\/\/\S+/g,"[link hidden until we finish your skin profile]").replace(/[₹$]\s?\d[\d,.,]*/g,"[price hidden until we finish your skin profile]"); }

module.exports = async function handler(req, res){
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

    if(isGreeting(userText) && !intakeComplete(intake)){
      return res.status(200).json({
        reply: "Hi! I can help with skin care. What’s your skin type (oily/dry/combination/sensitive)? And your top 1–2 concerns (e.g., acne, pigmentation, redness)?",
        products: []
      });
    }

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

    return res.status(200).json({ reply, products: [] });
  }catch(err){
    console.error("Chat API error:", err);
    const msg = err?.message || String(err);
    return res.status(200).json({ reply: "Server error: " + msg, products: [] });
  }
};
