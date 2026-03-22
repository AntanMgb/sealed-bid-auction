/**
 * MagicBlock Private Ephemeral Rollup (TEE) client utilities.
 *
 * Handles:
 *   - Auth token acquisition (signs a challenge with the user's wallet)
 *   - Building PER connections (via server-side proxy to bypass CORS)
 *   - Real-time event subscription via the ER WebSocket
 *
 * All TEE requests go through /api/tee Next.js rewrite proxy
 * to avoid CORS issues with tee.magicblock.app.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import bs58 from "bs58";
import { MAGIC_ROUTER_WSS, SOLANA_DEVNET_RPC } from "./constants";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeeSession {
  /** Authenticated TEE endpoint URL (with token) */
  teeEndpoint: string;
  /** Solana Connection pointed at the TEE (uses ER-specific blockhash) */
  teeConnection: ConnectionMagicRouter;
  /** Attestation report from the TEE (proves Intel TDX) */
  attestation: TeeAttestation | null;
}

export interface TeeAttestation {
  /** Human-readable TEE provider info */
  provider: string;
  /** The TEE validator's public key */
  validatorPubkey: string;
  /** Raw attestation report (TDX quote) for independent verification */
  reportRaw: string;
  /** Verification timestamp */
  verifiedAt: number;
}

// ─── TEE Session ─────────────────────────────────────────────────────────────

/**
 * Establishes an authenticated session with the Private Ephemeral Rollup.
 *
 * All requests go through our server-side proxy to bypass CORS:
 *   1. GET /api/tee-auth → challenge from TEE
 *   2. Sign challenge client-side with wallet
 *   3. POST /api/tee-auth → auth token from TEE
 *   4. Connection uses /api/tee-rpc with token in custom header
 */
export async function createTeeSession(
  walletPublicKey: PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<TeeSession> {
  const pubkeyStr = walletPublicKey.toBase58();

  // All TEE auth goes through the Edge API routes (/api/tee-auth, /api/tee-rpc).
  // Edge functions run on Cloudflare nodes (not AWS), bypassing the 403 block.
  const AUTH_PROXY = "/api/tee-auth";
  const RPC_PROXY = typeof window !== "undefined"
    ? `${window.location.origin}/api/tee-rpc`
    : "/api/tee-rpc";

  // Step 1: Get challenge via edge proxy
  const challengeResp = await fetch(
    `${AUTH_PROXY}?pubkey=${pubkeyStr}`
  );
  if (!challengeResp.ok) {
    throw new Error(`TEE challenge failed: ${challengeResp.status} ${await challengeResp.text()}`);
  }
  const { challenge, error: challengeError } = await challengeResp.json();
  if (challengeError) {
    throw new Error(`TEE challenge error: ${challengeError}`);
  }
  if (!challenge) {
    throw new Error("No challenge received from TEE");
  }

  console.log("[TEE] Got challenge, signing with wallet...");

  // Step 2: Sign the challenge with the user's wallet
  const challengeBytes = new Uint8Array(Buffer.from(challenge, "utf-8"));
  const signature = await signMessage(challengeBytes);
  const signatureString = bs58.encode(signature);

  // Step 3: Exchange signature for auth token via edge proxy
  const loginResp = await fetch(`${AUTH_PROXY}?path=auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: pubkeyStr,
      challenge,
      signature: signatureString,
    }),
  });
  if (!loginResp.ok) {
    throw new Error(`TEE login failed: ${loginResp.status} ${await loginResp.text()}`);
  }
  const authJson = await loginResp.json();
  if (!authJson.token) {
    throw new Error("No token received from TEE");
  }

  const token: string = authJson.token;
  console.log("[TEE] Authenticated, token length:", token.length, "preview:", token.substring(0, 30));

  // Step 4: ConnectionMagicRouter via edge RPC proxy with token in query param.
  // The edge function forwards the JSON-RPC to tee.magicblock.app with the token.
  const teeUrl = `${RPC_PROXY}?teetoken=${encodeURIComponent(token)}`;
  const teeConnection = new ConnectionMagicRouter(teeUrl, {
    commitment: "confirmed",
  });

  console.log("[TEE] Connection URL:", teeUrl);

  return { teeEndpoint: teeUrl, teeConnection, attestation: null };
}

// ─── Devnet L1 Connection ─────────────────────────────────────────────────────

/**
 * Direct connection to Solana devnet for L1 operations.
 * Use this instead of Magic Router for create_auction, delegate_auction,
 * create_bid_permission, and settle_auction — these are L1 transactions
 * that need direct devnet confirmation.
 */
export function getDevnetConnection(): Connection {
  return new Connection(SOLANA_DEVNET_RPC, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 120_000,
  });
}

// ─── Magic Router Connection ──────────────────────────────────────────────────

/**
 * Connection to the Magic Router.
 * Automatically routes transactions to L1 or the appropriate ER based on
 * whether the target accounts are delegated. Use this for sending transactions
 * when you don't want to manually manage layer routing.
 */
export function getMagicRouterConnection(): Connection {
  return new Connection(MAGIC_ROUTER_WSS.replace("wss://", "https://"), {
    commitment: "confirmed",
    wsEndpoint: MAGIC_ROUTER_WSS,
  });
}

// ─── Real-time Feed ───────────────────────────────────────────────────────────

export interface AuctionEvent {
  type: "bid_placed" | "auction_closed" | "auction_settled" | "bid_count";
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Subscribes to real-time auction state changes on the PER connection.
 *
 * While the auction is delegated to PER, every `place_bid` call updates
 * `auction.bid_count` on the ephemeral layer. This subscription fires on every
 * state change, giving a live feed of "a sealed bid was received" events —
 * without revealing any bid amounts.
 *
 * After `close_auction` commits to L1, the final state (winner + amount)
 * appears here.
 *
 * Returns an unsubscribe function.
 */
export function subscribeToAuctionEvents(
  connection: Connection,
  auctionPda: PublicKey,
  onEvent: (event: AuctionEvent) => void
): () => void {
  let lastBidCount = 0;

  const subscriptionId = connection.onAccountChange(
    auctionPda,
    (accountInfo, context) => {
      try {
        // Parse auction state (skip 8-byte discriminator)
        const data = accountInfo.data;
        if (data.length < 8 + 32 + 68 + 8 + 8 + 8 + 4 + 2) return;

        let offset = 8; // skip discriminator
        offset += 32; // seller
        const titleLen = data.readUInt32LE(offset);
        offset += 4 + titleLen; // title
        offset += 8; // reserve_price
        offset += 8; // start_time
        offset += 8; // end_time

        const bidCount = data.readUInt32LE(offset);
        offset += 4;

        const status = data[offset];
        offset += 1; // status enum: Borsh uses 1 byte for simple enums (no padding)

        if (bidCount > lastBidCount) {
          // New bid received — emit without amount
          for (let i = lastBidCount; i < bidCount; i++) {
            onEvent({
              type: "bid_placed",
              timestamp: Date.now(),
              data: {
                bidCount,
                slot: context.slot,
                message: "New sealed bid received (amount hidden in TEE)",
              },
            });
          }
          lastBidCount = bidCount;
        }

        // Status 2 = Closed (winner computed by TEE)
        if (status === 2) {
          const winnerBytes = data.slice(offset, offset + 32);
          offset += 32; // winner pubkey
          const winnerPubkey = new PublicKey(winnerBytes).toBase58();
          const winningBid = data.readBigUInt64LE(offset);
          const hasWinner = winnerPubkey !== PublicKey.default.toBase58();

          onEvent({
            type: "auction_closed",
            timestamp: Date.now(),
            data: {
              winner: hasWinner ? winnerPubkey : null,
              winningBid: hasWinner ? winningBid.toString() : "0",
              bidCount,
              slot: context.slot,
              message: hasWinner
                ? "Winner computed in TEE and committed to L1"
                : "Auction closed — no valid bids above reserve price",
            },
          });
        }

        // Status 3 = Settled
        if (status === 3) {
          onEvent({
            type: "auction_settled",
            timestamp: Date.now(),
            data: { slot: context.slot, message: "Auction settled on L1" },
          });
        }
      } catch {
        // Partial data during update — ignore
      }
    },
    "confirmed"
  );

  return () => connection.removeAccountChangeListener(subscriptionId);
}
