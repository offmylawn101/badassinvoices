import OpenAI from "openai";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { sendReminderEmail, sendWeeklySummary } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use shared database with API
const dbPath = path.join(__dirname, "..", "..", "api", "invoicenow.db");
const db = new Database(dbPath);

let _openai: OpenAI;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

interface Invoice {
  id: string;
  creator_wallet: string;
  client_email: string | null;
  amount: number;
  token_mint: string;
  due_date: number;
  memo: string | null;
  status: string;
  reminder_count: number;
  last_reminder_at: number | null;
  line_items: string | null;
}

const SYSTEM_PROMPT = `You are an AI agent managing invoices for BadassInvoices, a Solana-based invoicing platform.

Your responsibilities:
1. Monitor pending invoices and identify those needing attention
2. Send payment reminders with appropriate urgency based on due dates
3. Track payment status on-chain
4. Generate reports and summaries for creators

Reminder strategy:
- 3 days before due: gentle reminder
- On due date: firm reminder
- 1-3 days overdue: urgent reminder
- 7+ days overdue: urgent reminder (final notice)

Only send reminders to invoices that have a client email.
Do not send more than one reminder per invoice per day (check last_reminder_at).
Be helpful and proactive. Take actions that will help creators get paid faster.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_pending_invoices",
      description: "Get all pending (unpaid) invoices",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_overdue_invoices",
      description: "Get all overdue invoices (past due date and still unpaid)",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice_details",
      description: "Get detailed information about a specific invoice",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "The invoice ID" },
        },
        required: ["invoice_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_reminder",
      description: "Send a payment reminder email for an invoice",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "The invoice ID to send reminder for" },
          urgency: {
            type: "string",
            enum: ["gentle", "firm", "urgent"],
            description: "The urgency level of the reminder",
          },
        },
        required: ["invoice_id", "urgency"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_payment_status",
      description: "Check if an invoice has been paid on-chain",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "The invoice ID to check" },
        },
        required: ["invoice_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_summary",
      description: "Generate a summary report of invoice status for the creator",
      parameters: {
        type: "object",
        properties: {
          wallet: { type: "string", description: "The creator's wallet address" },
        },
        required: ["wallet"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_all_creators",
      description: "Get a list of all unique creator wallet addresses that have invoices",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

/**
 * Invoice Agent - AI-powered invoice management
 */
export class InvoiceAgent {
  async run(task: string): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: task },
    ];

    console.log(`\nAgent task: ${task}\n`);

    let response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages,
      tools,
    });

    let choice = response.choices[0];

    // Agentic loop
    while (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      // Add assistant message with tool calls
      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const name = toolCall.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          console.error(`Failed to parse tool arguments for ${name}:`, toolCall.function.arguments);
          args = {};
        }

        console.log(`Tool: ${name}`);
        console.log(`Input: ${JSON.stringify(args)}`);

        const result = await this.executeTool(name, args);
        console.log(`Result: ${(result || "").substring(0, 200)}...`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      response = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4096,
        messages,
        tools,
      });

      choice = response.choices[0];
    }

    return choice.message.content || "";
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    switch (name) {
      case "get_pending_invoices":
        return this.getPendingInvoices();
      case "get_overdue_invoices":
        return this.getOverdueInvoices();
      case "get_invoice_details":
        return this.getInvoiceDetails(input.invoice_id as string);
      case "send_reminder":
        return this.sendReminder(input.invoice_id as string, input.urgency as string);
      case "check_payment_status":
        return this.checkPaymentStatus(input.invoice_id as string);
      case "generate_summary":
        return this.generateSummary(input.wallet as string);
      case "get_all_creators":
        return this.getAllCreators();
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  }

  private getPendingInvoices(): string {
    const invoices = db
      .prepare(`SELECT * FROM invoices WHERE status = 'pending' ORDER BY due_date ASC`)
      .all() as Invoice[];

    return JSON.stringify({
      count: invoices.length,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        amount: inv.amount,
        dueDate: new Date(inv.due_date * 1000).toISOString(),
        daysUntilDue: Math.ceil((inv.due_date - Date.now() / 1000) / 86400),
        clientEmail: inv.client_email,
        reminderCount: inv.reminder_count,
        lastReminderAt: inv.last_reminder_at
          ? new Date(inv.last_reminder_at * 1000).toISOString()
          : null,
        memo: inv.memo,
      })),
    });
  }

  private getOverdueInvoices(): string {
    const now = Math.floor(Date.now() / 1000);
    const invoices = db
      .prepare(`SELECT * FROM invoices WHERE status = 'pending' AND due_date < ? ORDER BY due_date ASC`)
      .all(now) as Invoice[];

    return JSON.stringify({
      count: invoices.length,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        amount: inv.amount,
        dueDate: new Date(inv.due_date * 1000).toISOString(),
        daysOverdue: Math.ceil((now - inv.due_date) / 86400),
        clientEmail: inv.client_email,
        reminderCount: inv.reminder_count,
        lastReminderAt: inv.last_reminder_at
          ? new Date(inv.last_reminder_at * 1000).toISOString()
          : null,
      })),
    });
  }

  private getInvoiceDetails(invoiceId: string): string {
    const invoice = db
      .prepare(`SELECT * FROM invoices WHERE id = ?`)
      .get(invoiceId) as Invoice | undefined;

    if (!invoice) {
      return JSON.stringify({ error: "Invoice not found" });
    }

    const now = Math.floor(Date.now() / 1000);

    return JSON.stringify({
      ...invoice,
      dueDateFormatted: new Date(invoice.due_date * 1000).toISOString(),
      isOverdue: invoice.due_date < now,
      daysUntilDue: Math.ceil((invoice.due_date - now) / 86400),
      lastReminderFormatted: invoice.last_reminder_at
        ? new Date(invoice.last_reminder_at * 1000).toISOString()
        : null,
    });
  }

  private async sendReminder(invoiceId: string, urgency: string): Promise<string> {
    const invoice = db
      .prepare(`SELECT * FROM invoices WHERE id = ?`)
      .get(invoiceId) as Invoice | undefined;

    if (!invoice) {
      return JSON.stringify({ error: "Invoice not found" });
    }

    if (!invoice.client_email) {
      return JSON.stringify({ error: "No client email on invoice" });
    }

    if (invoice.status !== "pending") {
      return JSON.stringify({ error: "Invoice is not pending" });
    }

    // Don't send more than one reminder per day
    if (invoice.last_reminder_at) {
      const hoursSinceLastReminder = (Date.now() / 1000 - invoice.last_reminder_at) / 3600;
      if (hoursSinceLastReminder < 24) {
        return JSON.stringify({
          skipped: true,
          message: `Reminder already sent ${Math.round(hoursSinceLastReminder)}h ago, skipping`,
        });
      }
    }

    try {
      await sendReminderEmail(invoice, urgency);

      db.prepare(
        `UPDATE invoices SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?`
      ).run(Math.floor(Date.now() / 1000), invoiceId);

      return JSON.stringify({
        success: true,
        message: `${urgency} reminder sent to ${invoice.client_email}`,
      });
    } catch (error: any) {
      return JSON.stringify({ error: error.message });
    }
  }

  private checkPaymentStatus(invoiceId: string): string {
    const invoice = db
      .prepare(`SELECT * FROM invoices WHERE id = ?`)
      .get(invoiceId) as Invoice | undefined;

    if (!invoice) {
      return JSON.stringify({ error: "Invoice not found" });
    }

    return JSON.stringify({
      invoiceId,
      status: invoice.status,
      isPaid: invoice.status === "paid",
    });
  }

  private async generateSummary(wallet: string): Promise<string> {
    const invoices = db
      .prepare(`SELECT * FROM invoices WHERE creator_wallet = ?`)
      .all(wallet) as Invoice[];

    const pending = invoices.filter((i) => i.status === "pending");
    const paid = invoices.filter((i) => i.status === "paid");
    const now = Math.floor(Date.now() / 1000);
    const overdue = pending.filter((i) => i.due_date < now);

    return JSON.stringify({
      totalInvoices: invoices.length,
      pending: pending.length,
      paid: paid.length,
      overdue: overdue.length,
      totalPendingAmount: pending.reduce((sum, i) => sum + i.amount, 0),
      totalPaidAmount: paid.reduce((sum, i) => sum + i.amount, 0),
      overdueInvoices: overdue.map((i) => ({
        id: i.id,
        amount: i.amount,
        daysOverdue: Math.ceil((now - i.due_date) / 86400),
      })),
    });
  }

  private getAllCreators(): string {
    const rows = db
      .prepare(`SELECT DISTINCT creator_wallet FROM invoices`)
      .all() as { creator_wallet: string }[];
    return JSON.stringify({
      count: rows.length,
      wallets: rows.map((r) => r.creator_wallet),
    });
  }
}

// Can be run standalone: npx tsx src/index.ts
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js");
if (isMainModule) {
  const { config } = await import("dotenv");
  config();
  const agent = new InvoiceAgent();
  const result = await agent.run(
    "Check for any overdue invoices and send appropriate reminders based on urgency level"
  );
  console.log("\nAgent response:", result);
}
