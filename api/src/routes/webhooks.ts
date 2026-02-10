import { Router, Request, Response } from "express";
import { invoiceQueries } from "../db.js";
import { sendPaymentConfirmation } from "../services/email.js";
import { verifyPayment } from "../services/solana-pay.js";

const router = Router();

const WEBHOOK_AUTH_TOKEN = process.env.HELIUS_WEBHOOK_AUTH || "";

// Helius webhook for tracking on-chain payments
router.post("/helius", async (req: Request, res: Response) => {
  try {
    // Verify webhook auth token if configured
    if (WEBHOOK_AUTH_TOKEN) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${WEBHOOK_AUTH_TOKEN}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const webhookData = req.body;

    // Helius sends array of transactions
    const transactions = Array.isArray(webhookData) ? webhookData : [webhookData];

    for (const tx of transactions) {
      await processTransaction(tx);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

async function processTransaction(tx: any) {
  // Look for transfer instructions to our program
  const { signature, type, tokenTransfers, nativeTransfers } = tx;

  // Check token transfers (USDC, etc.)
  if (tokenTransfers && tokenTransfers.length > 0) {
    for (const transfer of tokenTransfers) {
      await checkPayment(transfer.toUserAccount, transfer.tokenAmount, signature, transfer.mint);
    }
  }

  // Check native SOL transfers
  if (nativeTransfers && nativeTransfers.length > 0) {
    for (const transfer of nativeTransfers) {
      // Convert lamports to amount
      const amount = transfer.amount;
      await checkPayment(
        transfer.toUserAccount,
        amount,
        signature,
        "So11111111111111111111111111111111111111112" // Native SOL mint
      );
    }
  }
}

async function checkPayment(toWallet: string, amount: number, signature: string, mint: string) {
  // Find pending invoices for this wallet
  const pendingInvoices = invoiceQueries.getPending.all() as any[];

  for (const invoice of pendingInvoices) {
    // Check if payment matches invoice
    if (
      invoice.creator_wallet === toWallet &&
      invoice.token_mint === mint &&
      invoice.amount <= amount
    ) {
      // Mark invoice as paid
      invoiceQueries.updateStatus.run(
        "paid",
        Math.floor(Date.now() / 1000),
        signature,
        invoice.id
      );

      console.log(`Invoice ${invoice.id} marked as paid. TX: ${signature}`);

      // Send confirmation email if client email exists
      if (invoice.client_email) {
        await sendPaymentConfirmation(invoice, signature);
      }

      break; // Only match one invoice per transfer
    }
  }
}

// Manual payment verification endpoint
router.post("/verify-payment", async (req: Request, res: Response) => {
  try {
    const { invoiceId, txSignature, expectedAmount } = req.body;

    if (!invoiceId || !txSignature) {
      res.status(400).json({ error: "Invoice ID and transaction signature required" });
      return;
    }

    const invoice = invoiceQueries.getById.get(invoiceId) as any;
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Check if already paid (idempotency)
    if (invoice.status === "paid") {
      res.json({ success: true, message: "Invoice already paid" });
      return;
    }

    // Check if this signature was already used
    if (invoice.tx_signature === txSignature) {
      res.json({ success: true, message: "Payment already verified" });
      return;
    }

    // When lottery is active, frontend sends expectedAmount (just the invoice portion going to creator).
    // Use it if provided, otherwise fall back to invoice.amount.
    const verifyAmount = (typeof expectedAmount === "number" && expectedAmount > 0)
      ? expectedAmount
      : invoice.amount;

    // Verify transaction on-chain
    const verification = await verifyPayment(
      txSignature,
      invoice.creator_wallet,
      verifyAmount,
      invoice.token_mint
    );

    if (!verification.verified) {
      console.error(`Payment verification failed for invoice ${invoiceId}: ${verification.error}`);
      res.status(400).json({
        error: "Payment verification failed",
        details: verification.error
      });
      return;
    }

    // Mark invoice as paid
    invoiceQueries.updateStatus.run(
      "paid",
      Math.floor(Date.now() / 1000),
      txSignature,
      invoiceId
    );

    console.log(`Invoice ${invoiceId} verified and marked as paid. TX: ${txSignature}, Amount: ${verification.actualAmount}`);

    // Send confirmation email if client email exists
    if (invoice.client_email) {
      await sendPaymentConfirmation(invoice, txSignature);
    }

    res.json({ success: true, message: "Payment verified", amount: verification.actualAmount });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

export default router;
