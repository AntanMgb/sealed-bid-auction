"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { createAuction, delegateAuction, getAuctionPda, getProgram } from "@/lib/program";
import { getDevnetConnection } from "@/lib/magicblock";

interface Props {
  onCreated: (auctionPda: string) => void;
}

const AUCTION_TYPES = [
  { id: "nft", icon: "🎨", label: "NFT", desc: "Auction a single NFT" },
  { id: "token", icon: "🪙", label: "Token Sale", desc: "Fair price discovery" },
  { id: "governance", icon: "🏛️", label: "Governance Seat", desc: "DAO seat auction" },
] as const;

export const CreateAuction: FC<Props> = ({ onCreated }) => {
  const { publicKey, signTransaction } = useWallet();

  const [title, setTitle] = useState("");
  const [reserve, setReserve] = useState("0.1");
  const [duration, setDuration] = useState("300");
  const [auctionType, setAuctionType] = useState<string>("nft");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "creating" | "delegating" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [auctionPda, setAuctionPda] = useState<string | null>(null);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleCreate() {
    if (!publicKey || !signTransaction) return;
    setError(null);

    const reserveNum = parseFloat(reserve);
    if (isNaN(reserveNum) || reserveNum <= 0) {
      setError("Enter a valid reserve price");
      return;
    }

    try {
      const devnetConnection = getDevnetConnection();
      const provider = new AnchorProvider(
        devnetConnection,
        { publicKey, signTransaction, signAllTransactions: async (t) => t },
        { commitment: "confirmed" }
      );
      const program = getProgram(provider);
      const auctionId = new BN(Date.now());
      const reserveLamports = new BN(Math.floor(reserveNum * 1e9));
      const durationSec = new BN(parseInt(duration));

      // Step 1: Create on L1
      setStep("creating");
      await createAuction(program, publicKey, auctionId, reserveLamports, durationSec, title);

      const pda = getAuctionPda(publicKey, auctionId);

      // Step 2: Delegate to TEE (Private ER)
      setStep("delegating");
      await delegateAuction(program, publicKey, pda, auctionId);

      const pdaStr = pda.toBase58();
      // Save image and auction type to localStorage for the auction room
      if (imagePreview) {
        try { localStorage.setItem(`auction-image-${pdaStr}`, imagePreview); } catch {}
      }
      try { localStorage.setItem(`auction-type-${pdaStr}`, auctionType); } catch {}

      setAuctionPda(pdaStr);
      setStep("done");
      onCreated(pdaStr);
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
        {/* Auction Type Selector */}
        <div>
          <label className="text-xs text-gray-400 block mb-2">Auction Type</label>
          <div className="grid grid-cols-3 gap-2">
            {AUCTION_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setAuctionType(t.id)}
                className={`p-3 rounded-lg border text-center transition-all ${
                  auctionType === t.id
                    ? "bg-teal-900/30 border-teal-600 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                <div className="text-xl mb-1">{t.icon}</div>
                <div className="text-xs font-semibold">{t.label}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              auctionType === "nft"
                ? "e.g. Rare NFT Drop #001"
                : auctionType === "token"
                  ? "e.g. TOKEN Fair Launch"
                  : "e.g. DAO Council Seat #3"
            }
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
          />
        </div>

        {/* NFT Image Upload */}
        {auctionType === "nft" && (
          <div>
            <label className="text-xs text-gray-400 block mb-1">NFT Image</label>
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="NFT preview"
                  className="w-full aspect-square object-contain bg-gray-800 rounded-lg border border-gray-600"
                />
                <button
                  onClick={() => setImagePreview(null)}
                  className="absolute top-2 right-2 bg-gray-900/80 text-gray-300 hover:text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-32 bg-gray-800 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:border-teal-500 transition-colors">
                <span className="text-2xl mb-1">🖼️</span>
                <span className="text-xs text-gray-400">Click to upload image</span>
                <span className="text-[10px] text-gray-600 mt-0.5">PNG, JPG, GIF (max 2MB)</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Reserve Price (SOL)</label>
            <input
              type="text"
              inputMode="decimal"
              value={reserve}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                if (/^\d*\.?\d*$/.test(v)) setReserve(v);
              }}
              placeholder="0.1"
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
