import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db, lotteryPoolQueries, lotteryEntryQueries, invoiceQueries } from "../db.js";
import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";
import { POOL_PUBKEY, sendRefund } from "../services/pool-wallet.js";

const router = Router();

// Admin key for protected endpoints (set in env or use default for hackathon)
const ADMIN_KEY = process.env.ADMIN_API_KEY || "badass-admin-key";

// Default pool settings
const DEFAULT_HOUSE_EDGE_BPS = 500; // 5%
const DEFAULT_MIN_RESERVE_BPS = 2000; // 20%
const DEFAULT_MAX_WIN_BPS = 1000; // 10%
const MIN_POOL_THRESHOLD = 5_000_000; // 5 USDC (in smallest units) - lowered for launch

// Simple in-memory rate limiter
const rateLimiter = new Map<string, { count: number; reset: number }>();
function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(key);
  if (!entry || now > entry.reset) {
    rateLimiter.set(key, { count: 1, reset: now + 60000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

// Validate Solana public key format
function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Generate unbiased random value in [0, maxExclusive) using rejection sampling
function secureRandomInt(maxExclusive: number): number {
  const bytesNeeded = 4;
  const maxValid = Math.floor(0xFFFFFFFF / maxExclusive) * maxExclusive;
  let value: number;
  do {
    const buf = crypto.randomBytes(bytesNeeded);
    value = buf.readUInt32BE(0);
  } while (value >= maxValid);
  return value % maxExclusive;
}

// Get pool wallet public key (for frontend to send premium to)
router.get("/pool-wallet", async (_req: Request, res: Response) => {
  res.json({ publicKey: POOL_PUBKEY.toString() });
});

// Get lottery pool stats for a token
router.get("/pool/:tokenMint", async (req: Request, res: Response) => {
  try {
    const { tokenMint } = req.params;
    const pool = lotteryPoolQueries.getByTokenMint.get(tokenMint) as any;

    if (!pool) {
      res.json({
        exists: false,
        tokenMint,
        totalBalance: 0,
        totalPremiumsCollected: 0,
        totalPayouts: 0,
        totalEntries: 0,
        totalWins: 0,
        houseEdgeBps: DEFAULT_HOUSE_EDGE_BPS,
        minPoolReserveBps: DEFAULT_MIN_RESERVE_BPS,
        maxWinPctBps: DEFAULT_MAX_WIN_BPS,
        paused: true,
        lotteryAvailable: false,
        threshold: MIN_POOL_THRESHOLD,
        message: "Pool building... Lottery unlocks at 100 USDC",
      });
      return;
    }

    const available = pool.total_balance >= MIN_POOL_THRESHOLD && !pool.paused;

    // Calculate max possible win (enforce reserve and max win pct)
    const availablePool = Math.floor(
      (pool.total_balance * (10000 - pool.min_pool_reserve_bps)) / 10000
    );
    const maxWin = Math.floor((availablePool * pool.max_win_pct_bps) / 10000);

    res.json({
      exists: true,
      id: pool.id,
      tokenMint: pool.token_mint,
      totalBalance: pool.total_balance,
      totalPremiumsCollected: pool.total_premiums_collected,
      totalPayouts: pool.total_payouts,
      totalEntries: pool.total_entries,
      totalWins: pool.total_wins,
      houseEdgeBps: pool.house_edge_bps,
      minPoolReserveBps: pool.min_pool_reserve_bps,
      maxWinPctBps: pool.max_win_pct_bps,
      paused: pool.paused === 1,
      lotteryAvailable: available,
      maxWin,
      threshold: MIN_POOL_THRESHOLD,
      progress: Math.min(100, Math.floor((pool.total_balance / MIN_POOL_THRESHOLD) * 100)),
    });
  } catch (error) {
    console.error("Error fetching lottery pool:", error);
    res.status(500).json({ error: "Failed to fetch lottery pool" });
  }
});

// Calculate odds for a given premium
router.post("/calculate-odds", async (req: Request, res: Response) => {
  try {
    const { invoiceAmount, premiumAmount, tokenMint, riskSlider } = req.body;

    if (!invoiceAmount || !premiumAmount || !tokenMint) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if (!Number.isInteger(invoiceAmount) || invoiceAmount <= 0) {
      res.status(400).json({ error: "Invalid invoice amount" });
      return;
    }

    if (!Number.isInteger(premiumAmount) || premiumAmount <= 0) {
      res.status(400).json({ error: "Invalid premium amount" });
      return;
    }

    // The slider value IS the win probability (0-50%)
    // House edge is already built into the premium multiplier on the frontend
    const sliderValue = typeof riskSlider === "number" ? riskSlider : 0;
    const winProbabilityBps = Math.min(Math.max(Math.floor(sliderValue * 100), 0), 5000);

    const pool = lotteryPoolQueries.getByTokenMint.get(tokenMint) as any;
    const houseEdgeBps = pool?.house_edge_bps || DEFAULT_HOUSE_EDGE_BPS;

    res.json({
      invoiceAmount,
      premiumAmount,
      totalPayment: invoiceAmount + premiumAmount,
      winProbabilityBps,
      winProbabilityPct: (winProbabilityBps / 100).toFixed(1) + "%",
      houseEdgeBps,
    });
  } catch (error) {
    console.error("Error calculating odds:", error);
    res.status(500).json({ error: "Failed to calculate odds" });
  }
});

// Create lottery entry (pay with lottery)
router.post("/entry", async (req: Request, res: Response) => {
  try {
    const { invoiceId, clientWallet, premiumAmount, txSignature, riskSlider } = req.body;

    if (!invoiceId || !clientWallet || !premiumAmount) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Validate wallet address
    if (!isValidPublicKey(clientWallet)) {
      res.status(400).json({ error: "Invalid wallet address" });
      return;
    }

    // Validate premium amount
    if (!Number.isInteger(premiumAmount) || premiumAmount <= 0) {
      res.status(400).json({ error: "Invalid premium amount" });
      return;
    }

    // Rate limit: max 5 entries per wallet per minute
    if (!checkRateLimit(`entry:${clientWallet}`, 5)) {
      res.status(429).json({ error: "Too many requests, slow down" });
      return;
    }

    // Get invoice
    const invoice = invoiceQueries.getById.get(invoiceId) as any;
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (invoice.status !== "pending") {
      res.status(400).json({ error: "Invoice is not pending" });
      return;
    }

    // Check for existing pending entry on this invoice
    const existingEntry = lotteryEntryQueries.getByInvoice.get(invoiceId) as any;
    if (existingEntry && existingEntry.status === "pending_vrf") {
      res.status(400).json({ error: "Lottery entry already exists for this invoice" });
      return;
    }

    // Get or create pool
    let pool = lotteryPoolQueries.getByTokenMint.get(invoice.token_mint) as any;
    if (!pool) {
      const poolId = uuidv4();
      lotteryPoolQueries.create.run(
        poolId,
        invoice.token_mint,
        DEFAULT_HOUSE_EDGE_BPS,
        DEFAULT_MIN_RESERVE_BPS,
        DEFAULT_MAX_WIN_BPS,
        null
      );
      pool = lotteryPoolQueries.getByTokenMint.get(invoice.token_mint) as any;
    }

    // Win probability = slider value * 100 bps (0-50% -> 0-5000 bps)
    // House edge is built into the premium multiplier on the frontend
    const sliderValue = typeof riskSlider === "number" ? riskSlider : 0;
    const winProbabilityBps = Math.min(Math.max(Math.floor(sliderValue * 100), 0), 5000);

    // Create entry + update pool atomically
    const entryId = uuidv4();
    const createEntryTx = db.transaction(() => {
      lotteryEntryQueries.create.run(
        entryId,
        invoiceId,
        clientWallet,
        invoice.amount,
        premiumAmount,
        winProbabilityBps,
        txSignature || null
      );

      lotteryPoolQueries.addPremium.run(
        premiumAmount,
        premiumAmount,
        invoice.token_mint
      );
    });
    createEntryTx();

    res.json({
      id: entryId,
      invoiceId,
      clientWallet,
      invoiceAmount: invoice.amount,
      premiumPaid: premiumAmount,
      totalPaid: invoice.amount + premiumAmount,
      winProbabilityBps,
      winProbabilityPct: (winProbabilityBps / 100).toFixed(1) + "%",
      status: "pending_vrf",
    });
  } catch (error) {
    console.error("Error creating lottery entry:", error);
    res.status(500).json({ error: "Failed to create lottery entry" });
  }
});

// Settle lottery - uses DB transaction for atomicity
router.post("/settle/:entryId", async (req: Request, res: Response) => {
  try {
    const { entryId } = req.params;

    const entry = lotteryEntryQueries.getById.get(entryId) as any;
    if (!entry) {
      res.status(404).json({ error: "Lottery entry not found" });
      return;
    }

    if (entry.status !== "pending_vrf") {
      // Already settled - return existing result (idempotent)
      res.json({
        entryId,
        won: entry.won === 1,
        randomValue: null,
        threshold: entry.win_probability_bps,
        invoiceAmount: entry.invoice_amount,
        premiumPaid: entry.premium_paid,
        status: entry.status,
        message: entry.won === 1
          ? "Congratulations! You won! Your invoice was paid for FREE!"
          : "Better luck next time! Your invoice has been paid.",
      });
      return;
    }

    // Get invoice and pool
    const invoice = invoiceQueries.getById.get(entry.invoice_id) as any;
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const pool = lotteryPoolQueries.getByTokenMint.get(invoice.token_mint) as any;
    if (!pool) {
      res.status(404).json({ error: "Lottery pool not found" });
      return;
    }

    // Generate unbiased random value
    const randomBytes = crypto.randomBytes(32);
    const randomValue = secureRandomInt(10000);

    // Determine win/loss
    let won = randomValue < entry.win_probability_bps;

    // Enforce pool solvency: if pool can't cover full refund, force loss
    if (won) {
      const refundAmount = entry.invoice_amount + entry.premium_paid;
      const reserveRequired = Math.floor((pool.total_balance * pool.min_pool_reserve_bps) / 10000);
      const availableForPayout = pool.total_balance - reserveRequired;
      const maxSingleWin = Math.floor((availableForPayout * pool.max_win_pct_bps) / 10000);

      if (refundAmount > availableForPayout || refundAmount > maxSingleWin) {
        // Pool can't cover this win - force loss to maintain solvency
        won = false;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const txSig = entry.tx_signature || null;

    // Use DB transaction for atomic settlement
    const settleTransaction = db.transaction(() => {
      // Atomically update entry status (WHERE status = 'pending_vrf' prevents double-settle)
      const result = lotteryEntryQueries.settle.run(
        won ? "won" : "lost",
        won ? 1 : 0,
        randomBytes.toString("hex"),
        now,
        txSig,
        entryId
      );

      // If no rows changed, another request already settled this entry
      if (result.changes === 0) {
        return false;
      }

      // Update pool stats if won (atomic decrement with balance check)
      if (won) {
        const refundAmount = entry.invoice_amount + entry.premium_paid;
        const poolResult = lotteryPoolQueries.addPayout.run(
          refundAmount,
          refundAmount,
          invoice.token_mint,
          refundAmount // balance check: WHERE total_balance >= ?
        );

        // If pool couldn't cover it (shouldn't happen due to check above, but safety net)
        if (poolResult.changes === 0) {
          // Revert entry to lost
          lotteryEntryQueries.settle.run("lost", 0, randomBytes.toString("hex"), now, txSig, entryId);
          return "forced_loss";
        }
      }

      // Mark invoice as paid with the tx signature
      invoiceQueries.updateStatus.run("paid", now, txSig, entry.invoice_id);

      return true;
    });

    const result = settleTransaction();

    if (result === false) {
      // Already settled by another request - return current state
      const updated = lotteryEntryQueries.getById.get(entryId) as any;
      res.json({
        entryId,
        won: updated.won === 1,
        randomValue,
        threshold: entry.win_probability_bps,
        invoiceAmount: entry.invoice_amount,
        premiumPaid: entry.premium_paid,
        status: updated.status,
        message: updated.won === 1
          ? "Congratulations! You won! Your invoice was paid for FREE!"
          : "Better luck next time! Your invoice has been paid.",
      });
      return;
    }

    if (result === "forced_loss") {
      won = false;
    }

    // If won, send on-chain refund from pool wallet to winner
    let refundTxSignature: string | null = null;
    if (won) {
      const refundAmount = entry.invoice_amount + entry.premium_paid;
      try {
        refundTxSignature = await sendRefund(entry.client_wallet, refundAmount, invoice.token_mint);
        lotteryEntryQueries.updateRefundTx.run(refundTxSignature, entryId);
        console.log(`Refund sent for entry ${entryId}: ${refundAmount} to ${entry.client_wallet}, tx: ${refundTxSignature}`);
      } catch (refundError) {
        console.error(`Refund FAILED for entry ${entryId}:`, refundError);
        // Mark as refund_failed so it can be retried manually
        try {
          lotteryEntryQueries.updateStatus.run("refund_failed", entryId);
        } catch {
          // If CHECK constraint blocks refund_failed (old DB), leave as won
          console.error(`Could not set refund_failed status for entry ${entryId}, leaving as won`);
        }
      }
    }

    const refundFailed = won && !refundTxSignature;
    res.status(refundFailed ? 202 : 200).json({
      entryId,
      won,
      randomValue,
      threshold: entry.win_probability_bps,
      invoiceAmount: entry.invoice_amount,
      premiumPaid: entry.premium_paid,
      refundAmount: won ? entry.invoice_amount + entry.premium_paid : 0,
      refundTxSignature,
      refundPending: refundFailed,
      status: won ? "won" : "lost",
      message: won
        ? (refundFailed
          ? "You won! Refund is being processed — check back shortly."
          : "Congratulations! You won! Your invoice was paid for FREE!")
        : "Better luck next time! Your invoice has been paid.",
    });
  } catch (error) {
    console.error("Error settling lottery:", error);
    res.status(500).json({ error: "Failed to settle lottery" });
  }
});

// Get entry by ID
router.get("/entry/:entryId", async (req: Request, res: Response) => {
  try {
    const { entryId } = req.params;
    const entry = lotteryEntryQueries.getById.get(entryId) as any;

    if (!entry) {
      res.status(404).json({ error: "Lottery entry not found" });
      return;
    }

    res.json({
      id: entry.id,
      invoiceId: entry.invoice_id,
      clientWallet: entry.client_wallet,
      invoiceAmount: entry.invoice_amount,
      premiumPaid: entry.premium_paid,
      winProbabilityBps: entry.win_probability_bps,
      winProbabilityPct: (entry.win_probability_bps / 100).toFixed(1) + "%",
      status: entry.status,
      won: entry.won === 1,
      createdAt: entry.created_at,
      resolvedAt: entry.resolved_at,
    });
  } catch (error) {
    console.error("Error fetching lottery entry:", error);
    res.status(500).json({ error: "Failed to fetch lottery entry" });
  }
});

// Get recent wins (for social proof)
router.get("/recent-wins", async (req: Request, res: Response) => {
  try {
    const wins = lotteryEntryQueries.getRecentWins.all() as any[];

    res.json(
      wins.map((w) => ({
        clientWallet: w.client_wallet.slice(0, 4) + "..." + w.client_wallet.slice(-4),
        amountWon: w.invoice_amount,
        premiumPaid: w.premium_paid,
        memo: w.memo || "Invoice payment",
        timestamp: w.resolved_at,
      }))
    );
  } catch (error) {
    console.error("Error fetching recent wins:", error);
    res.status(500).json({ error: "Failed to fetch recent wins" });
  }
});

// Initialize pool (admin endpoint with API key)
router.post("/pool/init", async (req: Request, res: Response) => {
  try {
    // Require admin API key
    const apiKey = req.headers["x-admin-key"] || req.body.adminKey;
    if (apiKey !== ADMIN_KEY) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    const { tokenMint, initialBalance } = req.body;

    if (!tokenMint) {
      res.status(400).json({ error: "Token mint required" });
      return;
    }

    if (!isValidPublicKey(tokenMint)) {
      res.status(400).json({ error: "Invalid token mint address" });
      return;
    }

    // Check if pool exists
    let pool = lotteryPoolQueries.getByTokenMint.get(tokenMint) as any;
    if (pool) {
      res.status(400).json({ error: "Pool already exists" });
      return;
    }

    // Create pool
    const poolId = uuidv4();
    lotteryPoolQueries.create.run(
      poolId,
      tokenMint,
      DEFAULT_HOUSE_EDGE_BPS,
      DEFAULT_MIN_RESERVE_BPS,
      DEFAULT_MAX_WIN_BPS,
      null
    );

    // If initial balance provided, update it
    if (initialBalance && Number.isInteger(initialBalance) && initialBalance > 0) {
      lotteryPoolQueries.addPremium.run(
        initialBalance,
        0,
        tokenMint
      );
    }

    pool = lotteryPoolQueries.getByTokenMint.get(tokenMint) as any;

    res.json({
      id: pool.id,
      tokenMint: pool.token_mint,
      totalBalance: pool.total_balance,
      houseEdgeBps: pool.house_edge_bps,
      lotteryAvailable: pool.total_balance >= MIN_POOL_THRESHOLD,
    });
  } catch (error) {
    console.error("Error initializing pool:", error);
    res.status(500).json({ error: "Failed to initialize pool" });
  }
});

export default router;
