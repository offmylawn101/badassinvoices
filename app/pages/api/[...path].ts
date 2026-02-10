import type { NextApiRequest, NextApiResponse } from "next";

const API_URL = process.env.API_BACKEND_URL || "http://localhost:3091";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { path } = req.query;
  const pathString = Array.isArray(path) ? path.join("/") : path;

  // Build the target URL
  const url = new URL(`/${pathString}`, API_URL);

  // Forward query params
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== "path" && typeof value === "string") {
      url.searchParams.set(key, value);
    }
  });

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    // Only include body for methods that support it, and only if there's actual content
    if (req.method !== "GET" && req.method !== "HEAD" && req.body && Object.keys(req.body).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    // Try to parse as JSON, but handle non-JSON responses
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).send(text);
    }
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Proxy error", details: String(error) });
  }
}
