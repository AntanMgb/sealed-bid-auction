"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  escrowPdaFromEscrowAuthority,
  createTopUpEscrowInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  placeBid,
  initBid,
  delegateBid,
  getProgram,
} from "@/lib/program";
import { getDevnetConnection, createTeeSession } from "@/lib/magicblock";
import { AuctionState } from "@/lib/program";

interface Props {
  auctionPda: PublicKey;
  auction: AuctionState;
  onBidPlaced: () => void;
}

export const BidForm: FC<Props> = ({ auctionPda, auction, onBidPlaced }) => {
  const { publicKey, signTransaction, signMessage } = useWallet();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<
    "idle" | "escrow" | "bidding" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const reserveSol = auction.reservePrice.toNumber() / 1e9;

  async function handleBid() {
    if (!publicKey || !signTransaction || !signMessage) return;
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
      setStep("escrow");
      const devnetConn = getDevnetConnection();

      const escrowPda = escrowPdaFromEscrowAuthority(publicKey);
      const topUpIx = createTopUpEscrowInstruction(
        escrowPda,
        publicKey,
        publicKey,
        5_000_000,
        255
      );
      const topUpTx = new Transaction().add(topUpIx);
      topUpTx.feePayer = publicKey;
      const { blockhash } = await devnetConn.getLatestBlockhash();
      topUpTx.recentBlockhash = blockhash;
      const signedTopUp = await signTransaction(topUpTx);
      const topUpSig = await devnetConn.sendRawTransaction(signedTopUp.serialize());
      await devnetConn.confirmTransaction(topUpSig, "confirmed");
      console.log("[L1] Escrow top-up tx:", topUpSig);

      const l1Provider = new AnchorProvider(
        devnetConn,
        { publicKey, signTransaction, signAllTransactions: async (txs) => txs },
        { commitment: "confirmed" }
      );
      const l1Program = getProgram(l1Provider);

      // Skip init/delegate if already done (e.g. on retry after TEE auth failure)
      try {
        await initBid(l1Program, publicKey, auctionPda);
        console.log("[L1] Bid PDA created");
      } catch (e: any) {
        console.log("[L1] initBid skipped (already exists?):", e?.message?.slice(0, 80));
      }

      try {
        await delegateBid(l1Program, publicKey, auctionPda);
        console.log("[L1] Bid PDA delegated to TEE");
      } catch (e: any) {
        console.log("[L1] delegateBid skipped (already delegated?):", e?.message?.slice(0, 80));
      }

      setStep("bidding");

      const { teeConnection } = await createTeeSession(publicKey, signMessage);

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

  return (
    <div className="card p-6">
      <h2 className="text-lg font-bold text-white mb-1" style={{ fontFamily: "'Unbounded', sans-serif" }}>Place Sealed Bid</h2>
      <p className="text-xs mb-5" style={{ color: "var(--text-dim)" }}>
        Your bid amount is encrypted and sent directly to the TEE — it is never
        visible on-chain until the winner is revealed.
      </p>

      {step === "done" ? (
        <div className="rounded-xl p-5 text-center glow" style={{ background: "rgba(136,51,255,0.1)", border: "1px solid rgba(136,51,255,0.3)" }}>
          <div className="text-3xl mb-2">🔒</div>
          <div className="font-bold text-lg" style={{ color: "var(--accent-violet)" }}>Bid sealed in TEE</div>
          <div className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
            Your bid is locked inside the Intel TDX enclave. No one can see it
            until the auction closes.
          </div>
          {txSig && (
            <div className="mt-3 text-[10px] break-all mono" style={{ color: "var(--text-dim)" }}>
              PER tx: {txSig}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-dim)" }}>
              Bid amount (SOL)
            </label>
            <input
              type="number"
              step="0.001"
              min={reserveSol}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`min. ${reserveSol} SOL`}
              className="input mono"
              disabled={step !== "idle" && step !== "error"}
            />
          </div>

          {error && (
            <div className="text-xs rounded-lg p-3" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
              {error}
            </div>
          )}

          {step === "escrow" && (
            <div className="text-xs flex items-center gap-2" style={{ color: "var(--accent-amber)" }}>
              <span>⏳</span>
              Topping up ephemeral escrow for ER fees...
            </div>
          )}
          {step === "bidding" && (
            <div className="text-xs flex items-center gap-2" style={{ color: "var(--accent-amber)" }}>
              <span>⏳</span>
              Authenticating with TEE and sealing bid...
            </div>
          )}

          <button
            onClick={handleBid}
            disabled={
              !publicKey ||
              !amount ||
              (step !== "idle" && step !== "error")
            }
            className="btn-accent w-full disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {step === "escrow"
              ? "Preparing escrow..."
              : step === "bidding"
                ? "Sealing bid in TEE..."
                : "Seal Bid in TEE 🔒"}
          </button>

          <p className="text-[10px] text-center" style={{ color: "var(--text-dim)" }}>
            Two transactions: escrow top-up (L1) + sealed bid (TEE)
          </p>
        </div>
      )}
    </div>
  );
};
