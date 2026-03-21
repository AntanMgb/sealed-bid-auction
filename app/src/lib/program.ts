/**
 * Anchor program client helpers.
 * Wraps all instruction calls with proper account derivation and connection routing.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  PROGRAM_ID,
  AUCTION_SEED,
  BID_SEED,
  PERM_GROUP_SEED,
  TEE_VALIDATOR_DEVNET,
  PERMISSION_PROGRAM_ID,
} from "./constants";
import IDL from "../idl/sealed_bid_auction.json";

// ─── PDA Helpers ─────────────────────────────────────────────────────────────

export function getAuctionPda(seller: PublicKey, auctionId: BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      AUCTION_SEED,
      seller.toBytes(),
      auctionId.toArrayLike(Uint8Array, "le", 8),
    ],
    PROGRAM_ID
  );
  return pda;
}

export function getBidPda(auctionPda: PublicKey, bidder: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [BID_SEED, auctionPda.toBytes(), bidder.toBytes()],
    PROGRAM_ID
  );
  return pda;
}

export function getPermGroupPda(
  auctionPda: PublicKey,
  bidder: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [PERM_GROUP_SEED, auctionPda.toBytes(), bidder.toBytes()],
    PROGRAM_ID
  );
  return pda;
}

// ─── Program Client ───────────────────────────────────────────────────────────

export function getProgram(provider: AnchorProvider): Program {
  return new Program(IDL as anchor.Idl, provider);
}

// ─── Instructions ─────────────────────────────────────────────────────────────

/** Step 1 (L1): Create the auction */
export async function createAuction(
  program: Program,
  seller: PublicKey,
  auctionId: BN,
  reservePrice: BN,
  durationSeconds: BN,
  title: string
): Promise<string> {
  const auctionPda = getAuctionPda(seller, auctionId);

  const tx = await program.methods
    .createAuction(auctionId, reservePrice, durationSeconds, title)
    .accounts({
      seller,
      auction: auctionPda,
    })
    .rpc({ commitment: "confirmed" });

  console.log("[L1] create_auction tx:", tx);
  return tx;
}

/** Step 2 (L1): Create permission group for a bidder's future bid */
export async function createBidPermission(
  program: Program,
  bidder: PublicKey,
  auctionPda: PublicKey,
  _auctionData: { seller: PublicKey; auction_id: BN }
): Promise<string> {
  const permGroupPda = getPermGroupPda(auctionPda, bidder);

  const tx = await program.methods
    .createBidPermission()
    .accounts({
      bidder,
      auction: auctionPda,
      permissionGroup: permGroupPda,
    })
    .rpc({ commitment: "confirmed" });

  console.log("[L1] create_bid_permission tx:", tx);
  return tx;
}

/** Step 3 (L1): Delegate auction to TEE */
export async function delegateAuction(
  program: Program,
  seller: PublicKey,
  auctionPda: PublicKey,
  auctionId: BN
): Promise<string> {
  const tx = await program.methods
    .delegateAuction(auctionId)
    .accounts({
      payer: seller,
      auction: auctionPda,
    })
    .remainingAccounts([
      { pubkey: TEE_VALIDATOR_DEVNET, isSigner: false, isWritable: false },
    ])
    .rpc({ commitment: "confirmed" });

  console.log("[L1] delegate_auction tx:", tx);
  return tx;
}

/**
 * Send a transaction to the ER via ConnectionMagicRouter.
 * Uses getBlockhashForAccounts (ER-specific) instead of getLatestBlockhash.
 */
async function sendToER(
  program: Program,
  tx: Transaction,
  feePayer: PublicKey
): Promise<string> {
  const conn = program.provider.connection;
  tx.feePayer = feePayer;

  // Try ER-specific blockhash first, fall back to standard
  let blockhash: string | undefined;
  let lastValidBlockHeight: number | undefined;

  if (conn instanceof ConnectionMagicRouter) {
    try {
      const bhData = await conn.getLatestBlockhashForTransaction(tx);
      if (bhData?.blockhash) {
        blockhash = bhData.blockhash;
        lastValidBlockHeight = bhData.lastValidBlockHeight;
        console.log("[PER/TEE] Got ER blockhash via getBlockhashForAccounts");
      }
    } catch (err) {
      console.warn("[PER/TEE] getBlockhashForAccounts failed, using standard:", err);
    }
  }

  if (!blockhash) {
    const bh = await conn.getLatestBlockhash();
    blockhash = bh.blockhash;
    lastValidBlockHeight = bh.lastValidBlockHeight;
    console.log("[PER/TEE] Got blockhash via getLatestBlockhash");
  }

  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  // Sign via wallet adapter
  const wallet = (program.provider as AnchorProvider).wallet;
  const signed = await wallet.signTransaction(tx);

  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  console.log("[PER/TEE] tx sent:", sig);
  return sig;
}

/** Step 4 (PER/TEE): Place a sealed bid */
export async function placeBid(
  program: Program,
  bidder: PublicKey,
  auctionPda: PublicKey,
  amount: BN
): Promise<string> {
  const bidPda = getBidPda(auctionPda, bidder);

  const tx = await program.methods
    .placeBid(amount)
    .accounts({
      bidder,
      auction: auctionPda,
      bid: bidPda,
    })
    .transaction();

  const sig = await sendToER(program, tx, bidder);
  console.log("[PER/TEE] place_bid tx:", sig);
  return sig;
}

/** Step 5 (PER/TEE): Close auction — computes winner in TEE, commits to L1 */
export async function closeAuction(
  program: Program,
  payer: PublicKey,
  auctionPda: PublicKey,
  bidders: PublicKey[]
): Promise<string> {
  const bidAccounts = bidders.map((b) => ({
    pubkey: getBidPda(auctionPda, b),
    isSigner: false,
    isWritable: false,
  }));

  const tx = await program.methods
    .closeAuction()
    .accounts({
      payer,
      auction: auctionPda,
    })
    .remainingAccounts(bidAccounts)
    .transaction();

  const sig = await sendToER(program, tx, payer);
  console.log("[PER/TEE] close_auction tx:", sig);
  return sig;
}

/** Step 6 (L1): Settle auction — winner pays */
export async function settleAuction(
  program: Program,
  winner: PublicKey,
  seller: PublicKey,
  auctionPda: PublicKey
): Promise<string> {
  const tx = await program.methods
    .settleAuction()
    .accounts({
      winner,
      seller,
      auction: auctionPda,
    })
    .rpc({ commitment: "confirmed" });

  console.log("[L1] settle_auction tx:", tx);
  return tx;
}

// ─── Fetch Auction State ──────────────────────────────────────────────────────

export async function fetchAuction(
  program: Program,
  auctionPda: PublicKey
): Promise<AuctionState | null> {
  try {
    const data = await program.account.auction.fetch(auctionPda);
    return data as unknown as AuctionState;
  } catch {
    return null;
  }
}

export interface AuctionState {
  seller: PublicKey;
  title: string;
  reservePrice: BN;
  startTime: BN;
  endTime: BN;
  bidCount: number;
  status: { created?: {}; delegated?: {}; closed?: {}; settled?: {} };
  winner: PublicKey;
  winningBid: BN;
  auctionId: BN;
  bump: number;
  bidders: PublicKey[];
}
