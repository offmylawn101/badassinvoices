import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import toast from "react-hot-toast";
import { getPaymentData, formatAmount, getTokenSymbol } from "@/lib/api";

const API_URL = process.env.API_URL || "http://localhost:3001";

interface PaymentData {
  id: string;
  creatorWallet: string;
  amount: number;
  tokenMint: string;
  dueDate: number;
  memo: string | null;
  status: string;
  milestones: any[] | null;
  paymentLink: string;
  qrCode: string;
}

export default function PaymentPage() {
  const router = useRouter();
  const { id } = router.query;
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [data, setData] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (id) {
      loadPaymentData();
    }
  }, [id]);

  async function loadPaymentData() {
    try {
      const paymentData = await getPaymentData(id as string);
      setData(paymentData);
    } catch (error) {
      toast.error("Invoice not found");
    } finally {
      setLoading(false);
    }
  }

  async function handlePay() {
    if (!publicKey || !signTransaction || !data) {
      toast.error("Please connect your wallet");
      return;
    }

    setPaying(true);

    try {
      const recipientPubkey = new PublicKey(data.creatorWallet);
      const mintPubkey = new PublicKey(data.tokenMint);
      const SOL_MINT = "So11111111111111111111111111111111111111112";

      const transaction = new Transaction();

      if (data.tokenMint === SOL_MINT) {
        // Native SOL transfer
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: recipientPubkey,
            lamports: data.amount,
          })
        );
      } else {
        // SPL token transfer
        const payerAta = await getAssociatedTokenAddress(mintPubkey, publicKey);
        const recipientAta = await getAssociatedTokenAddress(
          mintPubkey,
          recipientPubkey
        );

        transaction.add(
          createTransferInstruction(
            payerAta,
            recipientAta,
            publicKey,
            data.amount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = publicKey;

      // Sign and send
      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      // Notify backend
      await fetch(`${API_URL}/api/webhooks/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: data.id,
          txSignature: signature,
        }),
      });

      toast.success("Payment sent!");
      setData({ ...data, status: "paid" });
    } catch (error: any) {
      console.error("Payment error:", error);
      toast.error(error.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-solana-purple border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Invoice Not Found</h1>
          <p className="text-gray-600">This invoice does not exist or has been removed.</p>
        </div>
      </div>
    );
  }

  const isPaid = data.status === "paid";
  const isOverdue = data.dueDate < Math.floor(Date.now() / 1000);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="gradient-bg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">InvoiceNow</h1>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {/* Status Banner */}
          {isPaid && (
            <div className="bg-green-500 text-white text-center py-3 font-medium">
              PAID
            </div>
          )}
          {isOverdue && !isPaid && (
            <div className="bg-red-500 text-white text-center py-3 font-medium">
              OVERDUE
            </div>
          )}

          <div className="p-8">
            {/* Invoice ID */}
            <div className="text-center mb-8">
              <p className="text-gray-500 text-sm">Invoice</p>
              <p className="font-mono font-medium text-lg">{data.id}</p>
            </div>

            {/* Amount */}
            <div className="text-center mb-8">
              <p className="text-gray-500 text-sm">Amount Due</p>
              <p className="text-5xl font-bold gradient-text">
                {formatAmount(data.amount, data.tokenMint)}
              </p>
              <p className="text-gray-500 text-sm mt-1">
                {getTokenSymbol(data.tokenMint)}
              </p>
            </div>

            {/* Details */}
            <div className="space-y-4 mb-8">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Due Date</span>
                <span className={isOverdue && !isPaid ? "text-red-500 font-medium" : ""}>
                  {new Date(data.dueDate * 1000).toLocaleDateString()}
                </span>
              </div>
              {data.memo && (
                <div className="py-2 border-b">
                  <p className="text-gray-500 text-sm mb-1">Description</p>
                  <p>{data.memo}</p>
                </div>
              )}
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-500">Pay to</span>
                <span className="font-mono text-sm">
                  {data.creatorWallet.slice(0, 4)}...{data.creatorWallet.slice(-4)}
                </span>
              </div>
            </div>

            {/* Milestones */}
            {data.milestones && data.milestones.length > 0 && (
              <div className="mb-8">
                <p className="font-medium mb-3">Milestones</p>
                <div className="space-y-2">
                  {data.milestones.map((m, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                    >
                      <span className="text-sm">{m.description}</span>
                      <span className="font-medium">
                        {formatAmount(m.amount, data.tokenMint)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* QR Code */}
            {!isPaid && (
              <div className="text-center mb-8">
                <p className="text-gray-500 text-sm mb-4">
                  Scan with Solana Pay compatible wallet
                </p>
                <img
                  src={data.qrCode}
                  alt="Payment QR Code"
                  className="w-48 h-48 mx-auto rounded-lg"
                />
              </div>
            )}

            {/* Pay Button */}
            {!isPaid && (
              <>
                {!connected ? (
                  <div className="text-center">
                    <p className="text-gray-600 mb-4">Connect your wallet to pay</p>
                    <WalletMultiButton />
                  </div>
                ) : (
                  <button
                    onClick={handlePay}
                    disabled={paying}
                    className="w-full bg-solana-purple text-white py-4 rounded-lg font-medium text-lg hover:bg-purple-600 transition disabled:opacity-50"
                  >
                    {paying ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></span>
                        Processing...
                      </span>
                    ) : (
                      `Pay ${formatAmount(data.amount, data.tokenMint)}`
                    )}
                  </button>
                )}
              </>
            )}

            {isPaid && (
              <div className="text-center p-6 bg-green-50 rounded-lg">
                <p className="text-green-700 font-medium">
                  This invoice has been paid.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-400 text-sm mt-8">
          Powered by InvoiceNow - Instant invoicing on Solana
        </p>
      </main>
    </div>
  );
}
