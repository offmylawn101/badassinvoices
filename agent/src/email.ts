import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@invoicenow.app";

interface Invoice {
  id: string;
  creator_wallet: string;
  client_email: string | null;
  amount: number;
  token_mint: string;
  due_date: number;
  memo: string | null;
  reminder_count: number;
}

const URGENCY_SUBJECTS: Record<string, string> = {
  gentle: "Friendly reminder: Invoice {id} is due soon",
  firm: "Payment reminder: Invoice {id} is due",
  urgent: "[URGENT] Invoice {id} is overdue",
};

const URGENCY_INTROS: Record<string, string> = {
  gentle:
    "This is a friendly reminder that your invoice is approaching its due date.",
  firm: "This is a reminder that your invoice is now due for payment.",
  urgent:
    "This invoice is now overdue. Please process payment immediately to avoid any issues.",
};

export async function sendReminderEmail(
  invoice: Invoice,
  urgency: string
): Promise<void> {
  if (!invoice.client_email) {
    throw new Error("No client email");
  }

  const paymentUrl = `${APP_URL}/pay/${invoice.id}`;
  const formattedAmount = formatAmount(invoice.amount, invoice.token_mint);
  const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString();

  const subject = URGENCY_SUBJECTS[urgency]?.replace("{id}", invoice.id) ||
    `Payment reminder for Invoice ${invoice.id}`;

  const intro = URGENCY_INTROS[urgency] || URGENCY_INTROS.firm;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #9945FF, #14F195); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: white; margin: 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; }
        .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #9945FF; }
        .pay-button { display: inline-block; background: #9945FF; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; }
        .urgent { color: #dc3545; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>BadassInvoices</h1>
        </div>
        <div class="content">
          <p class="${urgency === "urgent" ? "urgent" : ""}">${intro}</p>

          <div class="invoice-details">
            <p><strong>Invoice:</strong> ${invoice.id}</p>
            <p><strong>Amount Due:</strong></p>
            <p class="amount">${formattedAmount}</p>
            <p><strong>Due Date:</strong> ${dueDate}</p>
            ${invoice.memo ? `<p><strong>Description:</strong> ${invoice.memo}</p>` : ""}
          </div>

          <center>
            <a href="${paymentUrl}" class="pay-button">Pay Now</a>
          </center>

          <p style="font-size: 14px; color: #666; margin-top: 20px;">
            Pay instantly with your Solana wallet. Near-zero fees, instant settlement.
          </p>
        </div>
        <div class="footer">
          <p>Powered by BadassInvoices</p>
          <p>This is reminder #${invoice.reminder_count + 1} for this invoice.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject,
    html,
  });
}

export async function sendWeeklySummary(
  email: string,
  summary: {
    totalInvoices: number;
    pending: number;
    paid: number;
    overdue: number;
    totalPendingAmount: number;
    totalPaidAmount: number;
  }
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #9945FF, #14F195); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: white; margin: 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; }
        .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
        .stat { background: white; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; }
        .stat-label { color: #666; font-size: 14px; }
        .pending { color: #f59e0b; }
        .paid { color: #10b981; }
        .overdue { color: #ef4444; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Weekly Invoice Summary</h1>
        </div>
        <div class="content">
          <div class="stat-grid">
            <div class="stat">
              <div class="stat-value">${summary.totalInvoices}</div>
              <div class="stat-label">Total Invoices</div>
            </div>
            <div class="stat">
              <div class="stat-value pending">${summary.pending}</div>
              <div class="stat-label">Pending</div>
            </div>
            <div class="stat">
              <div class="stat-value paid">${summary.paid}</div>
              <div class="stat-label">Paid</div>
            </div>
            <div class="stat">
              <div class="stat-value overdue">${summary.overdue}</div>
              <div class="stat-label">Overdue</div>
            </div>
          </div>

          <p>
            <strong>Outstanding:</strong> ${formatAmount(summary.totalPendingAmount, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}<br>
            <strong>Collected:</strong> ${formatAmount(summary.totalPaidAmount, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: email,
    subject: "Your Weekly Invoice Summary - BadassInvoices",
    html,
  });
}

function formatAmount(amount: number, tokenMint: string): string {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const USDC_MINTS = [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ];

  if (tokenMint === SOL_MINT) {
    return `${(amount / 1e9).toFixed(4)} SOL`;
  }

  if (USDC_MINTS.includes(tokenMint)) {
    return `$${(amount / 1e6).toFixed(2)} USDC`;
  }

  return `${(amount / 1e6).toFixed(2)} tokens`;
}
