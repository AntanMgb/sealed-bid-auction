import type { Metadata } from "next";
import "./globals.css";
import { AppWalletProvider } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "Magic Auction | Sealed-Bid Auctions on Solana",
  description:
    "Trustless sealed-bid auctions powered by MagicBlock Private Ephemeral Rollups (Intel TDX). Bids stay hidden until the TEE reveals the winner.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased" style={{ background: "#050508" }}>
        <div className="aurora-bg">
          <div className="aurora-blob-1" />
          <div className="aurora-blob-2" />
        </div>
        <div className="relative z-[1]">
          <AppWalletProvider>{children}</AppWalletProvider>
        </div>
      </body>
    </html>
  );
}
