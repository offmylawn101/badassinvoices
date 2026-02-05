import "@/styles/globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import type { AppProps } from "next/app";
import { useMemo } from "react";
import Head from "next/head";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { Toaster } from "react-hot-toast";

export default function App({ Component, pageProps }: AppProps) {
  const endpoint = useMemo(
    () => process.env.SOLANA_RPC || clusterApiUrl("devnet"),
    []
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <>
      <Head>
        <title>InvoiceNow - Instant Invoicing on Solana</title>
        <meta name="description" content="Create invoices and get paid instantly in USDC or SOL. No more waiting 30-60 days for payment." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta property="og:title" content="InvoiceNow - Instant Invoicing on Solana" />
        <meta property="og:description" content="Create invoices and get paid instantly in USDC or SOL. No more waiting 30-60 days for payment." />
        <meta property="og:image" content="/og-image.png" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="InvoiceNow - Instant Invoicing on Solana" />
        <meta name="twitter:description" content="Create invoices and get paid instantly in USDC or SOL." />
        <meta name="twitter:image" content="/og-image.png" />
      </Head>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <Toaster position="bottom-right" />
            <Component {...pageProps} />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </>
  );
}
