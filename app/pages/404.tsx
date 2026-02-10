import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-casino-black flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-8xl font-black text-gold mb-4">404</div>
        <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-gray-400 mb-8">This page doesn't exist or has been removed.</p>
        <Link
          href="/"
          className="inline-flex bg-gradient-to-r from-gold to-gold-dark text-casino-black px-6 py-3 rounded-xl font-bold hover:shadow-lg hover:shadow-gold/25 transition-all duration-300"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
