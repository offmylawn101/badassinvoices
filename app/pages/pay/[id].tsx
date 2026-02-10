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

  // Payment amount: normal or 2x for double or nothing
  const getPaymentAmount = useCallback(() => {
    if (!data) return 0;
    return doubleOrNothing ? data.amount * 2 : data.amount;
  }, [data, doubleOrNothing]);

  // Check if wallet has enough balance
  const hasEnoughBalance = useCallback(() => {
    if (walletBalance === null) return false;
    return walletBalance >= getPaymentAmount();
  }, [walletBalance, getPaymentAmount]);

  // Can afford double?
  const canAffordDouble = useCallback(() => {
    if (!data || walletBalance === null) return false;
    return walletBalance >= data.amount * 2;
  }, [data, walletBalance]);

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
        await fetch(`/api/v1/hooks/verify-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: data.id,
            txSignature: signature,
            expectedAmount: data.amount,
          }),
        });

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
        // 50/50 wheel — first 180deg is WIN, second 180deg is LOSE
        const baseRotations = 5;
        let finalAngle: number;

        if (won) {
          // Land in WIN section (0-180 degrees)
          finalAngle = Math.random() * 180;
        } else {
          // Land in LOSE section (180-360 degrees)
          finalAngle = 180 + Math.random() * 180;
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

                        return (
                          <g key={i}>
                            <path
                              d={`M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`}
                              fill={i % 4 < 2 ? color : darkerColor}
                              stroke="#0F0F0F"
                              strokeWidth="0.5"
                            />
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
                              {isWin ? 'FREE' : 'PAID'}
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

            {/* Double or Nothing Section */}
            {!isPaid && connected && (
              <div className="mb-8 bg-gradient-to-br from-casino-black to-casino-dark rounded-xl p-6 border border-gold/30">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl text-gold">$</span>
                    <h3 className="font-bold text-lg text-gold">DOUBLE OR NOTHING</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Your Balance</p>
                    <p className={`font-mono text-sm ${hasEnoughBalance() ? 'text-lucky-green' : 'text-lucky-red'}`}>
                      {checkingBalance ? '...' : walletBalance !== null ? formatAmount(walletBalance, data.tokenMint) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Two Option Cards */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {/* Pay Normal */}
                  <button
                    onClick={() => setDoubleOrNothing(false)}
                    className={`relative rounded-xl p-4 border-2 transition-all text-center ${
                      !doubleOrNothing
                        ? 'border-gold bg-gold/10 shadow-lg shadow-gold/10'
                        : 'border-gray-700 bg-casino-black/50 hover:border-gray-500'
                    }`}
                  >
                    {!doubleOrNothing && (
                      <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gold flex items-center justify-center">
                        <svg className="w-3 h-3 text-casino-black" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                    <p className="text-2xl mb-1">💳</p>
                    <p className={`font-bold text-sm ${!doubleOrNothing ? 'text-gold' : 'text-gray-400'}`}>
                      Pay Normal
                    </p>
                    <p className="text-lg font-bold text-white mt-1">
                      {formatAmount(data.amount, data.tokenMint)}
                    </p>
                  </button>

                  {/* Double or Nothing */}
                  <button
                    onClick={() => canAffordDouble() && setDoubleOrNothing(true)}
                    disabled={!canAffordDouble()}
                    className={`relative rounded-xl p-4 border-2 transition-all text-center disabled:opacity-40 disabled:cursor-not-allowed ${
                      doubleOrNothing
                        ? 'border-lucky-green bg-lucky-green/10 shadow-lg shadow-lucky-green/10'
                        : 'border-gray-700 bg-casino-black/50 hover:border-lucky-green/50'
                    }`}
                  >
                    {doubleOrNothing && (
                      <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-lucky-green flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                    <p className="text-2xl mb-1">🎰</p>
                    <p className={`font-bold text-sm ${doubleOrNothing ? 'text-lucky-green' : 'text-gray-400'}`}>
                      Double or Nothing
                    </p>
                    <p className="text-lg font-bold text-white mt-1">
                      {formatAmount(data.amount * 2, data.tokenMint)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">50% chance FREE</p>
                  </button>
                </div>

                {!canAffordDouble() && walletBalance !== null && (
                  <p className="text-xs text-lucky-red mb-3 text-center">
                    Insufficient balance for Double or Nothing
                  </p>
                )}

                {/* Payment Summary */}
                <div className="bg-casino-black/50 rounded-lg p-4 space-y-3 border border-gold/20">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Invoice Amount</span>
                    <span className="text-gray-200">{formatAmount(data.amount, data.tokenMint)}</span>
                  </div>
                  {doubleOrNothing && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Lottery Stake (equal to invoice)</span>
                      <span className="text-gold">+{formatAmount(data.amount, data.tokenMint)}</span>
                    </div>
                  )}
                  <div className="border-t border-gold/20 pt-3 flex justify-between font-bold text-lg">
                    <span className="text-white">You Pay</span>
                    <span className="text-gold">{formatAmount(getPaymentAmount(), data.tokenMint)}</span>
                  </div>
                </div>

                {/* Win Info */}
                {doubleOrNothing && (
                  <div className="mt-4 text-center p-4 bg-lucky-green/10 border border-lucky-green/30 rounded-lg">
                    <p className="text-sm text-gray-400 mb-1">YOUR ODDS</p>
                    <p className="text-5xl font-bold text-lucky-green">50/50</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-lucky-green/10 rounded-lg p-2">
                        <span className="text-lucky-green font-bold">WIN</span>
                        <span className="text-gray-400"> = Full refund</span>
                      </div>
                      <div className="bg-lucky-red/10 rounded-lg p-2">
                        <span className="text-lucky-red font-bold">LOSE</span>
                        <span className="text-gray-400"> = Invoice paid</span>
                      </div>
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
                      doubleOrNothing
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
                    ) : doubleOrNothing ? (
                      <>DOUBLE OR NOTHING — {formatAmount(getPaymentAmount(), data.tokenMint)}</>
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
    </div>
  );
}
