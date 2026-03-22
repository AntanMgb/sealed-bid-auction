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
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM,
  MAGIC_CONTEXT,
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

// ─── Delegation PDA Helpers ───────────────────────────────────────────────────

function getDelegationPdas(accountToDelegate: PublicKey) {
  // buffer PDA is derived from the OWNER program, not the delegation program
  // See: delegateBufferPdaFromDelegatedAccountAndOwnerProgram in SDK
  const [buffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), accountToDelegate.toBytes()],
    PROGRAM_ID
  );
  const [delegationRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), accountToDelegate.toBytes()],
    DELEGATION_PROGRAM_ID
  );
  const [delegationMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), accountToDelegate.toBytes()],
    DELEGATION_PROGRAM_ID
  );
  return { buffer, delegationRecord, delegationMetadata };
}

// ─── Program Client ───────────────────────────────────────────────────────────

export function getProgram(provider: AnchorProvider): Program {
  return new Program(IDL as unknown as anchor.Idl, provider);
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
  const { buffer, delegationRecord, delegationMetadata } =
    getDelegationPdas(auctionPda);

  const tx = await program.methods
    .delegateAuction(auctionId)
    .accounts({
      payer: seller,
      auction: auctionPda,
      buffer,
      delegationRecord,
      delegationMetadata,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: TEE_VALIDATOR_DEVNET, isSigner: false, isWritable: false },
    ])
    .rpc({ commitment: "confirmed" });

  console.log("[L1] delegate_auction tx:", tx);
  return tx;
}

/** Step 3b (L1): Create empty Bid PDA */
export async function initBid(
  program: Program,
  bidder: PublicKey,
  auctionPda: PublicKey
): Promise<string> {
  const bidPda = getBidPda(auctionPda, bidder);

  const tx = await program.methods
    .initBid()
    .accounts({
      bidder,
      auction: auctionPda,
      bid: bidPda,
    })
    .rpc({ commitment: "confirmed" });

  console.log("[L1] init_bid tx:", tx);
  return tx;
}

/** Step 3c (L1): Delegate Bid PDA to TEE */
export async function delegateBid(
  program: Program,
  bidder: PublicKey,
  auctionPda: PublicKey
): Promise<string> {
  const bidPda = getBidPda(auctionPda, bidder);
  const { buffer, delegationRecord, delegationMetadata } =
    getDelegationPdas(bidPda);

  const tx = await program.methods
    .delegateBid()
    .accounts({
      bidder,
      auction: auctionPda,
      bid: bidPda,
      buffer,
      delegationRecord,
      delegationMetadata,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: TEE_VALIDATOR_DEVNET, isSigner: false, isWritable: false },
    ])
    .rpc({ commitment: "confirmed" });

  console.log("[L1] delegate_bid tx:", tx);
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

  // Check transaction status after a short delay
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const status = await conn.getSignatureStatuses([sig]);
    console.log("[PER/TEE] tx status:", JSON.stringify(status.value));
    const txDetail = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txDetail?.meta?.err) {
      console.error("[PER/TEE] tx ERROR:", JSON.stringify(txDetail.meta.err));
      console.log("[PER/TEE] tx logs:", txDetail.meta.logMessages);
    } else if (txDetail) {
      console.log("[PER/TEE] tx SUCCESS, logs:", txDetail.meta?.logMessages);
    } else {
      console.warn("[PER/TEE] tx not found on ER (may still be processing)");
    }
  } catch (err) {
    console.warn("[PER/TEE] Could not check tx status:", err);
  }

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
      magicContext: MAGIC_CONTEXT,
      magicProgram: MAGIC_PROGRAM,
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
    // Try standard fetch first (works when our program owns the account)
    const data = await (program.account as any).auction.fetch(auctionPda);
    return data as unknown as AuctionState;
  } catch {
    // After delegation, the Delegation Program owns the account on L1.
    // Anchor's fetch() rejects it (owner mismatch). Decode raw data instead.
    try {
      const conn = program.provider.connection;
      const accountInfo = await conn.getAccountInfo(auctionPda);
      if (!accountInfo?.data) return null;
      const decoded = program.coder.accounts.decode("auction", accountInfo.data);
      return decoded as unknown as AuctionState;
    } catch {
      return null;
    }
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

/** Fetch all auction accounts from L1 */
export async function fetchAllAuctions(
  program: Program
): Promise<{ publicKey: PublicKey; account: AuctionState }[]> {
  try {
    const all = await (program.account as any).auction.all();
    return all.map((a: any) => ({
      publicKey: a.publicKey,
      account: a.account as AuctionState,
    }));
  } catch {
    // Fallback: fetch raw program accounts and decode manually
    try {
      const conn = program.provider.connection;
      const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: 3340 }], // approximate Auction account size
      });
      const results: { publicKey: PublicKey; account: AuctionState }[] = [];
      for (const { pubkey, account } of accounts) {
        try {
          const decoded = program.coder.accounts.decode("auction", account.data);
          results.push({ publicKey: pubkey, account: decoded as unknown as AuctionState });
        } catch {
          // skip non-auction accounts
        }
      }
      return results;
    } catch {
      return [];
    }
  }
}
