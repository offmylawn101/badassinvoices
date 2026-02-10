import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import {
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import toast from "react-hot-toast";
import {
  getPaymentData,
  formatAmount,
  getTokenSymbol,
  createLotteryEntry,
  settleLottery,
  getPoolWallet,
  getLotteryPool,
  LotteryPool,
} from "@/lib/api";

interface PaymentLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface PaymentData {
  id: string;
  creatorWallet: string;
  amount: number;
  tokenMint: string;
  dueDate: number;
  memo: string | null;
  status: string;
  milestones: any[] | null;
  lineItems: PaymentLineItem[] | null;
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

  // Pool wallet and data for lottery payments
  const [poolWalletAddress, setPoolWalletAddress] = useState<string | null>(null);
  const [poolData, setPoolData] = useState<LotteryPool | null>(null);

  // Double or Nothing state
  const [doubleOrNothing, setDoubleOrNothing] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [showSpinWheel, setShowSpinWheel] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [spinResult, setSpinResult] = useState<"win" | "lose" | null>(null);
  const [wheelRotation, setWheelRotation] = useState(0);

  useEffect(() => {
    if (router.isReady && id) {
      loadPaymentData();
    }
    // Fetch pool wallet address for lottery payments
    getPoolWallet()
      .then(setPoolWalletAddress)
      .catch(() => console.warn("Could not fetch pool wallet"));
  }, [router.isReady, id]);

  // Fetch pool data when we have invoice data
  useEffect(() => {
    if (data?.tokenMint) {
      getLotteryPool(data.tokenMint)
        .then(setPoolData)
        .catch(() => setPoolData(null));
    }
  }, [data?.tokenMint]);

  useEffect(() => {
    if (connected && publicKey && data) {
      checkWalletBalance();
    }
  }, [connected, publicKey, data]);

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

  async function checkWalletBalance() {
    if (!publicKey || !data) return;
    setCheckingBalance(true);
    try {
      if (data.tokenMint === SOL_MINT) {
        const balance = await connection.getBalance(publicKey);
        setWalletBalance(balance);
      } else {
        const mintPubkey = new PublicKey(data.tokenMint);
        const ata = await getAssociatedTokenAddress(mintPubkey, publicKey);
        try {
          const account = await getAccount(connection, ata);
          setWalletBalance(Number(account.amount));
        } catch {
          setWalletBalance(0);
        }
      }
    } catch (error) {
      console.error("Failed to check balance:", error);
      setWalletBalance(null);
    } finally {
      setCheckingBalance(false);
    }
  }

  // Payment amount: normal or 2x for double or nothing
  const getPaymentAmount = useCallback(() => {
    if (!data) return 0;
    return doubleOrNothing ? data.amount * 2 : data.amount;
  }, [data, doubleOrNothing]);

  // Check if wallet has enough balance (include ~0.01 SOL fee buffer for SOL payments)
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const hasEnoughBalance = useCallback(() => {
    if (walletBalance === null || !data) return false;
    const feeBuffer = data.tokenMint === SOL_MINT ? 10_000_000 : 0; // 0.01 SOL for tx fees + rent
    return walletBalance >= getPaymentAmount() + feeBuffer;
  }, [walletBalance, getPaymentAmount, data]);

  // Can play double or nothing? (must afford 2x AND invoice must be <= max win)
  const canPlayDouble = useCallback(() => {
    if (!data || walletBalance === null) return false;
    if (walletBalance < data.amount * 2) return false;
    // Check if pool allows this invoice amount as a win
    if (!poolData || !poolData.lotteryAvailable) return false;
    if (data.amount > poolData.maxWin) return false;
    return true;
  }, [data, walletBalance, poolData]);

  // Reason why double or nothing is unavailable
  const doubleUnavailableReason = useCallback(() => {
    if (!data) return null;
    if (!poolData || !poolData.lotteryAvailable) return "Pool unavailable";
    if (data.amount > poolData.maxWin) {
      return `Invoice exceeds max win (${formatAmount(poolData.maxWin, data.tokenMint)})`;
    }
    if (walletBalance !== null && walletBalance < data.amount * 2) {
      return "Insufficient balance for 2x";
    }
    return null;
  }, [data, poolData, walletBalance]);

  async function handlePay() {
    if (!publicKey || !signTransaction || !data) {
      toast.error("Please connect your wallet");
      return;
    }

    if (!hasEnoughBalance()) {
      toast.error("Insufficient balance");
      return;
    }

    setPaying(true);

    try {
      const recipientPubkey = new PublicKey(data.creatorWallet);
      const mintPubkey = new PublicKey(data.tokenMint);

      const paymentAmount = getPaymentAmount();
      const invoiceAmount = data.amount;
      const premiumAmount = paymentAmount - invoiceAmount;
      const isLottery = doubleOrNothing && premiumAmount > 0 && poolWalletAddress;

      const transaction = new Transaction();

      if (data.tokenMint === SOL_MINT) {
        // Transfer invoice amount to creator
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: recipientPubkey,
            lamports: invoiceAmount,
          })
        );
        // If lottery, transfer premium to pool wallet
        if (isLottery) {
          const poolPubkey = new PublicKey(poolWalletAddress);
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: poolPubkey,
              lamports: premiumAmount,
            })
          );
        }
      } else {
        const payerAta = await getAssociatedTokenAddress(mintPubkey, publicKey);
        const recipientAta = await getAssociatedTokenAddress(
          mintPubkey,
          recipientPubkey
        );

        // Check if recipient's token account exists, if not create it
        try {
          await getAccount(connection, recipientAta);
        } catch {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              recipientAta,
              recipientPubkey,
              mintPubkey,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }

        // Transfer invoice amount to creator
        transaction.add(
          createTransferInstruction(
            payerAta,
            recipientAta,
            publicKey,
            invoiceAmount,
            [],
            TOKEN_PROGRAM_ID
          )
        );

        // If lottery, transfer premium to pool wallet
        if (isLottery) {
          const poolPubkey = new PublicKey(poolWalletAddress);
          const poolAta = await getAssociatedTokenAddress(mintPubkey, poolPubkey);

          // Create pool ATA if it doesn't exist
          try {
            await getAccount(connection, poolAta);
          } catch {
            transaction.add(
              createAssociatedTokenAccountInstruction(
                publicKey,
                poolAta,
                poolPubkey,
                mintPubkey,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            );
          }

          transaction.add(
            createTransferInstruction(
              payerAta,
              poolAta,
              publicKey,
              premiumAmount,
              [],
              TOKEN_PROGRAM_ID
            )
          );
        }
      }

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = publicKey;

      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Poll for confirmation instead of using WebSocket (which our proxy doesn't support)
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await connection.getSignatureStatuses([signature]);
        if (status.value[0]?.confirmationStatus === "confirmed" ||
            status.value[0]?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
      }

      if (!confirmed) {
        throw new Error("Transaction confirmation timeout");
      }

      // If double or nothing, show the wheel
      if (doubleOrNothing) {
        const premiumPaid = paymentAmount - data.amount;

        // Verify payment on-chain first (marks invoice as paid in DB)
        const verifyRes = await fetch(`/api/v1/hooks/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: data.id,
            txSignature: signature,
            expectedAmount: data.amount,
          }),
        });
        if (!verifyRes.ok) {
          const err = await verifyRes.json().catch(() => ({ error: "Verification failed" }));
          throw new Error(err.error || "Payment verification failed");
        }

        // Create lottery entry — always riskSlider=50 for double or nothing
        const entry = await createLotteryEntry(
          data.id,
          publicKey.toString(),
          premiumPaid,
          50,
          signature
        );

        // Settle lottery on backend FIRST to get the actual result
        const result = await settleLottery(entry.id);
        const won = result.won;

        // Calculate wheel rotation based on BACKEND result
        // 12 alternating segments (30° each): even=WIN (FREE), odd=LOSE (PAY 2X)
        // Wheel rotates clockwise, pointer is fixed at top
        // To land on segment N, we rotate so segment N comes to top
        const winSegments = [0, 2, 4, 6, 8, 10];
        const loseSegments = [1, 3, 5, 7, 9, 11];
        const segments = won ? winSegments : loseSegments;
        const segment = segments[Math.floor(Math.random() * segments.length)];
        // Segment N starts at N*30° from top. To bring it back to top, rotate by -N*30 (or 360-N*30)
        // Add offset to land in middle of segment (not on edge)
        const segmentCenter = segment * 30 + 15; // center of segment
        const finalAngle = 360 - segmentCenter + (Math.random() * 10 - 5); // ±5° jitter
        const totalRotation = 5 * 360 + finalAngle;

        // Show the wheel at 0°, then trigger animation after paint
        setWheelRotation(0);
        setShowSpinWheel(true);
        setSpinning(true);

        // Wait for two animation frames to ensure browser has painted 0° state
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        setWheelRotation(totalRotation);

        // Wait for spin animation to complete
        await new Promise(resolve => setTimeout(resolve, 4000));

        setSpinning(false);
        setSpinResult(won ? "win" : "lose");

        if (won) {
          toast.success("YOU WON! Invoice is FREE!");
        } else {
          toast.success("Invoice paid!");
        }
      } else {
        // Standard payment
        const stdVerifyRes = await fetch(`/api/v1/hooks/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: data.id,
            txSignature: signature,
          }),
        });
        if (!stdVerifyRes.ok) {
          const err = await stdVerifyRes.json().catch(() => ({ error: "Verification failed" }));
          console.error("Payment verification failed:", err);
          toast.error("Payment sent but verification failed. It will be confirmed shortly.");
        } else {
          toast.success("Payment sent!");
        }
      }

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
      <div className="min-h-screen bg-casino-black flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-gold border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-casino-black flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-gold">Invoice Not Found</h1>
          <p className="text-gray-400">This invoice does not exist or has been removed.</p>
        </div>
      </div>
    );
  }

  const isPaid = data.status === "paid";
  const isOverdue = data.dueDate < Math.floor(Date.now() / 1000);

  return (
    <div className="min-h-screen bg-casino-black">
      {/* Spin Wheel Modal */}
      {showSpinWheel && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50">
          <div className="text-center">
            {spinning ? (
              <>
                {/* Spinning Wheel */}
                <div className="relative w-72 h-72 sm:w-96 sm:h-96 mx-auto mb-8">
                  {/* Outer glow */}
                  <div className="absolute inset-0 rounded-full bg-gold/20 blur-xl animate-pulse"></div>

                  {/* Pointer/Arrow at top */}
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20">
                    <div className="w-0 h-0 border-l-[18px] border-r-[18px] border-t-[28px] border-l-transparent border-r-transparent border-t-gold drop-shadow-[0_0_10px_rgba(255,215,0,0.8)]"></div>
                  </div>

                  {/* Outer ring with chasing lights */}
                  <div className="absolute inset-0 rounded-full border-[12px] border-casino-dark shadow-[0_0_30px_rgba(255,215,0,0.3)]">
                    {[...Array(20)].map((_, i) => (
                      <div
                        key={i}
                        className="absolute w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-gold wheel-light -translate-x-1/2 -translate-y-1/2"
                        style={{
                          top: `${50 - 46 * Math.cos((i * 18 * Math.PI) / 180)}%`,
                          left: `${50 + 46 * Math.sin((i * 18 * Math.PI) / 180)}%`,
                          animationDelay: `${i * 0.05}s`
                        }}
                      />
                    ))}
                  </div>

                  {/* The Wheel — 50/50 split */}
                  <div
                    className="absolute inset-3 rounded-full overflow-hidden shadow-inner"
                    style={{
                      transform: `rotate(${wheelRotation}deg)`,
                      transition: 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)'
                    }}
                  >
                    <svg viewBox="0 0 100 100" className="w-full h-full">
                      {/* 12 segments alternating WIN/LOSE — 6 each for 50/50 */}
                      {[...Array(12)].map((_, i) => {
                        const segmentAngle = 30;
                        const startAngle = i * segmentAngle - 90;
                        const endAngle = startAngle + segmentAngle;
                        const isWin = i % 2 === 0;

                        const color = isWin ? '#22C55E' : '#DC2626';
                        const darkerColor = isWin ? '#16A34A' : '#B91C1C';

                        const startRad = (startAngle * Math.PI) / 180;
                        const endRad = (endAngle * Math.PI) / 180;
                        const x1 = 50 + 50 * Math.cos(startRad);
                        const y1 = 50 + 50 * Math.sin(startRad);
                        const x2 = 50 + 50 * Math.cos(endRad);
                        const y2 = 50 + 50 * Math.sin(endRad);

                        // Text position: middle of segment, 65% out from center
                        const midAngle = startAngle + segmentAngle / 2;
                        const midRad = (midAngle * Math.PI) / 180;
                        const textX = 50 + 32 * Math.cos(midRad);
                        const textY = 50 + 32 * Math.sin(midRad);

                        return (
                          <g key={i}>
                            <path
                              d={`M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`}
                              fill={i % 4 < 2 ? color : darkerColor}
                              stroke="#0F0F0F"
                              strokeWidth="0.5"
                            />
                            <text
                              x={textX}
                              y={textY}
                              fill="white"
                              fontSize="5"
                              fontWeight="bold"
                              textAnchor="middle"
                              dominantBaseline="middle"
                              transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}
                            >
                              {isWin ? 'FREE' : 'PAY 2X'}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Center hub */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-gold to-gold-dark border-4 border-casino-dark shadow-lg flex items-center justify-center z-10">
                    <span className="text-casino-black font-black text-xl sm:text-2xl">SPIN</span>
                  </div>
                </div>

                <p className="text-3xl font-bold text-gold animate-pulse drop-shadow-[0_0_10px_rgba(255,215,0,0.5)]">
                  SPINNING...
                </p>
                <p className="text-gray-400 mt-2">
                  50/50 — Double or Nothing!
                </p>
              </>
            ) : spinResult ? (
              <div className="bg-casino-dark rounded-2xl p-8 max-w-md border-2 border-gold/50">
                {spinResult === "win" ? (
                  <>
                    <div className="text-8xl mb-4 jackpot-text">
                      <span className="text-gold">$</span>
                    </div>
                    <h2 className="text-5xl font-bold text-gold mb-4 glow-gold rounded-lg py-2">YOU WON!</h2>
                    <p className="text-gray-300 mb-4 text-xl">
                      Your invoice is <span className="text-lucky-green font-bold">FREE!</span>
                    </p>
                    <div className="bg-lucky-green/20 border border-lucky-green rounded-lg p-4 mb-6">
                      <p className="text-lucky-green text-lg font-bold">
                        {formatAmount(getPaymentAmount(), data.tokenMint)} will be refunded!
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-7xl mb-4 text-lucky-red">X</div>
                    <h2 className="text-3xl font-bold text-gray-300 mb-4">Better Luck Next Time!</h2>
                    <p className="text-gray-400 mb-6 text-lg">
                      You paid 2x on this invoice.
                    </p>
                  </>
                )}
                <button
                  onClick={() => {
                    setShowSpinWheel(false);
                    setSpinResult(null);
                    setSpinning(false);
                    setWheelRotation(0);
                  }}
                  className="bg-gradient-to-r from-gold to-gold-dark text-casino-black px-8 py-3 rounded-lg font-bold hover:from-gold-dark hover:to-gold transition"
                >
                  Close
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="gradient-bg border-b border-gold/20">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <img src="/logo.png?v=3" alt="BadassInvoices" className="w-10 h-10 rounded-lg" />
              <h1 className="text-2xl font-bold text-gold">BadassInvoices</h1>
            </Link>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8">
        <div className="bg-casino-dark rounded-2xl shadow-xl overflow-hidden border border-gold/20">
          {/* Status Banner */}
          {isPaid && (
            <div className="bg-lucky-green text-white text-center py-2 font-bold">
              PAID
            </div>
          )}
          {isOverdue && !isPaid && (
            <div className="bg-lucky-red text-white text-center py-2 font-bold">
              OVERDUE
            </div>
          )}

          <div className="p-6">
            {/* Amount Hero */}
            <div className="text-center py-6">
              <p className="text-5xl font-bold text-white mb-1">
                {formatAmount(data.amount, data.tokenMint)}
              </p>
              <p className="text-gray-500 text-sm">
                Due {new Date(data.dueDate * 1000).toLocaleDateString()}
              </p>
            </div>

            {/* Invoice Details */}
            <div className="bg-casino-black/50 rounded-xl p-4 mb-6 space-y-3 text-sm">
              {data.memo && (
                <div>
                  <p className="text-gray-500 mb-1">For</p>
                  <p className="text-white">{data.memo}</p>
                </div>
              )}
              {data.lineItems && data.lineItems.length > 0 && (
                <div className="pt-2 border-t border-gray-700/50">
                  {data.lineItems.map((item, i) => (
                    <div key={i} className="flex justify-between py-1">
                      <span className="text-gray-400">
                        {item.description} {item.quantity > 1 && `×${item.quantity}`}
                      </span>
                      <span className="text-gray-300">
                        {formatAmount(item.quantity * item.unitPrice, data.tokenMint)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-gray-700/50">
                <span className="text-gray-500">To</span>
                <span className="font-mono text-gray-300">
                  {data.creatorWallet.slice(0, 4)}...{data.creatorWallet.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Invoice</span>
                <span className="font-mono text-gray-400 text-xs">{data.id}</span>
              </div>
            </div>

            {/* Payment Section */}
            {!isPaid && connected && (
              <>
                {/* Payment Mode Toggle */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setDoubleOrNothing(false)}
                    className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                      !doubleOrNothing
                        ? 'bg-gold text-casino-black'
                        : 'bg-casino-black border border-gray-700 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    Pay Normal
                  </button>
                  <button
                    onClick={() => canPlayDouble() && setDoubleOrNothing(true)}
                    disabled={!canPlayDouble()}
                    className={`flex-1 py-3 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      doubleOrNothing
                        ? 'bg-gradient-to-r from-lucky-green to-emerald-500 text-white'
                        : 'bg-casino-black border border-gray-700 text-gray-400 hover:border-lucky-green/50'
                    }`}
                  >
                    Double or Nothing
                  </button>
                </div>

                {/* Why Double or Nothing is unavailable */}
                {!canPlayDouble() && doubleUnavailableReason() && (
                  <p className="text-xs text-gray-500 mb-4 text-center">
                    {doubleUnavailableReason()}
                  </p>
                )}

                {/* Double or Nothing Info */}
                {doubleOrNothing && (
                  <div className="bg-lucky-green/10 border border-lucky-green/30 rounded-xl p-4 mb-4 text-center">
                    <p className="text-3xl font-bold text-lucky-green mb-2">50/50 CHANCE</p>
                    <p className="text-sm text-gray-400">
                      Win = <span className="text-lucky-green font-semibold">Full refund</span> ·
                      Lose = <span className="text-gray-300">Pay 2x</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      You pay {formatAmount(data.amount * 2, data.tokenMint)} (2× invoice)
                    </p>
                  </div>
                )}

                {/* Balance Warning */}
                {!hasEnoughBalance() && walletBalance !== null && (
                  <p className="text-sm text-lucky-red mb-4 text-center">
                    Insufficient balance ({formatAmount(walletBalance, data.tokenMint)} available)
                  </p>
                )}

                {/* Pay Button */}
                <button
                  onClick={handlePay}
                  disabled={paying || !hasEnoughBalance()}
                  className={`w-full py-4 rounded-xl font-bold text-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    doubleOrNothing
                      ? "bg-gradient-to-r from-lucky-green to-emerald-500 text-white hover:shadow-lg hover:shadow-lucky-green/25"
                      : "bg-gradient-to-r from-gold to-gold-dark text-casino-black hover:shadow-lg hover:shadow-gold/25"
                  }`}
                >
                  {paying ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full"></span>
                      Processing...
                    </span>
                  ) : (
                    <>Pay {formatAmount(getPaymentAmount(), data.tokenMint)}</>
                  )}
                </button>
              </>
            )}

            {/* Connect Wallet */}
            {!isPaid && !connected && (
              <div className="text-center">
                <p className="text-gray-400 mb-4">Connect wallet to pay</p>
                <WalletMultiButton />
              </div>
            )}

            {/* Paid State */}
            {isPaid && (
              <div className="text-center py-4">
                <p className="text-lucky-green font-semibold">
                  This invoice has been paid
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs mt-6">
          Powered by <span className="text-gold">BadassInvoices</span> on Solana
        </p>
      </main>
    </div>
  );
}
