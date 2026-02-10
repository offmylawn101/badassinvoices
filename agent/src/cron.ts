import cron from "node-cron";
import dotenv from "dotenv";
import { InvoiceAgent } from "./index.js";

dotenv.config();

const agent = new InvoiceAgent();

console.log("BadassInvoices Agent Cron Service Started");
console.log("=====================================");

// Run every hour - check for invoices needing reminders
cron.schedule("0 * * * *", async () => {
  console.log(`\n[${new Date().toISOString()}] Hourly check...`);

  try {
    const result = await agent.run(
      "Check for any overdue invoices and send appropriate reminders based on urgency level"
    );
    console.log("Agent completed:", result);
  } catch (error) {
    console.error("Agent error:", error);
  }
});

// Run daily at 9am - check for invoices due today
cron.schedule("0 9 * * *", async () => {
  console.log(`\n[${new Date().toISOString()}] Daily morning check...`);

  try {
    const result = await agent.run(
      "Review all pending invoices. For any due today, send a firm reminder. For any due in the next 3 days, send a gentle reminder."
    );
    console.log("Agent completed:", result);
  } catch (error) {
    console.error("Agent error:", error);
  }
});

// Run weekly on Monday at 8am - send summary reports
cron.schedule("0 8 * * 1", async () => {
  console.log(`\n[${new Date().toISOString()}] Weekly summary...`);

  try {
    const result = await agent.run(
      "Generate a summary report of all invoices and their status."
    );
    console.log("Agent completed:", result);
  } catch (error) {
    console.error("Agent error:", error);
  }
});

console.log("\nScheduled tasks:");
console.log("- Hourly: Check for overdue invoices");
console.log("- Daily 9am: Check invoices due soon");
console.log("- Weekly Monday 8am: Summary reports");
console.log("\nWaiting for scheduled tasks...\n");
