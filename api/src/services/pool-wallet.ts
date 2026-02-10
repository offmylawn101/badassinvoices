import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Load pool wallet keypair
const keypairPath = path.join(__dirname, "..", "..", "..", "keypair.json");
const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
const POOL_KEYPAIR = Keypair.fromSecretKey(Uint8Array.from(keypairData));
export const POOL_PUBKEY = POOL_KEYPAIR.publicKey;

const connection = new Connection(SOLANA_RPC);

/**
 * Send a refund from the pool wallet to a winner.
 * Returns the transaction signature on success, throws on failure.
 */
export async function sendRefund(
  recipientWallet: string,
  amount: number,
  tokenMint: string
): Promise<string> {
  const recipientPubkey = new PublicKey(recipientWallet);
  const transaction = new Transaction();

  if (tokenMint === SOL_MINT) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: POOL_PUBKEY,
        toPubkey: recipientPubkey,
        lamports: amount,
      })
    );
  } else {
    const mintPubkey = new PublicKey(tokenMint);
    const poolAta = await getAssociatedTokenAddress(mintPubkey, POOL_PUBKEY);
    const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

    // Create recipient ATA if it doesn't exist
    try {
      await getAccount(connection, recipientAta);
    } catch {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          POOL_PUBKEY, // payer
          recipientAta,
          recipientPubkey,
          mintPubkey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    transaction.add(
      createTransferInstruction(
        poolAta,
        recipientAta,
        POOL_PUBKEY,
        amount,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  const signature = await sendAndConfirmTransaction(connection, transaction, [POOL_KEYPAIR], {
    commitment: "confirmed",
  });

  console.log(`Pool refund sent: ${amount} to ${recipientWallet}, tx: ${signature}`);
  return signature;
}

/**
 * Get the on-chain balance of the pool wallet for a given token.
 */
export async function getPoolOnChainBalance(tokenMint: string): Promise<number> {
  try {
    if (tokenMint === SOL_MINT) {
      return await connection.getBalance(POOL_PUBKEY);
    }

    const mintPubkey = new PublicKey(tokenMint);
    const poolAta = await getAssociatedTokenAddress(mintPubkey, POOL_PUBKEY);
    const accountInfo = await connection.getTokenAccountBalance(poolAta);
    return parseInt(accountInfo.value.amount);
  } catch {
    return 0;
  }
}
