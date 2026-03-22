"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getProgram, settleAuction, cancelAuction, getEscrowPda, getAssociatedTokenAddr, AuctionState } from "@/lib/program";
import { TeeAttestation, getDevnetConnection } from "@/lib/magicblock";
import { TEE_VALIDATOR_DEVNET } from "@/lib/constants";
import { BN } from "@coral-xyz/anchor";

interface Props {
  auctionPda: PublicKey;
  auction: AuctionState;
  attestation: TeeAttestation | null;
  commitTxSig: string | null;
}

export const ResultPanel: FC<Props> = ({
  auctionPda,
  auction,
  attestation,
  commitTxSig,
}) => {
  const { publicKey, signTransaction } = useWallet();

  const isWinner =
    publicKey && auction.winner.toBase58() === publicKey.toBase58();
  const hasWinner = auction.winner.toBase58() !== PublicKey.default.toBase58();
  const isClosed = "closed" in auction.status || "settled" in auction.status || "cancelled" in auction.status;
  const isSettled = "settled" in auction.status;
  const isCancelled = "cancelled" in auction.status;

  const [settleError, setSettleError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  async function handleSettle() {
    if (!publicKey || !signTransaction || !isWinner) return;
    setSettleError(null);
    setSettling(true);

    try {
      const devnetConnection = getDevnetConnection();
      const provider = new AnchorProvider(
        devnetConnection,
        {
          publicKey,
          signTransaction,
          signAllTransactions: async (txs) => txs,
        },
        { commitment: "confirmed" }
      );
      const program = getProgram(provider);

      const escrowNftAccount = getEscrowPda(auction.seller, new BN(auction.auctionId));
      const winnerNftAccount = getAssociatedTokenAddr(
        auction.nftMint,
        publicKey
      );

      await settleAuction(
        program,
        publicKey,
        auction.seller,
        auctionPda,
        escrowNftAccount,
        winnerNftAccount,
        auction.nftMint
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Settle] Error:", err);
      setSettleError(msg);
    } finally {
      setSettling(false);
    }
  }

  async function handleCancel() {
    if (!publicKey || !signTransaction) return;

    const devnetConnection = getDevnetConnection();
    const provider = new AnchorProvider(
      devnetConnection,
      {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs) => txs,
      },
      { commitment: "confirmed" }
    );
    const program = getProgram(provider);

    const escrowTokenAccount = getEscrowPda(auction.seller, new BN(auction.auctionId));
    const sellerTokenAccount = await getAssociatedTokenAddr(
      auction.nftMint,
      auction.seller
    );

    await cancelAuction(
      program,
      publicKey,
      auction.seller,
      auctionPda,
      escrowTokenAccount,
      sellerTokenAccount
    );
  }

  if (!isClosed) return null;

  return (
    <div className="card overflow-hidden" style={{ borderColor: "rgba(74,222,128,0.3)" }}>
      {/* Header */}
      <div className="px-6 py-4" style={{ background: "rgba(74,222,128,0.08)", borderBottom: "1px solid rgba(74,222,128,0.15)" }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <div className="font-bold text-lg" style={{ color: "#4ade80" }}>
              Winner Computed in TEE
            </div>
            <div className="text-xs" style={{ color: "rgba(74,222,128,0.6)" }}>
              Result committed to Solana L1 with Intel TDX attestation
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Result */}
        {hasWinner ? (
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--text-dim)" }}>Winner</span>
              <span className="text-white mono">
                {auction.winner.toBase58().slice(0, 12)}...
                {auction.winner.toBase58().slice(-4)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--text-dim)" }}>Winning Bid</span>
              <span className="font-bold" style={{ color: "var(--accent-amber)" }}>
                {(auction.winningBid.toNumber() / 1e9).toFixed(4)} SOL
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--text-dim)" }}>Total Bids</span>
              <span className="text-white">{auction.bidCount}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-3" style={{ color: "var(--text-dim)" }}>
            No valid bids above reserve price — auction failed.
          </div>
        )}

        <hr style={{ borderColor: "var(--border)" }} />

        {/* TEE Proof */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
            Verifiable Proof
          </div>

          <div className="rounded-xl p-4 space-y-2 text-xs mono" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-dim)" }}>TEE Validator</span>
              <span className="text-right break-all" style={{ color: "var(--accent-violet)" }}>
                {TEE_VALIDATOR_DEVNET.toBase58()}
              </span>
            </div>

            {commitTxSig && (
              <div className="flex justify-between gap-2">
                <span style={{ color: "var(--text-dim)" }}>Commit TX</span>
                <span className="text-right break-all" style={{ color: "var(--accent-blue)" }}>
                  {commitTxSig}
                </span>
              </div>
            )}

            {attestation && (
              <>
                <div className="flex justify-between gap-2">
                  <span style={{ color: "var(--text-dim)" }}>TEE Provider</span>
                  <span className="text-white">{attestation.provider}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span style={{ color: "var(--text-dim)" }}>Verified</span>
                  <span style={{ color: "#4ade80" }}>
                    {new Date(attestation.verifiedAt).toISOString()}
                  </span>
                </div>
              </>
            )}
          </div>

          <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            The commit transaction above was signed by the TEE validator, whose
            public key is attested to run inside an Intel TDX Trust Domain.
            This proves the winner was computed fairly — no floor manipulation,
            no sniping, no insider information.
          </p>
        </div>

        {/* Settle deadline */}
        {hasWinner && !isSettled && !isCancelled && auction.settleDeadline.toNumber() > 0 && (
          <div className="flex justify-between text-xs" style={{ color: "var(--text-dim)" }}>
            <span>Settle deadline</span>
            <span className="mono">
              {new Date(auction.settleDeadline.toNumber() * 1000).toLocaleTimeString()}
            </span>
          </div>
        )}

        {/* Settle button for winner */}
        {hasWinner && !isSettled && !isCancelled && isWinner && (
          <>
            <button
              onClick={handleSettle}
              disabled={settling}
              className="btn-primary w-full disabled:opacity-50"
            >
              {settling ? "Settling..." : `Settle & Pay ${(auction.winningBid.toNumber() / 1e9).toFixed(4)} SOL`}
            </button>
            {settleError && (
              <div className="text-xs rounded-lg p-3 mt-2" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
                {settleError}
              </div>
            )}
          </>
        )}

        {/* Cancel button — visible when no winner or settle deadline expired */}
        {!isSettled && !isCancelled && (
          (!hasWinner || (auction.settleDeadline.toNumber() > 0 && Date.now() / 1000 >= auction.settleDeadline.toNumber())) && (
            <button
              onClick={handleCancel}
              className="w-full py-2 px-4 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}
            >
              {hasWinner ? "Winner didn't pay — Cancel & Return Tokens" : "No winner — Return Tokens to Seller"}
            </button>
          )
        )}

        {isSettled && (
          <div className="text-center text-sm font-bold" style={{ color: "#4ade80" }}>
            Auction fully settled
          </div>
        )}

        {isCancelled && (
          <div className="text-center text-sm font-bold" style={{ color: "var(--text-dim)" }}>
            Auction cancelled — tokens returned to seller
          </div>
        )}
      </div>
    </div>
  );
};
