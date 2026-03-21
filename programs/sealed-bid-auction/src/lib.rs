use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("5bnJuoZoBWCURr3hh3qYsBiD9jiQiL5vbMXTJS5VFXVy");

/// # Sealed-Bid Auction on MagicBlock Private Ephemeral Rollups
///
/// Full flow:
///
/// ## L1 (Solana Devnet)
/// 1. `create_auction`         — Seller initialises the auction
/// 2. `create_bid_permission`  — Each bidder sets up a privacy group (pre-bid)
/// 3. `delegate_auction`       — Seller moves the auction to the TEE (PER)
///
/// ## PER / TEE (https://tee.magicblock.app)
/// 4. `place_bid`              — Bidder submits a sealed bid (amount hidden)
///      • bid_count visible in real-time via PER WebSocket
///      • bid amount stored in private Bid PDA, permission-gated
/// 5. `close_auction`          — Anyone calls after expiry
///      • Runs entirely inside Intel TDX enclave
///      • Iterates ALL private Bid PDAs, finds highest ≥ reserve
///      • Writes winner to auction state
///      • `commit_and_undelegate` → signed by TEE validator → committed to L1
///
/// ## L1 (after TEE commit)
/// 6. `settle_auction`         — Winner pays and auction is marked complete
///
/// Verifiability:
///   The commit transaction from step 5 is signed by the TEE validator
///   (FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA on devnet), which is
///   publicly attested to run inside an Intel TDX Trust Domain.
///   Anyone can verify: winner was computed fairly, no floor manipulation,
///   no sniping, no insider info.
#[ephemeral]
#[program]
pub mod sealed_bid_auction {
    use super::*;

    // ── L1 ──────────────────────────────────────────────────────────────────

    /// Create a new sealed-bid auction on L1.
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        auction_id: u64,
        reserve_price: u64,
        duration_seconds: i64,
        title: String,
    ) -> Result<()> {
        create_auction::handler(ctx, auction_id, reserve_price, duration_seconds, title)
    }

    /// Create a Permission Group for a bidder's future Bid PDA.
    /// Called on L1 before the bidder places their bid on PER.
    /// Restricts RPC read access so only the bidder can query their amount.
    pub fn create_bid_permission(ctx: Context<CreateBidPermission>) -> Result<()> {
        create_bid_permission::handler(ctx)
    }

    /// Delegate the auction account to the Private Ephemeral Rollup (TEE).
    /// Pass the same auction_id used in create_auction.
    /// After this, bids are accepted at the TEE endpoint, not on L1.
    pub fn delegate_auction(ctx: Context<DelegateAuction>, auction_id: u64) -> Result<()> {
        delegate::handler(ctx, auction_id)
    }

    // ── PER / TEE ────────────────────────────────────────────────────────────

    /// Place a sealed bid. MUST be sent to the TEE endpoint.
    /// The bid amount is stored in a private Bid PDA on PER — never on L1.
    /// Only the `bid_count` on the auction state updates (publicly visible).
    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        place_bid::handler(ctx, amount)
    }

    /// Close the auction and compute the winner inside the TEE.
    /// Pass all Bid PDAs as remaining_accounts.
    /// Automatically commits result to L1 with TEE attestation.
    pub fn close_auction(ctx: Context<CloseAuction>) -> Result<()> {
        close_auction::handler(ctx)
    }

    // ── L1 (post-TEE) ────────────────────────────────────────────────────────

    /// Settle the auction — winner pays, auction marked complete.
    /// By this point the winner and winning_bid are already on L1,
    /// committed by the TEE with a verifiable attestation.
    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        settle::handler(ctx)
    }
}
