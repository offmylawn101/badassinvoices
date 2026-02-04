import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDatabase } from "./db.js";
import invoiceRoutes from "./routes/invoices.js";
import webhookRoutes from "./routes/webhooks.js";
import payRoutes from "./routes/pay.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDatabase();

// Routes
app.use("/api/invoices", invoiceRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/pay", payRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "invoicenow-api" });
});

app.listen(PORT, () => {
  console.log(`InvoiceNow API running on port ${PORT}`);
});

export default app;
