// ai-skincare/api/chat.js  (DIAGNOSTIC MODE)
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const diag = {
    ok: true,
    where: "Reached ai-skincare/api/chat.js",
    nodeVersion: process.versions?.node || "unknown",
    // show if envs exist (do NOT leak actual key)
    has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    has_SERPAPI_KEY: !!process.env.SERPAPI_KEY,
    package_type: (() => {
      try {
        const pkg = require("../package.json");
        return pkg?.type || "not-set";
      } catch { return "no-package.json-nearby"; }
    })(),
    can_require_openai: false,
    error: null,
  };

  try {
    require.resolve("openai");
    diag.can_require_openai = true;
  } catch (e) {
    diag.can_require_openai = false;
    diag.error = "Cannot find module 'openai'";
  }

  return res.status(200).json(diag);
};
