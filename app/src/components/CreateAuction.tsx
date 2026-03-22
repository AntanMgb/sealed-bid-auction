"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createAuction, delegateAuction, getAuctionPda, getProgram } from "@/lib/program";
import { getDevnetConnection, getTeeValidatorIdentity } from "@/lib/magicblock";

interface Props {
  onCreated: (auctionPda: string, title: string) => void;
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

      // Step 2: Delegate to TEE (Private ER) using the real validator identity
      setStep("delegating");
      const teeValidatorStr = await getTeeValidatorIdentity();
      const teeValidator = teeValidatorStr ? new PublicKey(teeValidatorStr) : undefined;
      console.log("[TEE] Delegating auction to validator:", teeValidatorStr);
      await delegateAuction(program, publicKey, pda, auctionId, teeValidator);

      const pdaStr = pda.toBase58();
      if (imagePreview) {
        try { localStorage.setItem(`auction-image-${pdaStr}`, imagePreview); } catch {}
      }
      try { localStorage.setItem(`auction-type-${pdaStr}`, auctionType); } catch {}

      setAuctionPda(pdaStr);
      setStep("done");
      onCreated(pdaStr, title);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
      setStep("error");
    }
  }

  if (step === "done") {
    return (
      <div className="card p-6 glow" style={{ borderColor: "rgba(136,51,255,0.4)" }}>
        <div className="text-3xl mb-2 text-center">🔐</div>
        <div className="text-center font-bold text-lg" style={{ color: "var(--accent-violet)" }}>Auction live in TEE</div>
        <div className="mt-2 text-xs text-center break-all mono" style={{ color: "var(--text-dim)" }}>{auctionPda}</div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-bold text-white mb-5" style={{ fontFamily: "'Unbounded', sans-serif" }}>Create Auction</h2>

      <div className="space-y-4">
        {/* Auction Type Selector */}
        <div>
          <label className="text-xs block mb-2" style={{ color: "var(--text-dim)" }}>Auction Type</label>
          <div className="grid grid-cols-3 gap-2">
            {AUCTION_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setAuctionType(t.id)}
                className="p-3 rounded-xl text-center transition-all"
                style={{
                  background: auctionType === t.id ? "rgba(136,51,255,0.15)" : "var(--surface-hover)",
                  border: auctionType === t.id ? "1px solid rgba(136,51,255,0.4)" : "1px solid var(--border)",
                  color: auctionType === t.id ? "white" : "var(--text-dim)",
                }}
              >
                <div className="text-xl mb-1">{t.icon}</div>
                <div className="text-xs font-semibold">{t.label}</div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: "var(--text-dim)" }}>Title</label>
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
            className="input"
          />
        </div>

        {/* NFT Image Upload */}
        {auctionType === "nft" && (
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-dim)" }}>NFT Image</label>
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="NFT preview"
                  className="w-full aspect-square object-contain rounded-xl"
                  style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}
                />
                <button
                  onClick={() => setImagePreview(null)}
                  className="absolute top-2 right-2 rounded-full w-7 h-7 flex items-center justify-center text-xs transition-opacity hover:opacity-100"
                  style={{ background: "rgba(0,0,0,0.7)", color: "var(--text-mid)", border: "1px solid var(--border)" }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <label
                className="flex flex-col items-center justify-center w-full h-32 rounded-xl cursor-pointer transition-all"
                style={{ background: "var(--surface-hover)", border: "2px dashed var(--border)" }}
              >
                <span className="text-2xl mb-1">🖼️</span>
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>Click to upload image</span>
                <span className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>PNG, JPG, GIF (max 2MB)</span>
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
            <label className="text-xs block mb-1" style={{ color: "var(--text-dim)" }}>Reserve Price (SOL)</label>
            <input
              type="text"
              inputMode="decimal"
              value={reserve}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                if (/^\d*\.?\d*$/.test(v)) setReserve(v);
              }}
              placeholder="0.1"
              className="input"
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-dim)" }}>Duration (seconds)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="input"
            />
          </div>
        </div>

        {error && (
          <div className="text-xs rounded-lg p-3" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
            {error}
          </div>
        )}

        {(step === "creating" || step === "delegating") && (
          <div className="text-xs space-y-2">
            <div className="flex items-center gap-2" style={{ color: step === "creating" ? "var(--accent-amber)" : "#4ade80" }}>
              <span>{step === "creating" ? "⏳" : "✅"}</span>
              Creating auction on Solana L1...
            </div>
            <div className="flex items-center gap-2" style={{ color: step === "delegating" ? "var(--accent-amber)" : "var(--text-dim)" }}>
              <span>{step === "delegating" ? "⏳" : "○"}</span>
              Delegating to Private ER (Intel TDX)...
            </div>
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!publicKey || !title || step === "creating" || step === "delegating"}
          className="btn-accent w-full disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {step === "creating" ? "Creating..." : step === "delegating" ? "Delegating to TEE..." : "Create & Move to TEE"}
        </button>
      </div>
    </div>
  );
};
