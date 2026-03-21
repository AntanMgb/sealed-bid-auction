"use client";

import { FC } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getProgram, settleAuction, AuctionState } from "@/lib/program";
import { TeeAttestation } from "@/lib/magicblock";
import { TEE_VALIDATOR_DEVNET } from "@/lib/constants";

interface Props {
  auctionPda: PublicKey;
  auction: AuctionState;
  attestation: TeeAttestation | null;
  commitTxSig: string | null;
}

/**
 * Shows the TEE-computed result after close_auction commits to L1.
 *
 * This is the "committed onchain with a verifiable result" panel:
 *   - Winner and winning bid are on L1 (publicly readable)
 *   - The commit transaction was signed by the TEE validator
 *   - The TEE validator's key is publicly attested to Intel TDX
 */
export const ResultPanel: FC<Props> = ({
  auctionPda,
  auction,
  attestation,
  commitTxSig,
}) => {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const isWinner =
    publicKey && auction.winner.toBase58() === publicKey.toBase58();
  const hasWinner = auction.winner.toBase58() !== PublicKey.default.toBase58();
  const isClosed = "closed" in auction.status || "settled" in auction.status;
  const isSettled = "settled" in auction.status;

  async function handleSettle() {
    if (!publicKey || !signTransaction || !isWinner) return;

    const provider = new AnchorProvider(
      connection,
      {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs) => txs,
      },
      { commitment: "confirmed" }
    );
    const program = getProgram(provider);

    await settleAuction(program, publicKey, auction.seller, auctionPda);
  }

  if (!isClosed) return null;

  return (
    <div className="bg-gray-900 rounded-xl border border-green-700 overflow-hidden">
      {/* Header */}
      <div className="bg-green-900/40 border-b border-green-800 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <div className="font-bold text-green-400 text-lg">
              Winner Computed in TEE
            </div>
            <div className="text-xs text-green-600">
              Result committed to Solana L1 with Intel TDX attestation
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Result */}
        {hasWinner ? (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Winner</span>
              <span className="text-white font-mono">
                {auction.winner.toBase58().slice(0, 12)}...
                {auction.winner.toBase58().slice(-4)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Winning Bid</span>
              <span className="text-yellow-400 font-bold">
                {(auction.winningBid.toNumber() / 1e9).toFixed(4)} SOL
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Bids</span>
              <span className="text-white">{auction.bidCount}</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-3 text-gray-500">
            No valid bids above reserve price — auction failed.
          </div>
        )}

        <hr className="border-gray-700" />

        {/* TEE Proof */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Verifiable Proof
          </div>

          <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-xs font-mono">
            <div className="flex justify-between gap-2">
              <span className="text-gray-500 shrink-0">TEE Validator</span>
              <span className="text-teal-400 text-right break-all">
                {TEE_VALIDATOR_DEVNET.toBase58()}
              </span>
            </div>

            {commitTxSig && (
              <div className="flex justify-between gap-2">
                <span className="text-gray-500 shrink-0">Commit TX</span>
                <span className="text-blue-400 text-right break-all">
                  {commitTxSig}
                </span>
              </div>
            )}

            {attestation && (
              <>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500 shrink-0">TEE Provider</span>
                  <span className="text-white">{attestation.provider}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500 shrink-0">Verified</span>
                  <span className="text-green-400">
                    {new Date(attestation.verifiedAt).toISOString()}
                  </span>
                </div>
              </>
            )}
          </div>

          <p className="text-[10px] text-gray-600">
            The commit transaction above was signed by the TEE validator, whose
            public key is attested to run inside an Intel TDX Trust Domain.
            This proves the winner was computed fairly — no floor manipulation,
            no sniping, no insider information.
          </p>
        </div>

        {/* Settle button for winner */}
        {hasWinner && !isSettled && isWinner && (
          <button
            onClick={handleSettle}
            className="w-full py-2.5 rounded-lg font-semibold text-sm bg-green-600 hover:bg-green-500 text-white transition-all"
          >
            Settle & Pay {(auction.winningBid.toNumber() / 1e9).toFixed(4)} SOL
          </button>
        )}

        {isSettled && (
          <div className="text-center text-green-400 text-sm font-semibold">
            🏆 Auction fully settled
          </div>
        )}
      </div>
    </div>
  );
};
