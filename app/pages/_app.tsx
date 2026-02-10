import "@/styles/globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import type { AppProps } from "next/app";
import { useMemo, useState, useEffect } from "react";
import Head from "next/head";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Toaster } from "react-hot-toast";

export default function App({ Component, pageProps }: AppProps) {
  const [mounted, setMounted] = useState(false);

  // Use local proxy to avoid RPC blocking issues from browsers/ad blockers
  const endpoint = useMemo(() => {
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol;
      const host = window.location.host;
      return `${protocol}//${host}/api/rpc`;
    }
    return clusterApiUrl("mainnet-beta");
  }, []);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter()],
    []
  );

  // Only render wallet UI after mounting to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <Head>
        <title>BadassInvoices - Every Invoice Could Be FREE</title>
        <meta name="description" content="The boldest way to get paid. Your clients spin the wheel for a chance at a FREE invoice. Instant Solana payments." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.png?v=4" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta property="og:title" content="BadassInvoices - Every Invoice Could Be FREE" />
        <meta property="og:description" content="The boldest way to get paid. Your clients spin the wheel for a chance at a FREE invoice. Instant Solana payments." />
        <meta property="og:image" content="https://invoice.offmylawn.xyz/og-image.png" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="BadassInvoices - Every Invoice Could Be FREE" />
        <meta name="twitter:description" content="The boldest way to get paid. Spin the wheel on Solana." />
        <meta name="twitter:image" content="https://invoice.offmylawn.xyz/og-image.png" />
      </Head>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <Toaster position="bottom-right" />
            {mounted ? <Component {...pageProps} /> : <div className="min-h-screen bg-casino-black" />}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </>
  );
}
