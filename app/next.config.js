/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    API_URL: process.env.API_URL || "http://localhost:3001",
    SOLANA_RPC: process.env.SOLANA_RPC || "https://api.devnet.solana.com",
  },
};

module.exports = nextConfig;
