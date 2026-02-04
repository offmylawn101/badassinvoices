import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { invoiceQueries, clientQueries } from "../db.js";
import { generatePaymentLink, generateQRCode } from "../services/solana-pay.js";
import { sendReminderEmail } from "../services/email.js";

const router = Router();

interface CreateInvoiceBody {
  creatorWallet: string;
  clientEmail?: string;
  amount: number;
  tokenMint: string;
  dueDate: number;
  memo?: string;
  milestones?: Array<{
    description: string;
    amount: number;
  }>;
}

// Create invoice
router.post("/", async (req: Request<{}, {}, CreateInvoiceBody>, res: Response) => {
  try {
    const { creatorWallet, clientEmail, amount, tokenMint, dueDate, memo, milestones } = req.body;

    if (!creatorWallet || !amount || !tokenMint || !dueDate) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const id = `INV-${nanoid(8).toUpperCase()}`;
    const paymentLink = generatePaymentLink(id, creatorWallet, amount, tokenMint, memo);

    invoiceQueries.create.run(
      id,
      creatorWallet,
      clientEmail || null,
      amount,
      tokenMint,
      dueDate,
      memo || null,
      milestones ? JSON.stringify(milestones) : null,
      paymentLink
    );

    const invoice = invoiceQueries.getById.get(id);

    res.status(201).json({
      ...invoice,
      paymentLink,
      qrCodeUrl: `/pay/${id}/qr`,
    });
  } catch (error) {
    console.error("Error creating invoice:", error);
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

// Get all invoices for a wallet
router.get("/", (req: Request, res: Response) => {
  try {
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== "string") {
      res.status(400).json({ error: "Wallet address required" });
      return;
    }

    const invoices = invoiceQueries.getByCreator.all(wallet);

    // Parse milestones JSON for each invoice
    const parsed = (invoices as any[]).map((inv) => ({
      ...inv,
      milestones: inv.milestones ? JSON.parse(inv.milestones) : null,
    }));

    res.json(parsed);
  } catch (error) {
    console.error("Error fetching invoices:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// Get single invoice
router.get("/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = invoiceQueries.getById.get(id) as any;

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    res.json({
      ...invoice,
      milestones: invoice.milestones ? JSON.parse(invoice.milestones) : null,
    });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// Send payment reminder
router.post("/:id/remind", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = invoiceQueries.getById.get(id) as any;

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (invoice.status !== "pending") {
      res.status(400).json({ error: "Invoice is not pending" });
      return;
    }

    if (!invoice.client_email) {
      res.status(400).json({ error: "No client email on invoice" });
      return;
    }

    await sendReminderEmail(invoice);
    invoiceQueries.updateReminder.run(Math.floor(Date.now() / 1000), id);

    res.json({ success: true, message: "Reminder sent" });
  } catch (error) {
    console.error("Error sending reminder:", error);
    res.status(500).json({ error: "Failed to send reminder" });
  }
});

// Update invoice status (for on-chain sync)
router.patch("/:id/status", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, txSignature } = req.body;

    const invoice = invoiceQueries.getById.get(id);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const paidAt = status === "paid" ? Math.floor(Date.now() / 1000) : null;
    invoiceQueries.updateStatus.run(status, paidAt, txSignature || null, id);

    res.json({ success: true });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
});

// Get QR code for invoice
router.get("/:id/qr", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const invoice = invoiceQueries.getById.get(id) as any;

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const qrDataUrl = await generateQRCode(invoice.payment_link);
    res.json({ qrCode: qrDataUrl });
  } catch (error) {
    console.error("Error generating QR:", error);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

// Client management
router.post("/clients", (req: Request, res: Response) => {
  try {
    const { ownerWallet, name, email, wallet } = req.body;

    if (!ownerWallet || !name) {
      res.status(400).json({ error: "Owner wallet and name required" });
      return;
    }

    const id = nanoid(10);
    clientQueries.create.run(id, ownerWallet, name, email || null, wallet || null);

    const client = clientQueries.getById.get(id);
    res.status(201).json(client);
  } catch (error) {
    console.error("Error creating client:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

router.get("/clients", (req: Request, res: Response) => {
  try {
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== "string") {
      res.status(400).json({ error: "Wallet address required" });
      return;
    }

    const clients = clientQueries.getByOwner.all(wallet);
    res.json(clients);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

export default router;
