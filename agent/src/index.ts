import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { sendReminderEmail, sendWeeklySummary } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use shared database with API
const dbPath = path.join(__dirname, "..", "..", "api", "invoicenow.db");
const db = new Database(dbPath);

const anthropic = new Anthropic();

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
}

interface AgentAction {
  type: "send_reminder" | "send_summary" | "check_payment" | "escalate";
  invoiceId?: string;
  reason: string;
}

/**
 * Invoice Agent - AI-powered invoice management
 */
export class InvoiceAgent {
  private tools: Anthropic.Messages.Tool[] = [
    {
      name: "get_pending_invoices",
      description: "Get all pending (unpaid) invoices",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "get_overdue_invoices",
      description: "Get all overdue invoices (past due date and still unpaid)",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "get_invoice_details",
      description: "Get detailed information about a specific invoice",
      input_schema: {
        type: "object" as const,
        properties: {
          invoice_id: {
            type: "string",
            description: "The invoice ID",
          },
        },
        required: ["invoice_id"],
      },
    },
    {
      name: "send_reminder",
      description: "Send a payment reminder email for an invoice",
      input_schema: {
        type: "object" as const,
        properties: {
          invoice_id: {
            type: "string",
            description: "The invoice ID to send reminder for",
          },
          urgency: {
            type: "string",
            enum: ["gentle", "firm", "urgent"],
            description: "The urgency level of the reminder",
          },
        },
        required: ["invoice_id", "urgency"],
      },
    },
    {
      name: "check_payment_status",
      description: "Check if an invoice has been paid on-chain",
      input_schema: {
        type: "object" as const,
        properties: {
          invoice_id: {
            type: "string",
            description: "The invoice ID to check",
          },
        },
        required: ["invoice_id"],
      },
    },
    {
      name: "generate_summary",
      description: "Generate a summary report of invoice status for the creator",
      input_schema: {
        type: "object" as const,
        properties: {
          wallet: {
            type: "string",
            description: "The creator's wallet address",
          },
        },
        required: ["wallet"],
      },
    },
  ];

  /**
   * Run the agent with a specific task
   */
  async run(task: string): Promise<string> {
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: task,
      },
    ];

    console.log(`\nAgent task: ${task}\n`);

    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: `You are an AI agent managing invoices for BadassInvoices, a Solana-based invoicing platform.

Your responsibilities:
1. Monitor pending invoices and identify those needing attention
2. Send payment reminders with appropriate urgency based on due dates
3. Track payment status on-chain
4. Generate reports and summaries for creators

Reminder strategy:
- 3 days before due: gentle reminder
- On due date: firm reminder
- 1-3 days overdue: urgent reminder
- 7+ days overdue: final notice

Be helpful and proactive. Take actions that will help creators get paid faster.`,
      messages,
      tools: this.tools,
    });

    // Agentic loop
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === "tool_use"
      );

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`Tool: ${toolUse.name}`);
        console.log(`Input: ${JSON.stringify(toolUse.input)}`);

        const result = await this.executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );

        console.log(`Result: ${result.substring(0, 200)}...`);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({
        role: "assistant",
        content: response.content,
      });

      messages.push({
        role: "user",
        content: toolResults,
      });

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: `You are an AI agent managing invoices for BadassInvoices.`,
        messages,
        tools: this.tools,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text"
    );

    return textBlocks.map((b) => b.text).join("\n");
  }

  /**
   * Execute a tool call
   */
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
        return this.sendReminder(
          input.invoice_id as string,
          input.urgency as string
        );

      case "check_payment_status":
        return this.checkPaymentStatus(input.invoice_id as string);

      case "generate_summary":
        return this.generateSummary(input.wallet as string);

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  }

  private getPendingInvoices(): string {
    const invoices = db
      .prepare(
        `SELECT * FROM invoices WHERE status = 'pending' ORDER BY due_date ASC`
      )
      .all() as Invoice[];

    return JSON.stringify({
      count: invoices.length,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        amount: inv.amount,
        dueDate: new Date(inv.due_date * 1000).toISOString(),
        daysUntilDue: Math.ceil(
          (inv.due_date - Date.now() / 1000) / 86400
        ),
        clientEmail: inv.client_email,
        reminderCount: inv.reminder_count,
        memo: inv.memo,
      })),
    });
  }

  private getOverdueInvoices(): string {
    const now = Math.floor(Date.now() / 1000);
    const invoices = db
      .prepare(
        `SELECT * FROM invoices WHERE status = 'pending' AND due_date < ? ORDER BY due_date ASC`
      )
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

  private async sendReminder(
    invoiceId: string,
    urgency: string
  ): Promise<string> {
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

    try {
      await sendReminderEmail(invoice, urgency);

      // Update reminder count
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

    // In production, this would check on-chain status
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

    const summary = {
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
    };

    return JSON.stringify(summary);
  }
}

// Main entry point
async function main() {
  const agent = new InvoiceAgent();

  // Example tasks the agent can handle
  const tasks = [
    "Check for any overdue invoices and send appropriate reminders",
    "Review all pending invoices and identify any that need attention",
    "Generate a summary of invoice status",
  ];

  // Run first task as demo
  const result = await agent.run(tasks[0]);
  console.log("\nAgent response:", result);
}

main().catch(console.error);
