/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Compress responses
  compress: true,

  // Optimize production builds
  swcMinify: true,

  // Cache static assets aggressively
  async headers() {
    return [
      {
        source: '/:all*(svg|jpg|jpeg|png|gif|ico|webp|woff|woff2)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  env: {
    API_URL: process.env.API_URL || "http://localhost:3091",
    SOLANA_RPC: process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com",
  },

  poweredByHeader: false,
};

module.exports = nextConfig;
