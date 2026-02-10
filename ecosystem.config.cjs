module.exports = {
  apps: [
    {
      name: "invoicenow-api",
      cwd: "./api",
      script: "npx",
      args: "tsx src/index.ts",
      watch: false,
      env: {
        NODE_ENV: "development",
        PORT: 3091,
      },
    },
    {
      name: "invoicenow-app",
      cwd: "./app",
      script: "npx",
      args: "next dev -p 3090",
      watch: false,
      env: {
        NODE_ENV: "development",
        NEXT_PUBLIC_API_URL: "http://localhost:3091",
      },
    },
    {
      name: "invoicenow-agent",
      cwd: "./agent",
      script: "npx",
      args: "tsx src/cron.ts",
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
