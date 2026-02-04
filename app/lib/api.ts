const API_URL = process.env.API_URL || "http://localhost:3001";

export interface Invoice {
  id: string;
  creator_wallet: string;
  client_email: string | null;
  client_wallet: string | null;
  amount: number;
  token_mint: string;
  due_date: number;
  memo: string | null;
  status: "pending" | "paid" | "cancelled" | "escrow_funded";
  created_at: number;
  paid_at: number | null;
  tx_signature: string | null;
  payment_link: string;
  milestones: Milestone[] | null;
  reminder_count: number;
}

export interface Milestone {
  description: string;
  amount: number;
  completed?: boolean;
  completed_at?: number;
}

export interface CreateInvoiceParams {
  creatorWallet: string;
  clientEmail?: string;
  amount: number;
  tokenMint: string;
  dueDate: number;
  memo?: string;
  milestones?: Milestone[];
}

export interface Client {
  id: string;
  owner_wallet: string;
  name: string;
  email: string | null;
  wallet: string | null;
}

// Invoice API
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  const res = await fetch(`${API_URL}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to create invoice");
  }

  return res.json();
}

export async function getInvoices(wallet: string): Promise<Invoice[]> {
  const res = await fetch(`${API_URL}/api/invoices?wallet=${wallet}`);

  if (!res.ok) {
    throw new Error("Failed to fetch invoices");
  }

  return res.json();
}

export async function getInvoice(id: string): Promise<Invoice> {
  const res = await fetch(`${API_URL}/api/invoices/${id}`);

  if (!res.ok) {
    throw new Error("Invoice not found");
  }

  return res.json();
}

export async function sendReminder(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/invoices/${id}/remind`, {
    method: "POST",
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to send reminder");
  }
}

export async function getQRCode(id: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/invoices/${id}/qr`);

  if (!res.ok) {
    throw new Error("Failed to generate QR code");
  }

  const data = await res.json();
  return data.qrCode;
}

// Payment page API
export async function getPaymentData(id: string) {
  const res = await fetch(`${API_URL}/pay/${id}`);

  if (!res.ok) {
    throw new Error("Invoice not found");
  }

  return res.json();
}

// Client API
export async function getClients(wallet: string): Promise<Client[]> {
  const res = await fetch(`${API_URL}/api/invoices/clients?wallet=${wallet}`);

  if (!res.ok) {
    throw new Error("Failed to fetch clients");
  }

  return res.json();
}

export async function createClient(params: {
  ownerWallet: string;
  name: string;
  email?: string;
  wallet?: string;
}): Promise<Client> {
  const res = await fetch(`${API_URL}/api/invoices/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error("Failed to create client");
  }

  return res.json();
}

// Helpers
export function formatAmount(amount: number, tokenMint: string): string {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const USDC_MINTS = [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ];

  if (tokenMint === SOL_MINT) {
    return `${(amount / 1e9).toFixed(4)} SOL`;
  }

  if (USDC_MINTS.includes(tokenMint)) {
    return `$${(amount / 1e6).toFixed(2)}`;
  }

  return `${(amount / 1e6).toFixed(2)} tokens`;
}

export function getTokenSymbol(tokenMint: string): string {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const USDC_MINTS = [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ];

  if (tokenMint === SOL_MINT) return "SOL";
  if (USDC_MINTS.includes(tokenMint)) return "USDC";
  return "Token";
}
