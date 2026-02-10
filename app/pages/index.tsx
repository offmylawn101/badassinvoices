import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import toast from "react-hot-toast";
import { getInvoices, sendReminder, formatAmount, Invoice } from "@/lib/api";

export default function Dashboard() {
  const { publicKey, connected } = useWallet();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("all");

  useEffect(() => {
    if (connected && publicKey) {
      loadInvoices();
    }
  }, [connected, publicKey]);

  async function loadInvoices() {
    if (!publicKey) return;
    setLoading(true);
    try {
      const data = await getInvoices(publicKey.toString());
      setInvoices(data);
    } catch (error) {
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendReminder(id: string) {
    try {
      await sendReminder(id);
      toast.success("Reminder sent!");
      loadInvoices();
    } catch (error: any) {
      toast.error(error.message || "Failed to send reminder");
    }
  }

  const filteredInvoices = invoices.filter((inv) => {
    if (filter === "all") return true;
    return inv.status === filter;
  });

  const stats = {
    total: invoices.length,
    pending: invoices.filter((i) => i.status === "pending").length,
    paid: invoices.filter((i) => i.status === "paid").length,
    totalPending: invoices
      .filter((i) => i.status === "pending")
      .reduce((sum, i) => sum + i.amount, 0),
  };

  // Show landing page if not connected
  if (!connected) {
    return <LandingPage />;
  }

  // Show dashboard if connected
  return (
    <div className="min-h-screen bg-casino-black">
      {/* Header */}
      <header className="border-b border-gold/20 bg-casino-dark/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png?v=3" alt="BadassInvoices" className="w-10 h-10 rounded-xl" />
              <span className="text-xl font-bold text-white">BadassInvoices</span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/create"
                className="hidden sm:flex bg-gradient-to-r from-gold to-gold-dark text-casino-black px-5 py-2.5 rounded-xl font-bold hover:shadow-lg hover:shadow-gold/25 transition-all duration-300"
              >
                + New Invoice
              </Link>
              <WalletMultiButton />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Welcome Banner */}
        <div className="mb-8 bg-gradient-to-r from-gold/10 to-lucky-red/10 rounded-2xl p-6 border border-gold/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">Welcome back!</h1>
              <p className="text-gray-400">Your clients have a chance to win FREE invoices</p>
            </div>
            <Link
              href="/create"
              className="sm:hidden bg-gradient-to-r from-gold to-gold-dark text-casino-black px-5 py-2.5 rounded-xl font-bold"
            >
              + New Invoice
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Invoices"
            value={stats.total.toString()}
            icon="📄"
            color="gold"
          />
          <StatCard
            label="Pending"
            value={stats.pending.toString()}
            icon="⏳"
            color="yellow"
          />
          <StatCard
            label="Paid"
            value={stats.paid.toString()}
            icon="✓"
            color="green"
          />
          <StatCard
            label="Outstanding"
            value={formatAmount(stats.totalPending, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}
            icon="💰"
            color="gold"
          />
        </div>

        {/* Filters & Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex gap-2 bg-casino-dark rounded-xl p-1 border border-gold/10">
            {(["all", "pending", "paid"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 capitalize ${
                  filter === f
                    ? "bg-gold text-casino-black shadow-lg"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={loadInvoices}
            className="text-gray-400 hover:text-gold transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Invoice List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-10 h-10 border-4 border-gold border-t-transparent rounded-full"></div>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {filteredInvoices.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                onRemind={handleSendReminder}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-casino-black overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gold/5 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-lucky-red/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-gold/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png?v=3" alt="BadassInvoices" className="w-10 h-10 rounded-xl shadow-lg shadow-gold/20" />
              <span className="text-xl font-bold text-white">BadassInvoices</span>
            </div>
            <WalletMultiButton />
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 pt-12 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-2 mb-6">
                <span className="animate-pulse text-gold">●</span>
                <span className="text-gold text-sm font-medium">Live on Solana Mainnet</span>
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white mb-6 leading-tight">
                Every Invoice
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold via-yellow-500 to-gold">
                  Could Be FREE
                </span>
              </h1>

              <p className="text-xl text-gray-400 mb-8 max-w-lg mx-auto lg:mx-0">
                Create invoices. Your clients spin the wheel. They might pay nothing at all.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <WalletMultiButton />
                <a
                  href="#how-it-works"
                  className="px-8 py-3 rounded-xl font-bold border-2 border-gold/50 text-gold hover:bg-gold/10 transition-all duration-300 text-center"
                >
                  How It Works
                </a>
              </div>

              {/* Trust Stats */}
              <div className="flex items-center justify-center lg:justify-start gap-8 mt-12 pt-8 border-t border-gray-800">
                <div>
                  <p className="text-3xl font-bold text-white">$0</p>
                  <p className="text-sm text-gray-500">Processing Fees</p>
                </div>
                <div className="h-10 w-px bg-gray-800"></div>
                <div>
                  <p className="text-3xl font-bold text-white">&lt;1s</p>
                  <p className="text-sm text-gray-500">Settlement Time</p>
                </div>
                <div className="h-10 w-px bg-gray-800"></div>
                <div>
                  <p className="text-3xl font-bold text-white">50%</p>
                  <p className="text-sm text-gray-500">Max Win Chance</p>
                </div>
              </div>
            </div>

            {/* Right: Interactive Wheel Preview */}
            <div className="relative">
              <div className="relative w-80 h-80 mx-auto">
                {/* Glow */}
                <div className="absolute inset-0 bg-gradient-to-r from-gold/20 to-lucky-red/20 rounded-full blur-3xl animate-pulse"></div>

                {/* Decorative Ring */}
                <div className="absolute inset-4 rounded-full border-4 border-dashed border-gold/20 animate-spin" style={{ animationDuration: '20s' }}></div>

                {/* Main Wheel */}
                <div className="absolute inset-8 rounded-full bg-gradient-to-br from-casino-dark to-casino-black border-8 border-gold/50 shadow-2xl shadow-gold/20 overflow-hidden">
                  <svg viewBox="0 0 100 100" className="w-full h-full animate-spin" style={{ animationDuration: '10s' }}>
                    {[...Array(8)].map((_, i) => {
                      const isWin = i % 2 === 0;
                      const angle = i * 45;
                      const startRad = ((angle - 90) * Math.PI) / 180;
                      const endRad = ((angle + 45 - 90) * Math.PI) / 180;
                      const x1 = 50 + 50 * Math.cos(startRad);
                      const y1 = 50 + 50 * Math.sin(startRad);
                      const x2 = 50 + 50 * Math.cos(endRad);
                      const y2 = 50 + 50 * Math.sin(endRad);
                      return (
                        <path
                          key={i}
                          d={`M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`}
                          fill={isWin ? '#22C55E' : '#DC2626'}
                          opacity={0.8}
                        />
                      );
                    })}
                  </svg>
                </div>

                {/* Center */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center shadow-xl z-10">
                  <span className="text-casino-black font-black text-2xl">SPIN</span>
                </div>

                {/* Pointer */}
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-20">
                  <div className="w-0 h-0 border-l-[15px] border-r-[15px] border-t-[25px] border-l-transparent border-r-transparent border-t-gold drop-shadow-lg"></div>
                </div>
              </div>

              {/* Floating Labels */}
              <div className="absolute top-4 right-4 bg-lucky-green/20 border border-lucky-green/50 rounded-lg px-3 py-1 text-lucky-green text-sm font-bold animate-bounce">
                WIN = FREE!
              </div>
              <div className="absolute bottom-4 left-4 bg-lucky-red/20 border border-lucky-red/50 rounded-lg px-3 py-1 text-lucky-red text-sm font-bold animate-bounce" style={{ animationDelay: '0.5s' }}>
                LOSE = Paid
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="relative z-10 py-20 px-4 bg-gradient-to-b from-transparent to-casino-dark/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">How It Works</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Simple for you. Exciting for your clients.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              number="1"
              title="Create Invoice"
              description="Set the amount in USDC or SOL. Share the payment link with your client."
              icon="📝"
            />
            <StepCard
              number="2"
              title="Client Chooses Risk"
              description="They slide from 0-50% risk. Higher risk = bigger chance to pay nothing!"
              icon="🎚️"
            />
            <StepCard
              number="3"
              title="Spin & Settle"
              description="The wheel spins. WIN = Full refund. LOSE = Invoice paid. Either way, you get paid!"
              icon="🎰"
            />
          </div>
        </div>
      </section>

      {/* Example Section */}
      <section className="relative z-10 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-casino-dark to-casino-black rounded-3xl p-8 md:p-12 border border-gold/20 shadow-2xl">
            <h3 className="text-2xl font-bold text-white mb-8 text-center">
              Example: <span className="text-gold">$100</span> Invoice at <span className="text-gold">50%</span> Risk
            </h3>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-lucky-green/10 rounded-2xl p-6 border border-lucky-green/30 text-center">
                <div className="text-5xl mb-4">🎉</div>
                <h4 className="text-2xl font-bold text-lucky-green mb-2">WIN</h4>
                <p className="text-gray-400 mb-4">50% chance</p>
                <div className="bg-casino-black/50 rounded-xl p-4">
                  <p className="text-sm text-gray-400">Client pays $200</p>
                  <p className="text-sm text-gray-400">Gets $200 back</p>
                  <p className="text-xl font-bold text-lucky-green mt-2">= FREE Invoice!</p>
                </div>
              </div>

              <div className="bg-lucky-red/10 rounded-2xl p-6 border border-lucky-red/30 text-center">
                <div className="text-5xl mb-4">💀</div>
                <h4 className="text-2xl font-bold text-lucky-red mb-2">LOSE</h4>
                <p className="text-gray-400 mb-4">50% chance</p>
                <div className="bg-casino-black/50 rounded-xl p-4">
                  <p className="text-sm text-gray-400">Client pays $200</p>
                  <p className="text-sm text-gray-400">You receive $200</p>
                  <p className="text-xl font-bold text-gray-300 mt-2">Invoice Settled</p>
                </div>
              </div>
            </div>

            <p className="text-center text-gray-500 mt-8 text-sm">
              You always get paid. Your client gets the thrill of potentially paying nothing.
            </p>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative z-10 py-20 px-4 bg-gradient-to-b from-transparent to-casino-dark/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">Why BadassInvoices?</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              icon="⚡"
              title="Instant Settlement"
              description="Payments arrive in seconds via Solana"
            />
            <FeatureCard
              icon="🔒"
              title="Non-Custodial"
              description="Funds go directly to your wallet"
            />
            <FeatureCard
              icon="📱"
              title="QR Code Payments"
              description="Clients pay with a simple scan"
            />
            <FeatureCard
              icon="🎲"
              title="Provably Fair"
              description="Transparent on-chain randomness"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Ready to spin?
          </h2>
          <p className="text-xl text-gray-400 mb-8">
            Connect your wallet and create your first invoice in seconds.
          </p>
          <WalletMultiButton />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-800 py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center">
              <span className="text-casino-black font-black text-sm">$</span>
            </div>
            <span className="text-gray-400">BadassInvoices</span>
          </div>
          <p className="text-gray-600 text-sm">
            Built on Solana. Every invoice could be free.
          </p>
        </div>
      </footer>
    </div>
  );
}

function StepCard({ number, title, description, icon }: {
  number: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="relative bg-casino-dark/50 rounded-2xl p-6 border border-gold/10 hover:border-gold/30 transition-all duration-300 group">
      <div className="absolute -top-4 -left-4 w-10 h-10 rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center font-bold text-casino-black shadow-lg">
        {number}
      </div>
      <div className="text-4xl mb-4 mt-2">{icon}</div>
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-casino-dark/30 rounded-2xl p-6 border border-gold/10 hover:border-gold/30 hover:bg-casino-dark/50 transition-all duration-300 text-center group">
      <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">{icon}</div>
      <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

function StatCard({ label, value, icon, color }: {
  label: string;
  value: string;
  icon: string;
  color: 'gold' | 'yellow' | 'green';
}) {
  const colors = {
    gold: 'text-gold',
    yellow: 'text-yellow-500',
    green: 'text-lucky-green',
  };

  return (
    <div className="bg-casino-dark rounded-2xl p-5 border border-gold/10 hover:border-gold/30 transition-all duration-300">
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className={`text-2xl sm:text-3xl font-bold ${colors[color]} mb-1`}>{value}</p>
      <p className="text-gray-500 text-sm">{label}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-casino-dark/50 rounded-2xl p-12 text-center border border-dashed border-gold/20">
      <div className="text-6xl mb-4">📄</div>
      <h3 className="text-xl font-bold text-white mb-2">No invoices yet</h3>
      <p className="text-gray-400 mb-6">Create your first invoice and give your client a chance to win!</p>
      <Link
        href="/create"
        className="inline-flex bg-gradient-to-r from-gold to-gold-dark text-casino-black px-6 py-3 rounded-xl font-bold hover:shadow-lg hover:shadow-gold/25 transition-all duration-300"
      >
        Create Invoice
      </Link>
    </div>
  );
}

function InvoiceRow({ invoice, onRemind }: { invoice: Invoice; onRemind: (id: string) => void }) {
  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${invoice.id}`);
    toast.success("Link copied!");
  };

  return (
    <div className="bg-casino-dark rounded-xl p-4 sm:p-5 border border-gold/10 hover:border-gold/30 transition-all duration-300 group">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Invoice Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <StatusBadge status={invoice.status} />
            <span className="text-gray-500 text-sm truncate">
              {invoice.id.slice(0, 8)}...
            </span>
          </div>
          <p className="text-white font-medium truncate">
            {invoice.memo || "No description"}
          </p>
          <p className="text-gray-500 text-sm">
            {invoice.client_email || "No email"} · Due {new Date(invoice.due_date * 1000).toLocaleDateString()}
          </p>
        </div>

        {/* Right: Amount & Actions */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xl font-bold text-gold">
              {formatAmount(invoice.amount, invoice.token_mint)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="p-2 rounded-lg bg-casino-black/50 text-gray-400 hover:text-gold hover:bg-gold/10 transition-all"
              title="Copy payment link"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            </button>

            {invoice.status === "pending" && invoice.client_email && (
              <button
                onClick={() => onRemind(invoice.id)}
                className="p-2 rounded-lg bg-casino-black/50 text-gray-400 hover:text-lucky-red hover:bg-lucky-red/10 transition-all"
                title="Send reminder"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-500', label: 'Pending' },
    paid: { bg: 'bg-lucky-green/20', text: 'text-lucky-green', label: 'Paid' },
    cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Cancelled' },
    escrow_funded: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Escrow' },
  };

  const { bg, text, label } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
      {label}
    </span>
  );
}
