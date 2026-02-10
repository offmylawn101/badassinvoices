// Use local proxy to avoid ad blocker issues with cross-origin requests
const API_URL = "";

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
  const res = await fetch(`/api/v1/inv`, {
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
  const res = await fetch(`/api/v1/inv?wallet=${wallet}`);

  if (!res.ok) {
    throw new Error("Failed to fetch invoices");
  }

  return res.json();
}

export async function getInvoice(id: string): Promise<Invoice> {
  const res = await fetch(`/api/v1/inv/${id}`);

  if (!res.ok) {
    throw new Error("Invoice not found");
  }

  return res.json();
}

export async function sendReminder(id: string): Promise<void> {
  const res = await fetch(`/api/v1/inv/${id}/remind`, {
    method: "POST",
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to send reminder");
  }
}

export async function getQRCode(id: string): Promise<string> {
  const res = await fetch(`/api/v1/inv/${id}/qr`);

  if (!res.ok) {
    throw new Error("Failed to generate QR code");
  }

  const data = await res.json();
  return data.qrCode;
}

// Payment page API
export async function getPaymentData(id: string) {
  const res = await fetch(`/api/pay/${id}`);

  if (!res.ok) {
    throw new Error("Invoice not found");
  }

  return res.json();
}

// Client API
export async function getClients(wallet: string): Promise<Client[]> {
  const res = await fetch(`/api/v1/inv/clients?wallet=${wallet}`);

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
  const res = await fetch(`/api/v1/inv/clients`, {
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

// Lottery API
export interface LotteryPool {
  exists: boolean;
  tokenMint: string;
  totalBalance: number;
  totalPremiumsCollected: number;
  totalPayouts: number;
  totalEntries: number;
  totalWins: number;
  houseEdgeBps: number;
  lotteryAvailable: boolean;
  maxWin: number;
  threshold: number;
  progress: number;
  message?: string;
}

export interface LotteryOdds {
  invoiceAmount: number;
  premiumAmount: number;
  totalPayment: number;
  winProbabilityBps: number;
  winProbabilityPct: string;
  houseEdgeBps: number;
}

export interface LotteryEntry {
  id: string;
  invoiceId: string;
  clientWallet: string;
  invoiceAmount: number;
  premiumPaid: number;
  totalPaid: number;
  winProbabilityBps: number;
  winProbabilityPct: string;
  status: "pending_vrf" | "won" | "lost";
}

export interface LotteryResult {
  entryId: string;
  won: boolean;
  randomValue: number;
  threshold: number;
  invoiceAmount: number;
  premiumPaid: number;
  status: "won" | "lost";
  message: string;
}

export async function getLotteryPool(tokenMint: string): Promise<LotteryPool> {
  const res = await fetch(`/api/v1/spin/pool/${tokenMint}`);
  if (!res.ok) {
    throw new Error("Failed to fetch lottery pool");
  }
  return res.json();
}

export async function calculateLotteryOdds(
  invoiceAmount: number,
  premiumAmount: number,
  tokenMint: string
): Promise<LotteryOdds> {
  const res = await fetch(`/api/v1/spin/calculate-odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceAmount, premiumAmount, tokenMint }),
  });
  if (!res.ok) {
    throw new Error("Failed to calculate odds");
  }
  return res.json();
}

export async function getPoolWallet(): Promise<string> {
  const res = await fetch(`/api/v1/spin/pool-wallet`);
  if (!res.ok) {
    throw new Error("Failed to fetch pool wallet");
  }
  const data = await res.json();
  return data.publicKey;
}

export async function createLotteryEntry(
  invoiceId: string,
  clientWallet: string,
  premiumAmount: number,
  riskSlider: number,
  txSignature?: string
): Promise<LotteryEntry> {
  const res = await fetch(`/api/v1/spin/entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceId, clientWallet, premiumAmount, riskSlider, txSignature }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Failed to create lottery entry");
  }
  return res.json();
}

export async function settleLottery(entryId: string): Promise<LotteryResult> {
  const res = await fetch(`/api/v1/spin/settle/${entryId}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error("Failed to settle lottery");
  }
  return res.json();
}

export async function getLotteryEntry(entryId: string): Promise<LotteryEntry> {
  const res = await fetch(`/api/v1/spin/entry/${entryId}`);
  if (!res.ok) {
    throw new Error("Lottery entry not found");
  }
  return res.json();
}

export interface RecentWin {
  clientWallet: string;
  amountWon: number;
  premiumPaid: number;
  memo: string;
  timestamp: number;
}

export async function getRecentWins(): Promise<RecentWin[]> {
  const res = await fetch(`/api/v1/spin/recent-wins`);
  if (!res.ok) {
    throw new Error("Failed to fetch recent wins");
  }
  return res.json();
}
