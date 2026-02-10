import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDatabase } from "./db.js";
import invoiceRoutes from "./routes/invoices.js";
import webhookRoutes from "./routes/webhooks.js";
import payRoutes from "./routes/pay.js";
import lotteryRoutes from "./routes/lottery.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3090,http://localhost:3000,https://invoice.offmylawn.xyz").split(",");
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

// Initialize database
initDatabase();

// Routes (using short paths to avoid ad blocker detection)
app.use("/v1/inv", invoiceRoutes);
app.use("/v1/hooks", webhookRoutes);
app.use("/v1/spin", lotteryRoutes);
app.use("/pay", payRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "badassinvoices-api" });
});

app.listen(PORT, () => {
  console.log(`BadassInvoices API running on port ${PORT}`);
});

export default app;
