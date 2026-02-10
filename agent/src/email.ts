import { Resend } from "resend";

let _resend: Resend;
function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const APP_URL = process.env.APP_URL || "https://invoice.offmylawn.xyz";
const FROM_EMAIL = process.env.FROM_EMAIL || "invoices@offmylawn.xyz";
const LOGO_URL = `${APP_URL}/logo.png?v=3`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface Invoice {
  id: string;
  creator_wallet: string;
  client_email: string | null;
  amount: number;
  token_mint: string;
  due_date: number;
  memo: string | null;
  reminder_count: number;
  line_items?: string | null;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

function parseLineItems(invoice: Invoice): LineItem[] | null {
  if (!invoice.line_items) return null;
  try {
    const items = typeof invoice.line_items === "string"
      ? JSON.parse(invoice.line_items)
      : invoice.line_items;
    return Array.isArray(items) && items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function buildLineItemsHtml(items: LineItem[], tokenMint: string): string {
  const rows = items.map((item) => `
    <tr>
      <td style="padding: 10px 12px; color: #d1d5db; font-size: 14px; border-bottom: 1px solid #2a2a3e;">${escapeHtml(item.description)}</td>
      <td style="padding: 10px 8px; color: #9ca3af; font-size: 14px; text-align: center; border-bottom: 1px solid #2a2a3e;">${item.quantity}</td>
      <td style="padding: 10px 12px; color: #9ca3af; font-size: 14px; text-align: right; border-bottom: 1px solid #2a2a3e;">${formatAmount(item.unitPrice, tokenMint)}</td>
      <td style="padding: 10px 12px; color: #e5e5e5; font-size: 14px; text-align: right; font-weight: 600; border-bottom: 1px solid #2a2a3e;">${formatAmount(item.quantity * item.unitPrice, tokenMint)}</td>
    </tr>
  `).join("");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0 8px; border-collapse: collapse; border: 1px solid #FFD70033; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #0a0a1a;">
          <th style="padding: 10px 12px; color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; font-weight: 600;">Item</th>
          <th style="padding: 10px 8px; color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; font-weight: 600;">Qty</th>
          <th style="padding: 10px 12px; color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; font-weight: 600;">Price</th>
          <th style="padding: 10px 12px; color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; font-weight: 600;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function emailShell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>BadassInvoices</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
          ${content}
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 0; text-align: center;">
              <p style="margin: 0 0 4px; color: #4b5563; font-size: 12px;">Powered by <span style="color: #FFD700;">BadassInvoices</span> on Solana</p>
              <p style="margin: 0; color: #374151; font-size: 11px;">Instant payments. Near-zero fees.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const URGENCY_CONFIG: Record<string, { subject: string; heading: string; description: string }> = {
  gentle: {
    subject: "Friendly reminder: Invoice {id} is due soon",
    heading: "Friendly payment reminder",
    description: "This is a reminder that your invoice is approaching its due date.",
  },
  firm: {
    subject: "Payment reminder: Invoice {id} is due",
    heading: "Payment reminder",
    description: "This is a reminder that your invoice is now due for payment.",
  },
  urgent: {
    subject: "[URGENT] Invoice {id} is overdue",
    heading: "This invoice is overdue",
    description: "Please process payment immediately to avoid any issues.",
  },
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
  const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const isOverdue = urgency === "urgent";
  const reminderNumber = invoice.reminder_count + 1;
  const lineItems = parseLineItems(invoice);

  const config = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.firm;
  const subject = config.subject.replace("{id}", invoice.id);
  const statusColor = isOverdue ? "#DC2626" : "#FFD700";
  const statusText = isOverdue ? "OVERDUE" : "REMINDER";

  const content = `
    <tr>
      <td style="background: linear-gradient(135deg, ${isOverdue ? "#DC2626" : "#FFD700"}, #B8860B); padding: 28px 32px; border-radius: 16px 16px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: middle;">
              <img src="${LOGO_URL}" alt="" width="36" height="36" style="border-radius: 8px; vertical-align: middle; margin-right: 12px;">
              <span style="font-size: 22px; font-weight: 900; color: #0F0F0F; vertical-align: middle; letter-spacing: -0.5px;">BadassInvoices</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background: #12121e; padding: 32px; border-radius: 0 0 16px 16px; border: 1px solid #1f1f3a; border-top: none;">

        <!-- Status Badge -->
        <table cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
          <tr>
            <td style="background: ${statusColor}20; border: 1px solid ${statusColor}40; border-radius: 6px; padding: 4px 12px;">
              <span style="color: ${statusColor}; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">${statusText}${reminderNumber > 1 ? ` #${reminderNumber}` : ""}</span>
            </td>
          </tr>
        </table>

        <h2 style="margin: 0 0 4px; color: #ffffff; font-size: 20px; font-weight: 700;">${config.heading}</h2>
        <p style="margin: 0 0 24px; color: #9ca3af; font-size: 14px;">${config.description}</p>

        <!-- Invoice Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background: #0a0a14; border: 1px solid ${isOverdue ? "#DC262640" : "#FFD70025"}; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 24px;">
              <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Invoice ${invoice.id}</p>

              ${lineItems ? buildLineItemsHtml(lineItems, invoice.token_mint) : ""}

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 12px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 2px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">${lineItems ? "Total Due" : "Amount Due"}</p>
                    <p style="margin: 0; color: ${isOverdue ? "#DC2626" : "#FFD700"}; font-size: 36px; font-weight: 800; letter-spacing: -1px; line-height: 1.1;">${formattedAmount}</p>
                  </td>
                  <td style="text-align: right; vertical-align: bottom;">
                    <p style="margin: 0 0 2px; color: #6b7280; font-size: 12px;">Due Date</p>
                    <p style="margin: 0; color: ${isOverdue ? "#DC2626" : "#d1d5db"}; font-size: 14px; font-weight: 600;">${dueDate}</p>
                  </td>
                </tr>
              </table>

              ${invoice.memo ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 16px; border-top: 1px solid #1f1f3a; padding-top: 16px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 2px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Description</p>
                    <p style="margin: 0; color: #d1d5db; font-size: 14px;">${escapeHtml(invoice.memo)}</p>
                  </td>
                </tr>
              </table>` : ""}
            </td>
          </tr>
        </table>

        <!-- Pay Button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
          <tr>
            <td align="center">
              <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(135deg, #FFD700, #B8860B); color: #0F0F0F; padding: 16px 48px; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 16px; letter-spacing: -0.3px;">${isOverdue ? "Pay Now" : "View & Pay Invoice"}</a>
            </td>
          </tr>
        </table>

        <!-- Double or Nothing Banner -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0 4px;">
          <tr>
            <td style="background: linear-gradient(135deg, #1a0a0a, #1a1a0a); border: 1px solid #FFD70040; border-radius: 10px; padding: 20px; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 22px; font-weight: 900; color: #FFD700; letter-spacing: 1px;">DOUBLE OR NOTHING</p>
              <p style="margin: 0 0 12px; color: #d1d5db; font-size: 14px;">Pay 2x for a <span style="color: #22C55E; font-weight: 700;">50/50 chance</span> to get your invoice completely FREE</p>
              <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="background: #22C55E20; border: 1px solid #22C55E40; border-radius: 6px; padding: 6px 16px; text-align: center;">
                    <span style="color: #22C55E; font-weight: 700; font-size: 13px;">WIN = Full Refund</span>
                  </td>
                  <td style="width: 12px;"></td>
                  <td style="background: #DC262620; border: 1px solid #DC262640; border-radius: 6px; padding: 6px 16px; text-align: center;">
                    <span style="color: #DC2626; font-weight: 700; font-size: 13px;">LOSE = Invoice Paid</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin: 20px 0 0; color: #6b7280; font-size: 12px; text-align: center;">
          If you've already paid, please disregard this email.
        </p>
      </td>
    </tr>`;

  const html = emailShell(content);

  const { error } = await getResend().emails.send({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Failed to send reminder email: ${error.message}`);
  }

  console.log(`${urgency} reminder sent to ${invoice.client_email} for invoice ${invoice.id}`);
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
  const outstandingFormatted = formatAmount(summary.totalPendingAmount, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const collectedFormatted = formatAmount(summary.totalPaidAmount, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

  const statCard = (value: string, label: string, color: string) => `
    <td style="background: #0a0a14; border: 1px solid ${color}30; border-radius: 10px; padding: 16px; text-align: center; width: 25%;">
      <p style="margin: 0 0 4px; color: ${color}; font-size: 28px; font-weight: 800; line-height: 1;">${value}</p>
      <p style="margin: 0; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</p>
    </td>`;

  const content = `
    <tr>
      <td style="background: linear-gradient(135deg, #FFD700, #B8860B); padding: 28px 32px; border-radius: 16px 16px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: middle;">
              <img src="${LOGO_URL}" alt="" width="36" height="36" style="border-radius: 8px; vertical-align: middle; margin-right: 12px;">
              <span style="font-size: 22px; font-weight: 900; color: #0F0F0F; vertical-align: middle; letter-spacing: -0.5px;">BadassInvoices</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background: #12121e; padding: 32px; border-radius: 0 0 16px 16px; border: 1px solid #1f1f3a; border-top: none;">

        <h2 style="margin: 0 0 4px; color: #ffffff; font-size: 20px; font-weight: 700;">Weekly Invoice Summary</h2>
        <p style="margin: 0 0 24px; color: #9ca3af; font-size: 14px;">Here's how your invoices are doing this week.</p>

        <!-- Stats Grid -->
        <table width="100%" cellpadding="0" cellspacing="8" style="margin-bottom: 24px;">
          <tr>
            ${statCard(String(summary.totalInvoices), "Total", "#9ca3af")}
            <td style="width: 8px;"></td>
            ${statCard(String(summary.pending), "Pending", "#FFD700")}
            <td style="width: 8px;"></td>
            ${statCard(String(summary.paid), "Paid", "#22C55E")}
            <td style="width: 8px;"></td>
            ${statCard(String(summary.overdue), "Overdue", "#DC2626")}
          </tr>
        </table>

        <!-- Financial Summary -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background: #0a0a14; border: 1px solid #FFD70025; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <p style="margin: 0 0 2px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Outstanding</p>
                    <p style="margin: 0; color: #FFD700; font-size: 24px; font-weight: 800;">${outstandingFormatted}</p>
                  </td>
                </tr>
                <tr>
                  <td style="border-top: 1px solid #1f1f3a; padding-top: 12px;">
                    <p style="margin: 0 0 2px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Collected</p>
                    <p style="margin: 0; color: #22C55E; font-size: 24px; font-weight: 800;">${collectedFormatted}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Dashboard Button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
          <tr>
            <td align="center">
              <a href="${APP_URL}" style="display: inline-block; background: linear-gradient(135deg, #FFD700, #B8860B); color: #0F0F0F; padding: 16px 48px; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 16px; letter-spacing: -0.3px;">View Dashboard</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const html = emailShell(content);

  const { error } = await getResend().emails.send({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: email,
    subject: "Your Weekly Invoice Summary - BadassInvoices",
    html,
  });

  if (error) {
    throw new Error(`Failed to send weekly summary: ${error.message}`);
  }

  console.log(`Weekly summary sent to ${email}`);
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
