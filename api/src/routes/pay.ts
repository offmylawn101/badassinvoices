import { Router, Request, Response } from "express";
import { invoiceQueries } from "../db.js";
import { generateQRCode, createSolanaPayTransaction } from "../services/solana-pay.js";

const router = Router();

// Get payment page data for an invoice
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = invoiceQueries.getById.get(id) as any;

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Generate QR code
    const qrCode = await generateQRCode(invoice.payment_link);

    // Parse milestones
    const milestones = invoice.milestones ? JSON.parse(invoice.milestones) : null;

    res.json({
      id: invoice.id,
      creatorWallet: invoice.creator_wallet,
      amount: invoice.amount,
      tokenMint: invoice.token_mint,
      dueDate: invoice.due_date,
      memo: invoice.memo,
      status: invoice.status,
      milestones,
      paymentLink: invoice.payment_link,
      qrCode,
    });
  } catch (error) {
    console.error("Error fetching payment data:", error);
    res.status(500).json({ error: "Failed to fetch payment data" });
  }
});

// Solana Pay transaction request endpoint
router.get("/:id/transaction", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = invoiceQueries.getById.get(id) as any;

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Return transaction request format for Solana Pay
    res.json({
      label: "InvoiceNow",
      icon: "https://invoicenow.app/icon.png",
    });
  } catch (error) {
    console.error("Error fetching transaction:", error);
    res.status(500).json({ error: "Failed to fetch transaction" });
  }
});

// Solana Pay transaction creation endpoint
router.post("/:id/transaction", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { account } = req.body;

    if (!account) {
      res.status(400).json({ error: "Account required" });
      return;
    }

    const invoice = invoiceQueries.getById.get(id) as any;

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (invoice.status !== "pending") {
      res.status(400).json({ error: "Invoice already paid or cancelled" });
      return;
    }

    const transaction = await createSolanaPayTransaction(
      invoice.creator_wallet,
      account,
      invoice.amount,
      invoice.token_mint,
      invoice.id
    );

    res.json({
      transaction,
      message: `Payment for invoice ${invoice.id}`,
    });
  } catch (error) {
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

export default router;
