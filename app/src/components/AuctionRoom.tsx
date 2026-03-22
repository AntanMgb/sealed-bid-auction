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
import { subscribeToAuctionEvents, AuctionEvent, TeeAttestation, createTeeSession, getDevnetConnection, getMagicRouterConnection } from "@/lib/magicblock";
import { BidForm } from "./BidForm";
import { ResultPanel } from "./ResultPanel";
import { LiveFeed } from "./LiveFeed";

interface Props {
  auctionPdaStr: string;
}

export const AuctionRoom: FC<Props> = ({ auctionPdaStr }) => {
  const { publicKey, signTransaction, signMessage } = useWallet();

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

  // Load NFT image and auction type from localStorage
  useEffect(() => {
    try {
      const img = localStorage.getItem(`auction-image-${auctionPdaStr}`);
      if (img) setNftImage(img);
      const aType = localStorage.getItem(`auction-type-${auctionPdaStr}`);
      if (aType) setAuctionTypeLabel(aType);
    } catch {}
  }, [auctionPdaStr]);

  // Fetch auction state — try Magic Router first (routes to ER for delegated accounts),
  // fall back to devnet L1 if router fails
  const refresh = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    const makeProvider = (conn: any) => new AnchorProvider(
      conn,
      { publicKey, signTransaction, signAllTransactions: async (t: any) => t },
      { commitment: "confirmed" }
    );

    // Try Magic Router (auto-routes to ER for delegated accounts)
    let data = await fetchAuction(getProgram(makeProvider(getMagicRouterConnection())), auctionPda);

    // Fall back to devnet L1
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

  // Subscribe to real-time events via Magic Router (routes to PER automatically)
  useEffect(() => {
    const routerConn = getMagicRouterConnection();
    const unsubscribe = subscribeToAuctionEvents(routerConn, auctionPda, (ev) => {
      setEvents((prev) => [...prev.slice(-49), ev]);

      // Capture commit tx signature when auction closes
      if (ev.type === "auction_closed" && ev.data.slot) {
        setCommitTxSig(`slot-${ev.data.slot}`);
      }
    });
    return unsubscribe;
  }, [auctionPdaStr]);

  // Countdown timer
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

  // Close auction (trigger TEE computation)
  async function handleClose() {
    if (!publicKey || !signTransaction || !signMessage || !auction) return;
    setClosing(true);
    setCloseError(null);
    try {
      // Top up ephemeral balance for ER fees
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

      // Authenticate with TEE
      const { teeConnection, attestation: att } = await createTeeSession(
        publicKey,
        signMessage
      );
      setAttestation(att);

      const teeProvider = new AnchorProvider(
        teeConnection,
        { publicKey, signTransaction, signAllTransactions: async (t) => t },
        { commitment: "confirmed" }
      );
      const teeProgram = getProgram(teeProvider);

      // Get bidders list from auction state (read via Magic Router = ER state)
      let bidders: PublicKey[] = auction.bidders.length > 0
        ? auction.bidders
        : knownBidders.map((b) => new PublicKey(b));

      // Fallback: scan TEE for Bid accounts if we still have none
      if (bidders.length === 0) {
        try {
          const teeAuction = await fetchAuction(teeProgram, auctionPda);
          if (teeAuction?.bidders?.length) {
            bidders = teeAuction.bidders;
          }
        } catch (err) {
          console.warn("[TEE] Auction fetch from TEE failed:", err);
        }
      }

      console.log("[Close] Bidders:", bidders.length, bidders.map(b => b.toBase58()));

      const sig = await closeAuction(
        teeProgram,
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
      <div className="flex items-center justify-center h-48 text-gray-500">
        Loading auction from PER...
      </div>
    );
  }

  // After create+delegate, L1 status may still show "created" since
  // delegate_auction doesn't update the status field. Treat both as active.
  const isDelegated = "delegated" in auction.status || "created" in auction.status;
  const isClosed = "closed" in auction.status || "settled" in auction.status;
  const isExpired = Date.now() >= auction.endTime.toNumber() * 1000;
  const isSellerViewing =
    publicKey?.toBase58() === auction.seller.toBase58();

  return (
    <div className="space-y-5">
      {/* Auction Header */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-5">
        {/* NFT Image */}
        {nftImage && (
          <div className="mb-4 rounded-lg overflow-hidden border border-gray-700">
            <img
              src={nftImage}
              alt={auction.title}
              className="w-full aspect-square object-contain bg-gray-800"
            />
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {auctionTypeLabel && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-600 text-gray-400">
                  {auctionTypeLabel === "nft" ? "🎨 NFT" : auctionTypeLabel === "token" ? "🪙 Token" : "🏛️ Governance"}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white truncate mt-1">
              {auction.title}
            </h1>
            <div className="text-xs text-gray-500 mt-1 font-mono break-all">
              {auctionPdaStr}
            </div>
          </div>
          <div className="shrink-0">
            {isDelegated && !isExpired && (
              <span className="flex items-center gap-1.5 bg-teal-900/50 border border-teal-700 text-teal-400 text-xs px-3 py-1 rounded-full font-medium">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal-500" />
                </span>
                Live in TEE
              </span>
            )}
            {isExpired && !isClosed && (
              <span className="bg-orange-900/50 border border-orange-700 text-orange-400 text-xs px-3 py-1 rounded-full">
                Expired — awaiting close
              </span>
            )}
            {isClosed && (
              <span className="bg-green-900/50 border border-green-700 text-green-400 text-xs px-3 py-1 rounded-full">
                Closed
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500">Reserve Price</div>
            <div className="text-white font-bold mt-0.5">
              {(auction.reservePrice.toNumber() / 1e9).toFixed(3)} SOL
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500">Sealed Bids</div>
            <div className="text-yellow-400 font-bold mt-0.5">
              {auction.bidCount}{" "}
              <span className="text-gray-500 font-normal text-xs">received</span>
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500">Time Left</div>
            <div
              className={`font-bold mt-0.5 ${isExpired ? "text-red-400" : "text-white"}`}
            >
              {timeLeft || "—"}
            </div>
          </div>
        </div>

        {/* TEE badge */}
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
          <span>🔐</span>
          <span>
            All bid amounts are sealed inside Intel TDX. Delegated to PER
            validator{" "}
            <span className="font-mono text-gray-500">
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

          {/* Close auction button (seller or anyone after expiry) */}
          {isExpired && !isClosed && (
            <div className="bg-gray-900 rounded-xl border border-orange-700 p-5">
              <h3 className="font-semibold text-white mb-2">
                Compute Winner in TEE
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                The auction has expired. Trigger winner computation — the TEE
                will read all sealed bids, find the highest, and commit the
                result to L1 with an Intel TDX attestation.
              </p>
              {closeError && (
                <div className="text-red-400 text-xs bg-red-900/20 border border-red-700/50 rounded p-2 mb-3">
                  {closeError}
                </div>
              )}
              <button
                onClick={handleClose}
                disabled={closing}
                className="w-full py-2.5 rounded-lg font-semibold text-sm bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-all"
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
