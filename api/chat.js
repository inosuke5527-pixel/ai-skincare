// ai-skincare/api/chat.js — universal, safe diagnostic
export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).end();

    // Basic GET route for browser testing
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        message: "GET works — your route is alive 🎉",
        nodeVersion: process.versions?.node || "unknown",
      });
    }

    // POST echo for Hoppscotch
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({ ok: false, error: "Invalid JSON" });
        }
      }

      return res.status(200).json({
        ok: true,
        received: body || {},
        message: "POST works too ✅",
      });
    }

    // Other methods
    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("Crash caught:", err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
