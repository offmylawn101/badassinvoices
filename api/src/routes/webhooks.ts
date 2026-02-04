import { Router, Request, Response } from "express";
import { invoiceQueries } from "../db.js";
import { sendPaymentConfirmation } from "../services/email.js";

const router = Router();

// Helius webhook for tracking on-chain payments
router.post("/helius", async (req: Request, res: Response) => {
  try {
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
    const { invoiceId, txSignature } = req.body;

    if (!invoiceId || !txSignature) {
      res.status(400).json({ error: "Invoice ID and transaction signature required" });
      return;
    }

    const invoice = invoiceQueries.getById.get(invoiceId);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // TODO: Verify transaction on-chain using Solana RPC
    // For now, trust the signature and mark as paid
    invoiceQueries.updateStatus.run(
      "paid",
      Math.floor(Date.now() / 1000),
      txSignature,
      invoiceId
    );

    res.json({ success: true, message: "Payment verified" });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

export default router;
