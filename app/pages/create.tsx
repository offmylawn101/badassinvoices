import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/router";
import Link from "next/link";
import toast from "react-hot-toast";
import { createInvoice, Milestone } from "@/lib/api";

const TOKENS = [
  {
    name: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    symbol: "$",
  },
  {
    name: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    symbol: "",
  },
];

export default function CreateInvoice() {
  const { publicKey, connected } = useWallet();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);
  const [form, setForm] = useState({
    clientEmail: "",
    amount: "",
    token: TOKENS[0],
    dueDate: "",
    memo: "",
  });
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [newInvoice, setNewInvoice] = useState<{
    id: string;
    paymentLink: string;
  } | null>(null);

  function addMilestone() {
    setMilestones([...milestones, { description: "", amount: 0 }]);
  }

  function updateMilestone(index: number, field: string, value: string | number) {
    const updated = [...milestones];
    updated[index] = { ...updated[index], [field]: value };
    setMilestones(updated);
  }

  function removeMilestone(index: number) {
    setMilestones(milestones.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!publicKey) {
      toast.error("Please connect your wallet");
      return;
    }

    if (!form.amount || !form.dueDate) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);

    try {
      // Convert amount to smallest unit
      const amountDecimal = parseFloat(form.amount);
      const amount = Math.round(amountDecimal * Math.pow(10, form.token.decimals));

      // Convert date to timestamp
      const dueDate = Math.floor(new Date(form.dueDate).getTime() / 1000);

      // Convert milestone amounts
      const processedMilestones = showMilestones
        ? milestones.map((m) => ({
            ...m,
            amount: Math.round(m.amount * Math.pow(10, form.token.decimals)),
          }))
        : undefined;

      const invoice = await createInvoice({
        creatorWallet: publicKey.toString(),
        clientEmail: form.clientEmail || undefined,
        amount,
        tokenMint: form.token.mint,
        dueDate,
        memo: form.memo || undefined,
        milestones: processedMilestones,
      });

      setNewInvoice({
        id: invoice.id,
        paymentLink: `${window.location.origin}/pay/${invoice.id}`,
      });

      toast.success("Invoice created!");
    } catch (error: any) {
      toast.error(error.message || "Failed to create invoice");
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-casino-black">
        <header className="gradient-bg border-b border-gold/20">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3">
                <img src="/logo.png?v=3" alt="BadassInvoices" className="w-10 h-10 rounded-lg" />
                <span className="text-2xl font-bold text-gold">BadassInvoices</span>
              </Link>
              <WalletMultiButton />
            </div>
          </div>
        </header>
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">Connect your wallet to create an invoice</p>
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  if (newInvoice) {
    return (
      <div className="min-h-screen bg-casino-black">
        <header className="gradient-bg border-b border-gold/20">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3">
                <img src="/logo.png?v=3" alt="BadassInvoices" className="w-10 h-10 rounded-lg" />
                <span className="text-2xl font-bold text-gold">BadassInvoices</span>
              </Link>
              <WalletMultiButton />
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-12">
          <div className="bg-casino-dark rounded-xl p-8 shadow-lg text-center border border-gold/20">
            <div className="w-16 h-16 bg-lucky-green/20 border border-lucky-green rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl text-lucky-green">&#10003;</span>
            </div>
            <h1 className="text-2xl font-bold mb-2 text-gold">Invoice Created!</h1>
            <p className="text-gray-400 mb-2">
              Share the payment link with your client
            </p>
            <p className="text-lucky-green text-sm mb-6 font-medium">
              Your client can SPIN TO WIN when they pay!
            </p>

            <div className="bg-casino-black/50 rounded-lg p-4 mb-6 border border-gold/20">
              <p className="text-sm text-gray-500 mb-1">Invoice ID</p>
              <p className="font-mono font-medium text-gold">{newInvoice.id}</p>
            </div>

            <div className="bg-casino-black/50 rounded-lg p-4 mb-6 border border-gold/20">
              <p className="text-sm text-gray-500 mb-1">Payment Link</p>
              <p className="font-mono text-sm break-all text-gray-300">{newInvoice.paymentLink}</p>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newInvoice.paymentLink);
                  toast.success("Link copied!");
                }}
                className="bg-gradient-to-r from-gold to-gold-dark text-casino-black px-6 py-2 rounded-lg font-bold hover:from-gold-dark hover:to-gold transition"
              >
                Copy Link
              </button>
              <Link
                href="/"
                className="border border-gold/30 text-gray-300 px-6 py-2 rounded-lg hover:bg-gold/10 transition"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-casino-black">
      <header className="gradient-bg border-b border-gold/20">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold text-gold">
              BadassInvoices
            </Link>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-casino-dark rounded-xl p-8 shadow-lg border border-gold/20">
          <h1 className="text-2xl font-bold mb-6 text-gold">Create Invoice</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Client Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Client Email (optional)
              </label>
              <input
                type="email"
                value={form.clientEmail}
                onChange={(e) =>
                  setForm({ ...form, clientEmail: e.target.value })
                }
                placeholder="client@example.com"
                className="w-full px-4 py-2 bg-casino-black border border-gold/30 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-gold focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                We'll send payment reminders to this email
              </p>
            </div>

            {/* Amount & Token */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Amount *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">
                    {form.token.symbol}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                    className={`w-full px-4 py-2 bg-casino-black border border-gold/30 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-gold focus:border-transparent ${
                      form.token.symbol ? "pl-6" : ""
                    }`}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Currency
                </label>
                <select
                  value={form.token.mint}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      token: TOKENS.find((t) => t.mint === e.target.value)!,
                    })
                  }
                  className="w-full px-4 py-2 bg-casino-black border border-gold/30 rounded-lg text-white focus:ring-2 focus:ring-gold focus:border-transparent"
                >
                  {TOKENS.map((token) => (
                    <option key={token.mint} value={token.mint}>
                      {token.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Due Date *
              </label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                min={new Date().toISOString().split("T")[0]}
                className="w-full px-4 py-2 bg-casino-black border border-gold/30 rounded-lg text-white focus:ring-2 focus:ring-gold focus:border-transparent"
                required
              />
            </div>

            {/* Memo */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
                placeholder="Website development - Phase 1"
                rows={3}
                className="w-full px-4 py-2 bg-casino-black border border-gold/30 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-gold focus:border-transparent"
              />
            </div>

            {/* Milestones Toggle */}
            <div className="border-t border-gray-700 pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMilestones}
                  onChange={(e) => setShowMilestones(e.target.checked)}
                  className="w-4 h-4 text-gold rounded border-gold/30 bg-casino-black focus:ring-gold"
                />
                <span className="font-medium text-gray-300">Split into milestones (escrow)</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Client funds escrow upfront, you get paid as milestones complete
              </p>
            </div>

            {/* Milestones */}
            {showMilestones && (
              <div className="space-y-4 bg-casino-black/50 p-4 rounded-lg border border-gold/20">
                {milestones.map((milestone, index) => (
                  <div key={index} className="flex gap-4 items-start">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={milestone.description}
                        onChange={(e) =>
                          updateMilestone(index, "description", e.target.value)
                        }
                        placeholder="Milestone description"
                        className="w-full px-3 py-2 bg-casino-black border border-gold/30 rounded-lg text-sm text-white placeholder-gray-500"
                      />
                    </div>
                    <div className="w-32">
                      <input
                        type="number"
                        step="0.01"
                        value={milestone.amount || ""}
                        onChange={(e) =>
                          updateMilestone(
                            index,
                            "amount",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        placeholder="Amount"
                        className="w-full px-3 py-2 bg-casino-black border border-gold/30 rounded-lg text-sm text-white placeholder-gray-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMilestone(index)}
                      className="text-lucky-red hover:text-red-400 p-2"
                    >
                      x
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addMilestone}
                  className="text-gold hover:underline text-sm"
                >
                  + Add Milestone
                </button>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-gold to-gold-dark text-casino-black py-3 rounded-lg font-bold hover:from-gold-dark hover:to-gold transition disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Invoice"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
