/**
 * Anchor program client helpers.
 * Wraps all instruction calls with proper account derivation and connection routing.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
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
    .rpc({ commitment: "confirmed" });

  console.log("[PER/TEE] place_bid tx:", tx);
  return tx;
}

/** Step 5 (PER/TEE): Close auction — computes winner in TEE, commits to L1 */
export async function closeAuction(
  program: Program,
  payer: PublicKey,
  auctionPda: PublicKey,
  bidders: PublicKey[]
): Promise<string> {
  // Derive all Bid PDAs to pass as remaining_accounts
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
    .rpc({ commitment: "confirmed" });

  console.log("[PER/TEE] close_auction tx:", tx);
  return tx;
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
