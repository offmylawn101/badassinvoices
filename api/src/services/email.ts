import nodemailer from "nodemailer";

// Configure email transport
// In production, use proper SMTP service (SendGrid, AWS SES, etc.)
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
        .header { background: linear-gradient(135deg, #9945FF, #14F195); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: white; margin: 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; }
        .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #9945FF; }
        .pay-button { display: inline-block; background: #9945FF; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .overdue { color: #dc3545; font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>InvoiceNow</h1>
        </div>
        <div class="content">
          <h2>Payment Reminder ${reminderNumber > 1 ? `#${reminderNumber}` : ""}</h2>

          <p>${isOverdue ? '<span class="overdue">This invoice is overdue.</span>' : urgencyText}</p>

          <div class="invoice-details">
            <p><strong>Invoice:</strong> ${invoice.id}</p>
            <p><strong>Amount Due:</strong></p>
            <p class="amount">${formattedAmount}</p>
            <p><strong>Due Date:</strong> ${dueDate}</p>
            ${invoice.memo ? `<p><strong>Description:</strong> ${invoice.memo}</p>` : ""}
          </div>

          <center>
            <a href="${paymentUrl}" class="pay-button">Pay Now with Solana</a>
          </center>

          <p style="font-size: 14px; color: #666;">
            Click the button above to pay instantly with your Solana wallet.
            Payments are processed in seconds with near-zero fees.
          </p>
        </div>
        <div class="footer">
          <p>Powered by InvoiceNow - Instant invoicing on Solana</p>
          <p>This is an automated reminder. If you've already paid, please disregard this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Payment Reminder for Invoice ${invoice.id}

Amount Due: ${formattedAmount}
Due Date: ${dueDate}
${invoice.memo ? `Description: ${invoice.memo}` : ""}

${urgencyText}

Pay now: ${paymentUrl}

---
Powered by InvoiceNow - Instant invoicing on Solana
  `;

  await transporter.sendMail({
    from: `InvoiceNow <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject,
    text,
    html,
  });

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
        .header { background: linear-gradient(135deg, #14F195, #9945FF); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: white; margin: 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; }
        .success-icon { font-size: 48px; text-align: center; }
        .amount { font-size: 32px; font-weight: bold; color: #14F195; text-align: center; }
        .tx-link { color: #9945FF; word-break: break-all; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>InvoiceNow</h1>
        </div>
        <div class="content">
          <p class="success-icon">&#10003;</p>
          <h2 style="text-align: center;">Payment Received!</h2>

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
          <p>Thank you for using InvoiceNow</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Payment Received!

Invoice ${invoice.id} has been paid.
Amount: ${formattedAmount}

Transaction: ${explorerUrl}

Thank you for using InvoiceNow.
  `;

  await transporter.sendMail({
    from: `InvoiceNow <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject: `Payment received for Invoice ${invoice.id}`,
    text,
    html,
  });

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
        .header { background: linear-gradient(135deg, #9945FF, #14F195); padding: 30px; border-radius: 12px 12px 0 0; }
        .header h1 { color: white; margin: 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; }
        .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .amount { font-size: 32px; font-weight: bold; color: #9945FF; }
        .pay-button { display: inline-block; background: #9945FF; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>InvoiceNow</h1>
        </div>
        <div class="content">
          <h2>You've received an invoice</h2>

          <div class="invoice-details">
            <p><strong>Invoice:</strong> ${invoice.id}</p>
            <p><strong>Amount Due:</strong></p>
            <p class="amount">${formattedAmount}</p>
            <p><strong>Due Date:</strong> ${dueDate}</p>
            ${invoice.memo ? `<p><strong>Description:</strong> ${invoice.memo}</p>` : ""}
          </div>

          <center>
            <a href="${paymentUrl}" class="pay-button">Pay Now with Solana</a>
          </center>

          <p style="font-size: 14px; color: #666;">
            Pay instantly with your Solana wallet. Near-zero fees, instant settlement.
          </p>
        </div>
        <div class="footer">
          <p>Powered by InvoiceNow</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `InvoiceNow <${FROM_EMAIL}>`,
    to: invoice.client_email,
    subject: `Invoice ${invoice.id} - ${formattedAmount} due`,
    html,
  });
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
