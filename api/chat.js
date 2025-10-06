// ai-skincare/api/chat.js  — DIAGNOSTIC VERSION
// Purpose: prove the route works from a normal browser, and echo POST body

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // 1) Preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  // 2) Simple GET so you can test in a browser
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      route: "/api/chat",
      note: "GET works. Now try POST from Hoppscotch.",
      node: process.versions?.node || "unknown",
      has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY, // just a boolean, no secret
    });
  }

  // 3) POST — echo back exactly what the server receives
  if (req.method === "POST") {
    let body = req.body;

    // If Hoppscotch sends a string, parse it safely
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        return res.status(400).json({ ok: false, error: "Bad JSON string" });
      }
    }

    // If nothing was sent, default to {}
    if (!body || typeof body !== "object") body = {};

    return res.status(200).json({
      ok: true,
      received: body,
      hint: "If this shows your JSON, the route is fine. Next we put the AI back."
    });
  }

  // Any other method
  return res.status(405).json({ ok: false, error: "Method not allowed" });
};
