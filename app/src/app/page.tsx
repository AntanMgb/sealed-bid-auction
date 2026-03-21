"use client";

import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { CreateAuction } from "@/components/CreateAuction";
import { AuctionRoom } from "@/components/AuctionRoom";

export default function Home() {
  const { connected } = useWallet();
  const [auctionPda, setAuctionPda] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [activeView, setActiveView] = useState<"create" | "join">("create");

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔒</span>
            <div>
              <div className="font-bold text-white">Sealed-Bid Auction</div>
              <div className="text-[10px] text-gray-500">
                Powered by MagicBlock Private ER (Intel TDX)
              </div>
            </div>
          </div>
          <WalletMultiButton />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        {!auctionPda && (
          <div className="text-center mb-10">
            <h1 className="text-4xl font-extrabold text-white mb-3">
              Trustless Sealed-Bid Auction
            </h1>
            <p className="text-gray-400 max-w-2xl mx-auto text-lg">
              All bids stay hidden until the auction closes.{" "}
              <strong className="text-white">
                Winner computed in Intel TDX enclave
              </strong>
              , committed onchain with a verifiable attestation.
              <br />
              No floor manipulation. No sniping. No insider info.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {[
                { icon: "🔒", label: "Bids sealed in TEE" },
                { icon: "⚡", label: "Real-time via MagicBlock ER" },
                { icon: "✅", label: "Verifiable TEE attestation" },
                { icon: "🛡️", label: "Intel TDX hardware privacy" },
                { icon: "🔗", label: "Committed to Solana L1" },
              ].map((f) => (
                <span
                  key={f.label}
                  className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-full text-sm text-gray-300"
                >
                  <span>{f.icon}</span>
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {!connected ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <span className="text-5xl">🔐</span>
            <p className="text-gray-400 text-lg">Connect your wallet to start</p>
            <WalletMultiButton />
          </div>
        ) : auctionPda ? (
          <AuctionRoom auctionPdaStr={auctionPda} />
        ) : (
          <div className="max-w-xl mx-auto">
            {/* Tab switcher */}
            <div className="flex bg-gray-800 rounded-xl p-1 mb-5">
              {(["create", "join"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setActiveView(v)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === v
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {v === "create" ? "Create Auction" : "Join Auction"}
                </button>
              ))}
            </div>

            {activeView === "create" ? (
              <CreateAuction onCreated={setAuctionPda} />
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
                <h2 className="text-lg font-semibold text-white mb-4">
                  Join Existing Auction
                </h2>
                <label className="text-xs text-gray-400 block mb-1">
                  Auction PDA address
                </label>
                <input
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="Enter auction PDA..."
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-teal-500 mb-3"
                />
                <button
                  onClick={() => joinInput && setAuctionPda(joinInput)}
                  disabled={!joinInput}
                  className="w-full py-2.5 rounded-lg font-semibold text-sm bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 transition-all"
                >
                  View Auction
                </button>
              </div>
            )}

            {/* Architecture diagram */}
            <div className="mt-6 bg-gray-900 rounded-xl border border-gray-700 p-5">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                How it works
              </div>
              <div className="space-y-2.5 text-sm">
                {[
                  {
                    layer: "L1",
                    color: "bg-blue-600",
                    step: "Seller creates auction + delegates to TEE",
                  },
                  {
                    layer: "TEE",
                    color: "bg-teal-600",
                    step: "Bidders submit sealed bids (amounts hidden in Intel TDX)",
                  },
                  {
                    layer: "TEE",
                    color: "bg-teal-600",
                    step: "Winner computed inside enclave — zero info leak",
                  },
                  {
                    layer: "L1",
                    color: "bg-blue-600",
                    step: "Result committed with TEE attestation — anyone can verify",
                  },
                  {
                    layer: "L1",
                    color: "bg-purple-600",
                    step: "Winner pays and claims the item",
                  },
                ].map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className={`${s.color} text-white text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0`}
                    >
                      {s.layer}
                    </span>
                    <span className="text-gray-300">{s.step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
