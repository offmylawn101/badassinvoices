import { PublicKey, Transaction, SystemProgram, Connection } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import QRCode from "qrcode";

const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const connection = new Connection(SOLANA_RPC);

// USDC mint addresses
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Generate a Solana Pay payment link
 */
export function generatePaymentLink(
  invoiceId: string,
  recipient: string,
  amount: number,
  tokenMint: string,
  memo?: string
): string {
  const baseUrl = process.env.API_URL || "http://localhost:3001";

  // Use Solana Pay transfer request format
  // solana:<recipient>?amount=<amount>&spl-token=<token>&reference=<ref>&label=<label>&message=<msg>
  const recipientPubkey = new PublicKey(recipient);

  // Generate a unique reference for tracking
  const reference = new PublicKey(invoiceId.padEnd(32, "0").slice(0, 32));

  let url = `solana:${recipientPubkey.toString()}`;
  const params = new URLSearchParams();

  // Convert amount from smallest unit to decimal
  // USDC has 6 decimals, SOL has 9
  const decimals = tokenMint === SOL_MINT ? 9 : 6;
  const decimalAmount = amount / Math.pow(10, decimals);
  params.append("amount", decimalAmount.toString());

  // Add SPL token if not native SOL
  if (tokenMint !== SOL_MINT) {
    params.append("spl-token", tokenMint);
  }

  // Add reference for tracking
  params.append("reference", reference.toString());

  // Add label and message
  params.append("label", "InvoiceNow");
  if (memo) {
    params.append("message", `Invoice ${invoiceId}: ${memo}`);
  } else {
    params.append("message", `Invoice ${invoiceId}`);
  }

  return `${url}?${params.toString()}`;
}

/**
 * Generate QR code data URL for a payment link
 */
export async function generateQRCode(paymentLink: string): Promise<string> {
  try {
    const qrDataUrl = await QRCode.toDataURL(paymentLink, {
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });
    return qrDataUrl;
  } catch (error) {
    console.error("QR generation error:", error);
    throw error;
  }
}

/**
 * Create a Solana Pay transaction for the client to sign
 */
export async function createSolanaPayTransaction(
  recipient: string,
  payer: string,
  amount: number,
  tokenMint: string,
  invoiceId: string
): Promise<string> {
  const recipientPubkey = new PublicKey(recipient);
  const payerPubkey = new PublicKey(payer);

  const transaction = new Transaction();

  if (tokenMint === SOL_MINT) {
    // Native SOL transfer
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: recipientPubkey,
        lamports: amount,
      })
    );
  } else {
    // SPL token transfer
    const mintPubkey = new PublicKey(tokenMint);

    const payerAta = await getAssociatedTokenAddress(mintPubkey, payerPubkey);
    const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

    transaction.add(
      createTransferInstruction(
        payerAta,
        recipientAta,
        payerPubkey,
        amount,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  // Add memo for invoice tracking
  // Using a simple memo program instruction
  const memoInstruction = {
    keys: [],
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    data: Buffer.from(`InvoiceNow:${invoiceId}`),
  };
  transaction.add(memoInstruction);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = payerPubkey;

  // Serialize and return base64
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return serialized.toString("base64");
}

/**
 * Verify a payment transaction on-chain
 */
export async function verifyPayment(
  signature: string,
  expectedRecipient: string,
  expectedAmount: number,
  expectedMint: string
): Promise<boolean> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return false;
    }

    // Check if transaction was successful
    if (tx.meta.err) {
      return false;
    }

    // TODO: Parse transaction to verify recipient and amount
    // This is simplified - in production, parse the actual transfer amounts

    return true;
  } catch (error) {
    console.error("Payment verification error:", error);
    return false;
  }
}

/**
 * Get token balance for a wallet
 */
export async function getTokenBalance(
  wallet: string,
  tokenMint: string
): Promise<number> {
  try {
    const walletPubkey = new PublicKey(wallet);

    if (tokenMint === SOL_MINT) {
      const balance = await connection.getBalance(walletPubkey);
      return balance;
    }

    const mintPubkey = new PublicKey(tokenMint);
    const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);

    const accountInfo = await connection.getTokenAccountBalance(ata);
    return parseInt(accountInfo.value.amount);
  } catch (error) {
    console.error("Balance check error:", error);
    return 0;
  }
}
