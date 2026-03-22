"use client";

import { FC, useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  escrowPdaFromEscrowAuthority,
  createTopUpEscrowInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { formatDistance } from "date-fns";
import {
  fetchAuction,
  closeAuction,
  getProgram,
  AuctionState,
} from "@/lib/program";
import { subscribeToAuctionEvents, AuctionEvent, TeeAttestation, getDevnetConnection, getMagicRouterConnection } from "@/lib/magicblock";
import { BidForm } from "./BidForm";
import { ResultPanel } from "./ResultPanel";
import { LiveFeed } from "./LiveFeed";

interface Props {
  auctionPdaStr: string;
}

export const AuctionRoom: FC<Props> = ({ auctionPdaStr }) => {
  const { publicKey, signTransaction } = useWallet();

  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [events, setEvents] = useState<AuctionEvent[]>([]);
  const [attestation, setAttestation] = useState<TeeAttestation | null>(null);
  const [commitTxSig, setCommitTxSig] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [knownBidders, setKnownBidders] = useState<string[]>([]);
  const [nftImage, setNftImage] = useState<string | null>(null);
  const [auctionTypeLabel, setAuctionTypeLabel] = useState<string | null>(null);

  const auctionPda = new PublicKey(auctionPdaStr);

  useEffect(() => {
    try {
      const img = localStorage.getItem(`auction-image-${auctionPdaStr}`);
      if (img) setNftImage(img);
      const aType = localStorage.getItem(`auction-type-${auctionPdaStr}`);
      if (aType) setAuctionTypeLabel(aType);
    } catch {}
  }, [auctionPdaStr]);

  const refresh = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    const makeProvider = (conn: any) => new AnchorProvider(
      conn,
      { publicKey, signTransaction, signAllTransactions: async (t: any) => t },
      { commitment: "confirmed" }
    );

    let data = await fetchAuction(getProgram(makeProvider(getMagicRouterConnection())), auctionPda);

    if (!data) {
      data = await fetchAuction(getProgram(makeProvider(getDevnetConnection())), auctionPda);
    }

    if (data) setAuction(data);
  }, [publicKey, signTransaction, auctionPda]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const routerConn = getMagicRouterConnection();
    const unsubscribe = subscribeToAuctionEvents(routerConn, auctionPda, (ev) => {
      setEvents((prev) => [...prev.slice(-49), ev]);

      if (ev.type === "auction_closed" && ev.data.slot) {
        setCommitTxSig(`slot-${ev.data.slot}`);
      }
    });
    return unsubscribe;
  }, [auctionPdaStr]);

  useEffect(() => {
    if (!auction) return;
    const update = () => {
      const end = auction.endTime.toNumber() * 1000;
      const now = Date.now();
      if (now >= end) {
        setTimeLeft("Ended");
      } else {
        setTimeLeft(formatDistance(now, end, { addSuffix: false }));
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [auction]);

  async function handleClose() {
    if (!publicKey || !signTransaction || !auction) return;
    setClosing(true);
    setCloseError(null);
    try {
      const devnetConn = getDevnetConnection();
      const escrowPda = escrowPdaFromEscrowAuthority(publicKey);
      const topUpIx = createTopUpEscrowInstruction(
        escrowPda, publicKey, publicKey, 5_000_000, 255
      );
      const topUpTx = new Transaction().add(topUpIx);
      topUpTx.feePayer = publicKey;
      const { blockhash } = await devnetConn.getLatestBlockhash();
      topUpTx.recentBlockhash = blockhash;
      const signedTopUp = await signTransaction(topUpTx);
      const topUpSig = await devnetConn.sendRawTransaction(signedTopUp.serialize());
      await devnetConn.confirmTransaction(topUpSig, "confirmed");
      console.log("[L1] Escrow top-up for close tx:", topUpSig);

      // Use Magic Router — it automatically routes to the ER for delegated accounts.
      // TEE auth is only needed for reading private data, not for close_auction.
      const routerConn = getMagicRouterConnection();
      const routerProvider = new AnchorProvider(
        routerConn,
        { publicKey, signTransaction, signAllTransactions: async (t) => t },
        { commitment: "confirmed" }
      );
      const routerProgram = getProgram(routerProvider);

      let bidders: PublicKey[] = auction.bidders.length > 0
        ? auction.bidders
        : knownBidders.map((b) => new PublicKey(b));

      if (bidders.length === 0) {
        try {
          const teeAuction = await fetchAuction(routerProgram, auctionPda);
          if (teeAuction?.bidders?.length) {
            bidders = teeAuction.bidders;
          }
        } catch (err) {
          console.warn("[TEE] Auction fetch from TEE failed:", err);
        }
      }

      console.log("[Close] Bidders:", bidders.length, bidders.map(b => b.toBase58()));

      const sig = await closeAuction(
        routerProgram,
        publicKey,
        auctionPda,
        bidders
      );
      setCommitTxSig(sig);
      await refresh();
    } catch (err) {
      console.error(err);
      setCloseError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setClosing(false);
    }
  }

  if (!auction) {
    return (
      <div className="flex items-center justify-center h-48" style={{ color: "var(--text-dim)" }}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "var(--accent-violet)", borderTopColor: "transparent" }} />
          Loading auction from PER...
        </div>
      </div>
    );
  }

  const isDelegated = "delegated" in auction.status || "created" in auction.status;
  const isClosed = "closed" in auction.status || "settled" in auction.status;
  const isExpired = Date.now() >= auction.endTime.toNumber() * 1000;

  return (
    <div className="space-y-5">
      {/* Auction Header */}
      <div className="card p-6">
        {/* NFT Image */}
        {nftImage && (
          <div className="mb-5 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <img
              src={nftImage}
              alt={auction.title}
              className="w-full aspect-square object-contain"
              style={{ background: "var(--surface-hover)" }}
            />
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {auctionTypeLabel && (
                <span className="pill text-[10px] py-0.5 px-2">
                  {auctionTypeLabel === "nft" ? "🎨 NFT" : auctionTypeLabel === "token" ? "🪙 Token" : "🏛️ Governance"}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white truncate mt-2" style={{ fontFamily: "'Unbounded', sans-serif" }}>
              {auction.title}
            </h1>
            <div className="text-xs mt-1 mono break-all" style={{ color: "var(--text-dim)" }}>
              {auctionPdaStr}
            </div>
          </div>
          <div className="shrink-0">
            {isDelegated && !isExpired && (
              <span className="flex items-center gap-1.5 pill text-xs font-medium" style={{ color: "var(--accent-violet)" }}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent-violet)" }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "var(--accent-violet)" }} />
                </span>
                Live in TEE
              </span>
            )}
            {isExpired && !isClosed && (
              <span className="pill text-xs" style={{ color: "var(--accent-amber)", borderColor: "rgba(255,170,34,0.3)" }}>
                Expired — awaiting close
              </span>
            )}
            {isClosed && (
              <span className="pill text-xs" style={{ color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>
                Closed
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-5">
          <div className="rounded-xl p-4" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>Reserve Price</div>
            <div className="text-white font-bold mt-1">
              {(auction.reservePrice.toNumber() / 1e9).toFixed(3)} SOL
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>Sealed Bids</div>
            <div className="font-bold mt-1" style={{ color: "var(--accent-amber)" }}>
              {auction.bidCount}{" "}
              <span className="font-normal text-xs" style={{ color: "var(--text-dim)" }}>received</span>
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <div className="text-xs" style={{ color: "var(--text-dim)" }}>Time Left</div>
            <div className={`font-bold mt-1 ${isExpired ? "" : "text-white"}`} style={isExpired ? { color: "var(--accent-pink)" } : {}}>
              {timeLeft || "—"}
            </div>
          </div>
        </div>

        {/* TEE badge */}
        <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
          <span>🔐</span>
          <span>
            All bid amounts are sealed inside Intel TDX. Delegated to PER
            validator{" "}
            <span className="mono" style={{ color: "var(--text-mid)" }}>
              FnE6...XQnp1
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Bid or Result */}
        <div>
          {isDelegated && !isExpired && (
            <BidForm
              auctionPda={auctionPda}
              auction={auction}
              onBidPlaced={() => {
                if (publicKey) {
                  setKnownBidders((prev) =>
                    prev.includes(publicKey.toBase58())
                      ? prev
                      : [...prev, publicKey.toBase58()]
                  );
                }
                refresh();
              }}
            />
          )}

          {isClosed && (
            <ResultPanel
              auctionPda={auctionPda}
              auction={auction}
              attestation={attestation}
              commitTxSig={commitTxSig}
            />
          )}

          {/* Close auction button */}
          {isExpired && !isClosed && (
            <div className="card p-6" style={{ borderColor: "rgba(255,170,34,0.3)" }}>
              <h3 className="font-bold text-white mb-2" style={{ fontFamily: "'Unbounded', sans-serif" }}>
                Compute Winner in TEE
              </h3>
              <p className="text-xs mb-4" style={{ color: "var(--text-dim)" }}>
                The auction has expired. Trigger winner computation — the TEE
                will read all sealed bids, find the highest, and commit the
                result to L1 with an Intel TDX attestation.
              </p>
              {closeError && (
                <div className="text-xs rounded-lg p-3 mb-3" style={{ color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
                  {closeError}
                </div>
              )}
              <button
                onClick={handleClose}
                disabled={closing}
                className="w-full py-2.5 rounded-full font-semibold text-sm text-white disabled:opacity-50 transition-all"
                style={{ background: "var(--accent-amber)" }}
              >
                {closing
                  ? "TEE computing winner..."
                  : "Close & Reveal Winner (TEE) 🔐"}
              </button>
            </div>
          )}
        </div>

        {/* Right: Live Feed */}
        <LiveFeed events={events} />
      </div>
    </div>
  );
};
