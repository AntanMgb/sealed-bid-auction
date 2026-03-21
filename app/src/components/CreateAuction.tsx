"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { createAuction, delegateAuction, getAuctionPda, getProgram } from "@/lib/program";
import { getDevnetConnection } from "@/lib/magicblock";

interface Props {
  onCreated: (auctionPda: string) => void;
}

export const CreateAuction: FC<Props> = ({ onCreated }) => {
  const { publicKey, signTransaction } = useWallet();

  const [title, setTitle] = useState("");
  const [reserve, setReserve] = useState("0.1");
  const [duration, setDuration] = useState("300"); // seconds
  const [step, setStep] = useState<"idle" | "creating" | "delegating" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [auctionPda, setAuctionPda] = useState<string | null>(null);

  async function handleCreate() {
    if (!publicKey || !signTransaction) return;
    setError(null);

    try {
      const devnetConnection = getDevnetConnection();
      const provider = new AnchorProvider(
        devnetConnection,
        { publicKey, signTransaction, signAllTransactions: async (t) => t },
        { commitment: "confirmed" }
      );
      const program = getProgram(provider);
      const auctionId = new BN(Date.now());
      const reserveLamports = new BN(Math.floor(parseFloat(reserve) * 1e9));
      const durationSec = new BN(parseInt(duration));

      // Step 1: Create on L1
      setStep("creating");
      await createAuction(program, publicKey, auctionId, reserveLamports, durationSec, title);

      const pda = getAuctionPda(publicKey, auctionId);

      // Step 2: Delegate to TEE (Private ER)
      setStep("delegating");
      await delegateAuction(program, publicKey, pda, auctionId);

      setAuctionPda(pda.toBase58());
      setStep("done");
      onCreated(pda.toBase58());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
      setStep("error");
    }
  }

  if (step === "done") {
    return (
      <div className="bg-gray-900 rounded-xl border border-teal-700 p-5">
        <div className="text-2xl mb-2 text-center">🔐</div>
        <div className="text-center text-teal-400 font-bold">Auction live in TEE</div>
        <div className="mt-2 text-xs text-gray-500 text-center break-all">{auctionPda}</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Create Auction</h2>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Rare NFT Drop #001"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Reserve Price (SOL)</label>
            <input
              type="number"
              step="0.01"
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Duration (seconds)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
            />
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-xs bg-red-900/20 border border-red-700/50 rounded p-2">
            {error}
          </div>
        )}

        {(step === "creating" || step === "delegating") && (
          <div className="text-xs text-gray-400 space-y-1">
            <div className={`flex items-center gap-2 ${step === "creating" ? "text-yellow-400" : "text-green-400"}`}>
              <span>{step === "creating" ? "⏳" : "✅"}</span>
              Creating auction on Solana L1...
            </div>
            <div className={`flex items-center gap-2 ${step === "delegating" ? "text-yellow-400" : "text-gray-600"}`}>
              <span>{step === "delegating" ? "⏳" : "○"}</span>
              Delegating to Private ER (Intel TDX)...
            </div>
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!publicKey || !title || step === "creating" || step === "delegating"}
          className="w-full py-2.5 rounded-lg font-semibold text-sm bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {step === "creating" ? "Creating..." : step === "delegating" ? "Delegating to TEE..." : "Create & Move to TEE"}
        </button>
      </div>
    </div>
  );
};
