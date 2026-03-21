import type { Metadata } from "next";
import "./globals.css";
import { AppWalletProvider } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "Sealed-Bid Auction | MagicBlock Private ER",
  description:
    "Trustless sealed-bid auction powered by MagicBlock Private Ephemeral Rollups (Intel TDX). Bids stay hidden until the TEE reveals the winner.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        <AppWalletProvider>{children}</AppWalletProvider>
      </body>
    </html>
  );
}
