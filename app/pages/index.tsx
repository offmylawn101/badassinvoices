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

      <main className="max-w-7xl mx-auto px-4 py-8">
        {!connected ? (
          <div className="text-center py-20">
            <h2 className="text-3xl font-bold gradient-text mb-4">
              Instant Invoicing on Solana
            </h2>
            <p className="text-gray-600 mb-8 max-w-md mx-auto">
              Create professional invoices and get paid instantly in USDC or SOL.
              No more waiting 30-60 days for payment.
            </p>
            <WalletMultiButton />
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-gray-500 text-sm">Total Invoices</p>
                <p className="text-3xl font-bold">{stats.total}</p>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-gray-500 text-sm">Pending</p>
                <p className="text-3xl font-bold text-yellow-600">
                  {stats.pending}
                </p>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-gray-500 text-sm">Paid</p>
                <p className="text-3xl font-bold text-green-600">{stats.paid}</p>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-gray-500 text-sm">Outstanding</p>
                <p className="text-3xl font-bold text-solana-purple">
                  {formatAmount(
                    stats.totalPending,
                    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                  )}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-2">
                <button
                  onClick={() => setFilter("all")}
                  className={`px-4 py-2 rounded-lg ${
                    filter === "all"
                      ? "bg-solana-purple text-white"
                      : "bg-white text-gray-700"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter("pending")}
                  className={`px-4 py-2 rounded-lg ${
                    filter === "pending"
                      ? "bg-solana-purple text-white"
                      : "bg-white text-gray-700"
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setFilter("paid")}
                  className={`px-4 py-2 rounded-lg ${
                    filter === "paid"
                      ? "bg-solana-purple text-white"
                      : "bg-white text-gray-700"
                  }`}
                >
                  Paid
                </button>
              </div>

              <Link
                href="/create"
                className="bg-solana-purple text-white px-6 py-2 rounded-lg hover:bg-purple-600 transition"
              >
                + New Invoice
              </Link>
            </div>

            {/* Invoice List */}
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-solana-purple border-t-transparent rounded-full mx-auto"></div>
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <p className="text-gray-500 mb-4">No invoices yet</p>
                <Link
                  href="/create"
                  className="text-solana-purple hover:underline"
                >
                  Create your first invoice
                </Link>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Invoice
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Client
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Due Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredInvoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium">{invoice.id}</p>
                            <p className="text-sm text-gray-500">
                              {invoice.memo || "No description"}
                            </p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm">
                            {invoice.client_email || "No email"}
                          </p>
                        </td>
                        <td className="px-6 py-4 font-medium">
                          {formatAmount(invoice.amount, invoice.token_mint)}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {new Date(invoice.due_date * 1000).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={invoice.status} />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  `${window.location.origin}/pay/${invoice.id}`
                                )
                              }
                              className="text-sm text-solana-purple hover:underline"
                            >
                              Copy Link
                            </button>
                            {invoice.status === "pending" &&
                              invoice.client_email && (
                                <button
                                  onClick={() => handleSendReminder(invoice.id)}
                                  className="text-sm text-orange-500 hover:underline"
                                >
                                  Remind
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    paid: "bg-green-100 text-green-800",
    cancelled: "bg-gray-100 text-gray-800",
    escrow_funded: "bg-blue-100 text-blue-800",
  };

  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${
        styles[status] || styles.pending
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
