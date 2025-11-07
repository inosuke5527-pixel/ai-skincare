// /api/products/search.js  (Node on Vercel)
export default async function handler(req, res) {
  const { q = "" } = req.query;
  if (!q) return res.status(200).json({ products: [] });

  try {
    const r = await fetch(
      `https://sephora.p.rapidapi.com/products/search?query=${encodeURIComponent(q)}&pageSize=5`,
      {
        headers: {
          "x-rapidapi-host": "sephora.p.rapidapi.com",
          "x-rapidapi-key": process.env.RAPIDAPI_KEY, // ← keep secret in Vercel env
        },
      }
    );
    const data = await r.json();
    res.status(200).json({ products: data?.products ?? [] });
  } catch (e) {
    res.status(200).json({ products: [] });
  }
}
