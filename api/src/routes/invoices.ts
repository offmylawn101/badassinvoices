import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { invoiceQueries, clientQueries } from "../db.js";
import { generatePaymentLink, generateQRCode } from "../services/solana-pay.js";
import { sendReminderEmail, sendInvoiceNotification } from "../services/email.js";
import { PublicKey } from "@solana/web3.js";

const router = Router();

function isValidPublicKey(key: string): boolean {
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
}

interface CreateInvoiceBody {
  creatorWallet: string;
  clientEmail?: string;
  clientTwitter?: string;
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
    const { creatorWallet, clientEmail, clientTwitter, amount, tokenMint, dueDate, memo, milestones } = req.body;

    if (!creatorWallet || !amount || !tokenMint || !dueDate) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if (!isValidPublicKey(creatorWallet)) {
      res.status(400).json({ error: "Invalid creator wallet address" });
      return;
    }

    if (!isValidPublicKey(tokenMint)) {
      res.status(400).json({ error: "Invalid token mint address" });
      return;
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({ error: "Amount must be a positive integer" });
      return;
    }

    if (!Number.isInteger(dueDate) || dueDate <= 0) {
      res.status(400).json({ error: "Invalid due date" });
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

    // If we have client email, create/update client record
    if (clientEmail) {
      try {
        const existingClient = clientQueries.getByEmail.get(clientEmail) as any;
        if (existingClient) {
          if (clientTwitter) {
            clientQueries.updateTwitterHandle.run(clientTwitter, clientEmail);
          }
        } else {
          const clientId = nanoid(10);
          clientQueries.create.run(
            clientId,
            creatorWallet,
            clientEmail.split("@")[0], // Use email prefix as name
            clientEmail,
            null, // wallet
            clientTwitter || null
          );
        }
      } catch (e) {
        console.error("Error updating client record:", e);
        // Non-fatal, continue
      }
    }

    const invoice = invoiceQueries.getById.get(id) as Record<string, unknown>;

    // Send invoice notification email to client (non-blocking)
    if (clientEmail) {
      sendInvoiceNotification(invoice as any).catch((e) =>
        console.error("Failed to send invoice notification:", e)
      );
    }

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

// Update invoice status (for on-chain sync) - requires admin key
router.patch("/:id/status", (req: Request, res: Response) => {
  try {
    // Require admin auth for direct status updates
    const adminKey = process.env.ADMIN_KEY || "badass-admin-key";
    const authHeader = req.headers["x-admin-key"];
    if (authHeader !== adminKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { status, txSignature } = req.body;

    const validStatuses = ["pending", "paid", "cancelled", "escrow_funded"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

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
    const { ownerWallet, name, email, wallet, twitterHandle } = req.body;

    if (!ownerWallet || !name) {
      res.status(400).json({ error: "Owner wallet and name required" });
      return;
    }

    const id = nanoid(10);
    clientQueries.create.run(
      id,
      ownerWallet,
      name,
      email || null,
      wallet || null,
      twitterHandle || null
    );

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
