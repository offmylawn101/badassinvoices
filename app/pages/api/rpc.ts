import type { NextApiRequest, NextApiResponse } from "next";

// Use a reliable RPC endpoint server-side (not blocked by browsers/ad blockers)
const RPC_URL = process.env.SOLANA_RPC_BACKEND || "https://api.mainnet-beta.solana.com";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    // Pass through the status code from RPC
    if (!response.ok) {
      const text = await response.text();
      console.error("RPC error:", response.status, text);
      res.status(response.status).json({ error: "RPC error", details: text });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error("RPC proxy error:", error);
    res.status(500).json({ error: "RPC request failed", details: String(error) });
  }
}
