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
  client_email: string;
  amount: number;
  token_mint: string;
  due_date: number;
  memo: string;
  reminder_count: number;
}

/**
 * Send payment reminder email
 */
export async function sendReminderEmail(invoice: Invoice): Promise<void> {
  const paymentUrl = `${APP_URL}/pay/${invoice.id}`;
  const formattedAmount = formatAmount(invoice.amount, invoice.token_mint);
  const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString();
  const isOverdue = invoice.due_date < Math.floor(Date.now() / 1000);

  const subject = isOverdue
    ? `[OVERDUE] Payment reminder for Invoice ${invoice.id}`
    : `Payment reminder for Invoice ${invoice.id}`;

  const urgencyText = isOverdue
    ? "This invoice is now overdue. Please process payment as soon as possible."
    : `Payment is due by ${dueDate}.`;

  const reminderNumber = invoice.reminder_count + 1;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #FFD700, #B8860B); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: #0F0F0F; margin: 0; font-weight: 900; }
        .content { background: #1A1A2E; padding: 30px; border-radius: 0 0 12px 12px; color: #e5e5e5; }
        .invoice-details { background: #0F0F0F; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #FFD70033; }
        .invoice-details p { color: #e5e5e5; }
        .amount { font-size: 32px; font-weight: bold; color: #FFD700; }
        .pay-button { display: inline-block; background: linear-gradient(135deg, #FFD700, #B8860B); color: #0F0F0F; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .overdue { color: #DC2626; font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body style="background: #0F0F0F;">
      <div class="container">
        <div class="header">
          <h1>BadassInvoices</h1>
        </div>
        <div class="content">
          <h2 style="color: white;">Payment Reminder ${reminderNumber > 1 ? `#${reminderNumber}` : ""}</h2>

          <p>${isOverdue ? '<span class="overdue">This invoice is overdue.</span>' : urgencyText}</p>

          <div class="invoice-details">
            <p><strong>Invoice:</strong> ${invoice.id}</p>
            <p><strong>Amount Due:</strong></p>
            <p class="amount">${formattedAmount}</p>
            <p><strong>Due Date:</strong> ${dueDate}</p>
            ${invoice.memo ? `<p><strong>Description:</strong> ${escapeHtml(invoice.memo)}</p>` : ""}
          </div>

          <center>
            <a href="${paymentUrl}" class="pay-button">Pay Now with Solana</a>
          </center>

          <p style="font-size: 14px; color: #999;">
            Click the button above to pay instantly with your Solana wallet.
            Payments are processed in seconds with near-zero fees.
          </p>

          <p style="font-size: 14px; color: #FFD700;">
            Pay a premium for a chance to get this invoice FREE!
          </p>
        </div>
        <div class="footer">
          <p>Powered by BadassInvoices - Instant invoicing on Solana</p>
          <p>This is an automated reminder. If you've already paid, please disregard this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const { error } = await getResend().emails.send({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Failed to send reminder email: ${error.message}`);
  }

  console.log(`Reminder sent to ${invoice.client_email} for invoice ${invoice.id}`);
}

/**
 * Send payment confirmation email
 */
export async function sendPaymentConfirmation(
  invoice: Invoice,
  txSignature: string
): Promise<void> {
  const formattedAmount = formatAmount(invoice.amount, invoice.token_mint);
  const explorerUrl = `https://solscan.io/tx/${txSignature}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #22C55E, #FFD700); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: #0F0F0F; margin: 0; font-weight: 900; }
        .content { background: #1A1A2E; padding: 30px; border-radius: 0 0 12px 12px; color: #e5e5e5; }
        .success-icon { font-size: 48px; text-align: center; color: #22C55E; }
        .amount { font-size: 32px; font-weight: bold; color: #22C55E; text-align: center; }
        .tx-link { color: #FFD700; word-break: break-all; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body style="background: #0F0F0F;">
      <div class="container">
        <div class="header">
          <h1>BadassInvoices</h1>
        </div>
        <div class="content">
          <p class="success-icon">&#10003;</p>
          <h2 style="text-align: center; color: white;">Payment Received!</h2>

          <p class="amount">${formattedAmount}</p>

          <p style="text-align: center;">
            Invoice ${invoice.id} has been paid in full.
          </p>

          <p style="font-size: 14px;">
            <strong>Transaction:</strong><br>
            <a href="${explorerUrl}" class="tx-link">${txSignature}</a>
          </p>
        </div>
        <div class="footer">
          <p>Thank you for using BadassInvoices</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const { error } = await getResend().emails.send({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject: `Payment received for Invoice ${invoice.id}`,
    html,
  });

  if (error) {
    throw new Error(`Failed to send confirmation email: ${error.message}`);
  }

  console.log(`Payment confirmation sent for invoice ${invoice.id}`);
}

/**
 * Send invoice created notification to client
 */
export async function sendInvoiceNotification(invoice: Invoice): Promise<void> {
  const paymentUrl = `${APP_URL}/pay/${invoice.id}`;
  const formattedAmount = formatAmount(invoice.amount, invoice.token_mint);
  const dueDate = new Date(invoice.due_date * 1000).toLocaleDateString();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #FFD700, #B8860B); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: #0F0F0F; margin: 0; font-weight: 900; }
        .content { background: #1A1A2E; padding: 30px; border-radius: 0 0 12px 12px; color: #e5e5e5; }
        .invoice-details { background: #0F0F0F; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #FFD70033; }
        .invoice-details p { color: #e5e5e5; }
        .amount { font-size: 32px; font-weight: bold; color: #FFD700; }
        .pay-button { display: inline-block; background: linear-gradient(135deg, #FFD700, #B8860B); color: #0F0F0F; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .spin-banner { background: linear-gradient(135deg, #DC2626, #FFD700); padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center; }
        .spin-banner p { color: white; font-weight: bold; font-size: 16px; margin: 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body style="background: #0F0F0F;">
      <div class="container">
        <div class="header">
          <h1>BadassInvoices</h1>
        </div>
        <div class="content">
          <h2 style="color: white;">You've received an invoice</h2>

          <div class="invoice-details">
            <p><strong>Invoice:</strong> ${invoice.id}</p>
            <p><strong>Amount Due:</strong></p>
            <p class="amount">${formattedAmount}</p>
            <p><strong>Due Date:</strong> ${dueDate}</p>
            ${invoice.memo ? `<p><strong>Description:</strong> ${escapeHtml(invoice.memo)}</p>` : ""}
          </div>

          <div class="spin-banner">
            <p>SPIN TO WIN - Pay a premium for a chance to get this invoice FREE!</p>
          </div>

          <center>
            <a href="${paymentUrl}" class="pay-button">Pay Now with Solana</a>
          </center>

          <p style="font-size: 14px; color: #999;">
            Pay instantly with your Solana wallet. Near-zero fees, instant settlement.
          </p>
        </div>
        <div class="footer">
          <p>Powered by BadassInvoices</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const { error } = await getResend().emails.send({
    from: `BadassInvoices <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject: `Invoice ${invoice.id} - ${formattedAmount} due`,
    html,
  });

  if (error) {
    throw new Error(`Failed to send invoice notification: ${error.message}`);
  }

  console.log(`Invoice notification sent to ${invoice.client_email} for invoice ${invoice.id}`);
}

/**
 * Format amount based on token mint
 */
function formatAmount(amount: number, tokenMint: string): string {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const USDC_MINTS = [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet
  ];

  if (tokenMint === SOL_MINT) {
    return `${(amount / 1e9).toFixed(4)} SOL`;
  }

  if (USDC_MINTS.includes(tokenMint)) {
    return `$${(amount / 1e6).toFixed(2)} USDC`;
  }

  // Default to 6 decimals
  return `${(amount / 1e6).toFixed(2)} tokens`;
}
