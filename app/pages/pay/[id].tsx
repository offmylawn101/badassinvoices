import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
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
  LotteryResult,
} from "@/lib/api";

// Use local proxy to avoid ad blocker issues

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

  // Pool wallet for lottery payments
  const [poolWalletAddress, setPoolWalletAddress] = useState<string | null>(null);

  // Spin to Win state
  const [riskSlider, setRiskSlider] = useState(0); // 0-50%
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
      const SOL_MINT = "So11111111111111111111111111111111111111112";

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

  // Calculate payment amount based on slider (0% = 1x, 50% = 2x)
  const getPaymentAmount = useCallback(() => {
    if (!data) return 0;
    const multiplier = 1 + (riskSlider / 50); // 0% -> 1x, 50% -> 2x
    return Math.floor(data.amount * multiplier);
  }, [data, riskSlider]);

  // Win chance equals slider value
  const getWinChance = () => riskSlider;

  // Check if wallet has enough balance
  const hasEnoughBalance = useCallback(() => {
    if (walletBalance === null) return false;
    return walletBalance >= getPaymentAmount();
  }, [walletBalance, getPaymentAmount]);

  // Get max allowed slider value based on wallet balance
  const getMaxSlider = useCallback(() => {
    if (!data || walletBalance === null) return 50; // Default to max until balance is known
    // Find max slider where payment <= balance
    // payment = amount * (1 + slider/50)
    // balance >= amount * (1 + slider/50)
    // balance/amount >= 1 + slider/50
    // balance/amount - 1 >= slider/50
    // (balance/amount - 1) * 50 >= slider
    const max = Math.floor((walletBalance / data.amount - 1) * 50);
    return Math.min(50, Math.max(0, max));
  }, [data, walletBalance]);

  // Clamp slider when maxSlider changes (e.g., after balance loads)
  const maxSlider = getMaxSlider();
  useEffect(() => {
    if (riskSlider > maxSlider) {
      setRiskSlider(maxSlider);
    }
  }, [maxSlider, riskSlider]);

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
      const SOL_MINT = "So11111111111111111111111111111111111111112";

      const paymentAmount = getPaymentAmount();
      const invoiceAmount = data.amount;
      const premiumAmount = paymentAmount - invoiceAmount;
      const isLottery = riskSlider > 0 && premiumAmount > 0 && poolWalletAddress;

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

      // If using spin (slider > 0), show the wheel
      if (riskSlider > 0) {
        const premiumPaid = paymentAmount - data.amount;

        // Verify payment on-chain first (marks invoice as paid in DB)
        // Pass expectedAmount = invoiceAmount since creator only receives that portion
        await fetch(`/api/v1/hooks/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: data.id,
            txSignature: signature,
            expectedAmount: data.amount,
          }),
        });

        // Create lottery entry with riskSlider so backend uses correct probability
        const entry = await createLotteryEntry(
          data.id,
          publicKey.toString(),
          premiumPaid,
          riskSlider,
          signature
        );

        // Settle lottery on backend FIRST to get the actual result
        const result = await settleLottery(entry.id);
        const won = result.won;

        // Calculate wheel rotation based on BACKEND result
        // Wheel has WIN and LOSE sections
        // WIN section is riskSlider% of wheel, LOSE is rest
        // We animate to land on the correct section based on actual result
        const baseRotations = 5; // Number of full rotations
        let finalAngle: number;

        if (won) {
          // Land in WIN section (0 to riskSlider% of 360)
          finalAngle = Math.random() * (riskSlider / 100 * 360);
        } else {
          // Land in LOSE section (riskSlider% to 100% of 360)
          finalAngle = (riskSlider / 100 * 360) + Math.random() * ((100 - riskSlider) / 100 * 360);
        }

        const totalRotation = baseRotations * 360 + finalAngle;

        // Reset wheel to 0 first, then show it
        setWheelRotation(0);
        setShowSpinWheel(true);
        setSpinning(true);

        // Small delay to let React render wheel at 0 degrees, then trigger animation
        await new Promise(resolve => setTimeout(resolve, 50));
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
        await fetch(`/api/v1/hooks/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: data.id,
            txSignature: signature,
          }),
        });
        toast.success("Payment sent!");
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
  const canSpin = riskSlider > 0;

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
                        className="absolute w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-gold wheel-light"
                        style={{
                          top: `${50 - 46 * Math.cos((i * 18 * Math.PI) / 180)}%`,
                          left: `${50 + 46 * Math.sin((i * 18 * Math.PI) / 180)}%`,
                          animationDelay: `${i * 0.05}s`
                        }}
                      />
                    ))}
                  </div>

                  {/* The Wheel */}
                  <div
                    className="absolute inset-3 rounded-full overflow-hidden shadow-inner"
                    style={{
                      transform: `rotate(${wheelRotation}deg)`,
                      transition: 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)'
                    }}
                  >
                    {/* Wheel segments - alternating WIN (green) and LOSE (red) */}
                    <svg viewBox="0 0 100 100" className="w-full h-full">
                      {/* Create 12 segments - distribute WIN/LOSE based on odds */}
                      {[...Array(12)].map((_, i) => {
                        const segmentAngle = 30;
                        const startAngle = i * segmentAngle - 90;
                        const endAngle = startAngle + segmentAngle;

                        // Calculate which rotation would land on this segment
                        // Segment i is hit when rotation is around (360 - i*30 - 15)
                        const segmentCenterRotation = (360 - i * 30 - 15 + 360) % 360;
                        const winAngle = riskSlider * 3.6; // riskSlider% of 360
                        const isWin = segmentCenterRotation < winAngle;

                        const color = isWin ? '#22C55E' : '#DC2626';
                        const darkerColor = isWin ? '#16A34A' : '#B91C1C';

                        const startRad = (startAngle * Math.PI) / 180;
                        const endRad = (endAngle * Math.PI) / 180;
                        const x1 = 50 + 50 * Math.cos(startRad);
                        const y1 = 50 + 50 * Math.sin(startRad);
                        const x2 = 50 + 50 * Math.cos(endRad);
                        const y2 = 50 + 50 * Math.sin(endRad);

                        return (
                          <g key={i}>
                            <path
                              d={`M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`}
                              fill={i % 2 === 0 ? color : darkerColor}
                              stroke="#0F0F0F"
                              strokeWidth="0.5"
                            />
                            {/* Segment label */}
                            <text
                              x="50"
                              y="18"
                              fill="white"
                              fontSize="6"
                              fontWeight="bold"
                              textAnchor="middle"
                              transform={`rotate(${startAngle + 15}, 50, 50)`}
                              style={{ textShadow: '1px 1px 2px black' }}
                            >
                              {isWin ? '🎉' : '💀'}
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
                  🎰 SPINNING... 🎰
                </p>
                <p className="text-gray-400 mt-2">
                  {riskSlider}% chance to WIN!
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
                    <p className="text-gray-400 mb-4 text-lg">
                      Your invoice has been paid.
                    </p>
                    <div className="bg-casino-black/50 border border-gray-600 rounded-lg p-4 mb-6">
                      <p className="text-gray-400">
                        You paid {formatAmount(getPaymentAmount(), data.tokenMint)}
                      </p>
                    </div>
                  </>
                )}
                <button
                  onClick={() => setShowSpinWheel(false)}
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
            <div className="flex items-center gap-3">
              <img src="/logo.png?v=3" alt="BadassInvoices" className="w-10 h-10 rounded-lg" />
              <h1 className="text-2xl font-bold text-gold">BadassInvoices</h1>
            </div>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-casino-dark rounded-xl shadow-lg overflow-hidden border border-gold/20">
          {/* Status Banner */}
          {isPaid && (
            <div className="bg-lucky-green text-white text-center py-3 font-bold text-lg">
              PAID
            </div>
          )}
          {isOverdue && !isPaid && (
            <div className="bg-lucky-red text-white text-center py-3 font-bold">
              OVERDUE
            </div>
          )}

          <div className="p-8">
            {/* Invoice ID */}
            <div className="text-center mb-6">
              <p className="text-gray-500 text-sm">Invoice</p>
              <p className="font-mono font-medium text-lg text-gray-300">{data.id}</p>
            </div>

            {/* Amount */}
            <div className="text-center mb-6">
              <p className="text-gray-500 text-sm">Invoice Amount</p>
              <p className="text-4xl font-bold gradient-text">
                {formatAmount(data.amount, data.tokenMint)}
              </p>
              <p className="text-gray-500 text-sm mt-1">
                {getTokenSymbol(data.tokenMint)}
              </p>
            </div>

            {/* Details */}
            <div className="space-y-3 mb-6 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-700">
                <span className="text-gray-500">Due Date</span>
                <span className={isOverdue && !isPaid ? "text-lucky-red font-medium" : "text-gray-300"}>
                  {new Date(data.dueDate * 1000).toLocaleDateString()}
                </span>
              </div>
              {data.memo && (
                <div className="py-2 border-b border-gray-700">
                  <p className="text-gray-500 text-sm mb-1">Description</p>
                  <p className="text-gray-300">{data.memo}</p>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-gray-700">
                <span className="text-gray-500">Pay to</span>
                <span className="font-mono text-sm text-gray-300">
                  {data.creatorWallet.slice(0, 4)}...{data.creatorWallet.slice(-4)}
                </span>
              </div>
            </div>

            {/* Spin to Win Section */}
            {!isPaid && connected && (
              <div className="mb-8 bg-gradient-to-br from-casino-black to-casino-dark rounded-xl p-6 border border-gold/30">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl text-gold">$</span>
                    <h3 className="font-bold text-lg text-gold">SPIN TO WIN</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Your Balance</p>
                    <p className={`font-mono text-sm ${hasEnoughBalance() ? 'text-lucky-green' : 'text-lucky-red'}`}>
                      {checkingBalance ? '...' : walletBalance !== null ? formatAmount(walletBalance, data.tokenMint) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Risk Slider */}
                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">Risk Level</span>
                    <span className="text-gold font-bold">{riskSlider}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={maxSlider}
                    value={riskSlider}
                    onChange={(e) => setRiskSlider(Number(e.target.value))}
                    disabled={maxSlider === 0 && walletBalance !== null}
                    className="w-full h-3 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                    style={{
                      background: `linear-gradient(to right, #FFD700 0%, #FFD700 ${maxSlider > 0 ? (riskSlider / maxSlider) * 100 : 0}%, #374151 ${maxSlider > 0 ? (riskSlider / maxSlider) * 100 : 0}%, #374151 100%)`
                    }}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0% (Standard Pay)</span>
                    <span>{maxSlider}% Max ({(1 + maxSlider/50).toFixed(1)}x Price)</span>
                  </div>
                  {maxSlider < 50 && (
                    <p className="text-xs text-lucky-red mt-2">
                      Max {maxSlider}% based on your balance
                    </p>
                  )}
                </div>

                {/* Payment Summary */}
                <div className="bg-casino-black/50 rounded-lg p-4 space-y-3 border border-gold/20">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Invoice Amount</span>
                    <span className="text-gray-200">{formatAmount(data.amount, data.tokenMint)}</span>
                  </div>
                  {riskSlider > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Risk Premium (+{Math.round((riskSlider / 50) * 100)}%)</span>
                      <span className="text-gold">+{formatAmount(getPaymentAmount() - data.amount, data.tokenMint)}</span>
                    </div>
                  )}
                  <div className="border-t border-gold/20 pt-3 flex justify-between font-bold text-lg">
                    <span className="text-white">You Pay</span>
                    <span className="text-gold">{formatAmount(getPaymentAmount(), data.tokenMint)}</span>
                  </div>
                </div>

                {/* Win Chance Display */}
                {riskSlider > 0 && (
                  <div className="mt-4 text-center p-4 bg-lucky-green/10 border border-lucky-green/30 rounded-lg">
                    <p className="text-sm text-gray-400 mb-1">YOUR WIN CHANCE</p>
                    <p className="text-5xl font-bold text-lucky-green">{riskSlider}%</p>
                    <div className="mt-2 text-sm">
                      <span className="text-lucky-green font-bold">WIN</span>
                      <span className="text-gray-400"> = Invoice FREE (full refund)</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-lucky-red font-bold">LOSE</span>
                      <span className="text-gray-400"> = Pay {formatAmount(getPaymentAmount(), data.tokenMint)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pay Button */}
            {!isPaid && (
              <>
                {!connected ? (
                  <div className="text-center">
                    <p className="text-gray-400 mb-4">Connect your wallet to pay</p>
                    <WalletMultiButton />
                  </div>
                ) : (
                  <button
                    onClick={handlePay}
                    disabled={paying || !hasEnoughBalance()}
                    className={`w-full py-4 rounded-lg font-bold text-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${
                      canSpin
                        ? "bg-gradient-to-r from-lucky-red to-gold text-white hover:from-gold hover:to-lucky-red glow-gold"
                        : "bg-gradient-to-r from-gold to-gold-dark text-casino-black hover:from-gold-dark hover:to-gold"
                    }`}
                  >
                    {paying ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></span>
                        Processing...
                      </span>
                    ) : !hasEnoughBalance() ? (
                      "Insufficient Balance"
                    ) : canSpin ? (
                      <>SPIN THE WHEEL - {formatAmount(getPaymentAmount(), data.tokenMint)}</>
                    ) : (
                      <>Pay {formatAmount(getPaymentAmount(), data.tokenMint)}</>
                    )}
                  </button>
                )}
              </>
            )}

            {isPaid && (
              <div className="text-center p-6 bg-lucky-green/20 border border-lucky-green rounded-lg">
                <p className="text-lucky-green font-bold text-lg">
                  This invoice has been paid.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-sm mt-8">
          Powered by <span className="text-gold">BadassInvoices</span> on Solana
        </p>
      </main>

      {/* Custom slider styles */}
      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #FFD700, #B8860B);
          cursor: pointer;
          border: 3px solid #0F0F0F;
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #FFD700, #B8860B);
          cursor: pointer;
          border: 3px solid #0F0F0F;
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }
      `}</style>
    </div>
  );
}
