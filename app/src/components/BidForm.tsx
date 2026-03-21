"use client";

import { FC, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  createBidPermission,
  placeBid,
  getAuctionPda,
  getProgram,
} from "@/lib/program";
import { createTeeSession } from "@/lib/magicblock";
import { AuctionState } from "@/lib/program";

interface Props {
  auctionPda: PublicKey;
  auction: AuctionState;
  onBidPlaced: () => void;
}

/**
 * Two-step bid form:
 *   Step 1: Create Permission Group on L1 (sets up privacy for the bid)
 *   Step 2: Place the sealed bid on the Private Ephemeral Rollup (TEE)
 *
 * The bid amount NEVER touches L1 or the public Solana state.
 * It is sent directly to the TEE endpoint and stored in a permission-gated PDA.
 */
export const BidForm: FC<Props> = ({ auctionPda, auction, onBidPlaced }) => {
  const { publicKey, signMessage, signTransaction, sendTransaction } =
    useWallet();
  const { connection } = useConnection();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<
    "idle" | "permission" | "bidding" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const reserveSol = auction.reservePrice.toNumber() / 1e9;

  async function handleBid() {
    if (!publicKey || !signMessage || !signTransaction) return;
    setError(null);

    const amountLamports = Math.floor(parseFloat(amount) * 1e9);
    if (isNaN(amountLamports) || amountLamports <= 0) {
      setError("Enter a valid SOL amount");
      return;
    }
    if (amountLamports < auction.reservePrice.toNumber()) {
      setError(`Minimum bid is ${reserveSol} SOL (reserve price)`);
      return;
    }

    try {
      // ── Step 1: Create Permission Group on L1 ─────────────────────────────
      // This registers the bidder as the sole authorized reader of their
      // future Bid PDA on PER. Must happen on L1 first.
      setStep("permission");

      const l1Provider = new AnchorProvider(
        connection,
        { publicKey, signTransaction, signAllTransactions: async (txs) => txs },
        { commitment: "confirmed" }
      );
      const l1Program = getProgram(l1Provider);

      await createBidPermission(l1Program, publicKey, auctionPda, {
        seller: auction.seller,
        auction_id: auction.auctionId,
      });

      // ── Step 2: Authenticate with TEE ─────────────────────────────────────
      // Signs a challenge so the TEE middleware knows who's bidding.
      // Required for the PER permission check on the response side.
      setStep("bidding");

      const { teeConnection, attestation } = await createTeeSession(
        publicKey,
        signMessage
      );

      if (attestation) {
        console.log("[TEE Attestation]", attestation);
      }

      // ── Step 3: Place Sealed Bid on TEE ───────────────────────────────────
      // Sent to https://tee.magicblock.app?token={authToken}
      // The `amount` field goes into a private Bid PDA — never on L1.
      const teeProvider = new AnchorProvider(
        teeConnection,
        { publicKey, signTransaction, signAllTransactions: async (txs) => txs },
        { commitment: "confirmed" }
      );
      const teeProgram = getProgram(teeProvider);

      const sig = await placeBid(
        teeProgram,
        publicKey,
        auctionPda,
        new BN(amountLamports)
      );

      setTxSig(sig);
      setStep("done");
      onBidPlaced();
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setStep("error");
    }
  }

  const isActive = auction.is_accepting_bids ?? true;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
      <h2 className="text-lg font-semibold text-white mb-1">Place Sealed Bid</h2>
      <p className="text-xs text-gray-500 mb-4">
        Your bid amount is encrypted and sent directly to the TEE — it is never
        visible on-chain until the winner is revealed.
      </p>

      {step === "done" ? (
        <div className="rounded-lg bg-green-900/30 border border-green-700 p-4 text-center">
          <div className="text-2xl mb-1">🔒</div>
          <div className="text-green-400 font-semibold">Bid sealed in TEE</div>
          <div className="text-xs text-gray-500 mt-1">
            Your bid is locked inside the Intel TDX enclave. No one can see it
            until the auction closes.
          </div>
          {txSig && (
            <div className="mt-2 text-[10px] text-gray-600 break-all">
              PER tx: {txSig}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Bid amount (SOL)
            </label>
            <input
              type="number"
              step="0.001"
              min={reserveSol}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`min. ${reserveSol} SOL`}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
              disabled={step !== "idle" && step !== "error"}
            />
          </div>

          {error && (
            <div className="text-red-400 text-xs bg-red-900/20 border border-red-700/50 rounded p-2">
              {error}
            </div>
          )}

          {/* Progress indicator */}
          {(step === "permission" || step === "bidding") && (
            <div className="text-xs text-gray-400 space-y-1">
              <div
                className={`flex items-center gap-2 ${step === "permission" ? "text-yellow-400" : "text-green-400"}`}
              >
                <span>{step === "permission" ? "⏳" : "✅"}</span>
                Step 1: Creating privacy group on L1...
              </div>
              <div
                className={`flex items-center gap-2 ${step === "bidding" ? "text-yellow-400" : "text-gray-600"}`}
              >
                <span>{step === "bidding" ? "⏳" : "○"}</span>
                Step 2: Sealing bid in TEE (Intel TDX)...
              </div>
            </div>
          )}

          <button
            onClick={handleBid}
            disabled={
              !publicKey ||
              !amount ||
              (step !== "idle" && step !== "error")
            }
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-all
              bg-yellow-500 hover:bg-yellow-400 text-black
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === "permission"
              ? "Creating permission..."
              : step === "bidding"
                ? "Sealing bid in TEE..."
                : "Seal Bid in TEE 🔒"}
          </button>

          <p className="text-[10px] text-gray-600 text-center">
            Two transactions: permission setup (L1) + bid submission (TEE)
          </p>
        </div>
      )}
    </div>
  );
};
