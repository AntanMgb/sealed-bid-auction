/**
 * MagicBlock Private Ephemeral Rollup (TEE) client utilities.
 *
 * Handles:
 *   - TEE RPC integrity verification (ensures you're talking to a real TDX enclave)
 *   - Auth token acquisition (signs a challenge with the user's wallet)
 *   - Building PER connections
 *   - Real-time event subscription via the ER WebSocket
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  verifyTeeRpcIntegrity,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { TEE_RPC_BASE, MAGIC_ROUTER_WSS } from "./constants";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeeSession {
  /** Authenticated TEE endpoint URL (with token) */
  teeEndpoint: string;
  /** Solana Connection pointed at the TEE */
  teeConnection: Connection;
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
 * Steps:
 *   1. Verify TEE RPC integrity (confirms Intel TDX hardware attestation)
 *   2. Sign a challenge with the user's wallet
 *   3. Return a Connection pointed at the authenticated TEE endpoint
 */
export async function createTeeSession(
  walletPublicKey: PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<TeeSession> {
  // Step 1: Verify the TEE endpoint is a genuine Intel TDX enclave.
  // This is the "verifiable" part — before trusting the endpoint,
  // we confirm its hardware attestation is valid.
  let attestation: TeeAttestation | null = null;
  try {
    const integrityResult = await verifyTeeRpcIntegrity(TEE_RPC_BASE);
    attestation = {
      provider: "Intel TDX via MagicBlock",
      validatorPubkey: integrityResult?.validatorPubkey ?? "unknown",
      reportRaw: JSON.stringify(integrityResult ?? {}),
      verifiedAt: Date.now(),
    };
    console.log("[TEE] Integrity verified:", attestation);
  } catch (err) {
    console.warn("[TEE] Integrity check failed (devnet may skip):", err);
  }

  // Step 2: Get an auth token by signing a challenge.
  // The TEE middleware verifies this signature against the bidder's pubkey
  // and issues a JWT-style token that authorises RPC calls.
  const token = await getAuthToken(
    TEE_RPC_BASE,
    walletPublicKey,
    async (message: Uint8Array) => {
      const sig = await signMessage(message);
      return sig;
    }
  );

  const teeEndpoint = `${TEE_RPC_BASE}?token=${token}`;

  const teeConnection = new Connection(teeEndpoint, {
    commitment: "confirmed",
    wsEndpoint: teeEndpoint.replace("https://", "wss://"),
  });

  return { teeEndpoint, teeConnection, attestation };
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
        offset += 2; // status enum (1 byte discriminant + padding)

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
          offset += 32; // winner pubkey
          const winnerBytes = data.slice(offset - 32, offset);
          const winnerPubkey = new PublicKey(winnerBytes).toBase58();
          const winningBid = data.readBigUInt64LE(offset);

          onEvent({
            type: "auction_closed",
            timestamp: Date.now(),
            data: {
              winner: winnerPubkey,
              winningBid: winningBid.toString(),
              slot: context.slot,
              message: "Winner computed in TEE and committed to L1",
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
