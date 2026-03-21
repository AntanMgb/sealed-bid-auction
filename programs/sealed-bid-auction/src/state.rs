use anchor_lang::prelude::*;

// ─── Seeds ───────────────────────────────────────────────────────────────────
pub const AUCTION_SEED: &[u8] = b"auction";
pub const BID_SEED: &[u8] = b"bid";
pub const PERM_GROUP_SEED: &[u8] = b"perm_group";

// ─── Limits ──────────────────────────────────────────────────────────────────
pub const MAX_TITLE_LEN: usize = 64;
/// Maximum concurrent bidders per auction (expandable in production)
pub const MAX_BIDDERS: usize = 100;

// ─── Auction ─────────────────────────────────────────────────────────────────

/// State stored on-chain (L1 before/after delegation, PER during active bidding).
/// While delegated to the Private Ephemeral Rollup (TEE), only `bid_count` and
/// `status` are visible in real-time via the ER connection. Bid amounts live
/// in private `Bid` PDAs, accessible only to each bidder via the Permission
/// Program's access-control groups.
#[account]
pub struct Auction {
    /// Seller's wallet — only they can close + settle
    pub seller: Pubkey,
    /// Human-readable title shown in the UI
    pub title: String,
    /// Minimum winning bid (in lamports)
    pub reserve_price: u64,
    /// Unix timestamp: auction start
    pub start_time: i64,
    /// Unix timestamp: bidding deadline
    pub end_time: i64,
    /// Number of bids placed so far (public, real-time visible on PER)
    pub bid_count: u32,
    /// State machine: Created → Delegated → Closed → Settled
    pub status: AuctionStatus,
    /// Populated by close_auction running inside TEE
    pub winner: Pubkey,
    /// Winning amount in lamports (revealed after TEE computation)
    pub winning_bid: u64,
    /// Unique auction ID used in PDA derivation
    pub auction_id: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Public list of *who* bid (not amounts). Allows close_auction to derive
    /// each Bid PDA without storing amounts in the auction state.
    pub bidders: Vec<Pubkey>,
}

impl Auction {
    pub const LEN: usize = 8                      // discriminator
        + 32                                       // seller
        + (4 + MAX_TITLE_LEN)                      // title
        + 8                                        // reserve_price
        + 8                                        // start_time
        + 8                                        // end_time
        + 4                                        // bid_count
        + 2                                        // status (enum)
        + 32                                       // winner
        + 8                                        // winning_bid
        + 8                                        // auction_id
        + 1                                        // bump
        + (4 + 32 * MAX_BIDDERS);                  // bidders vec

    pub fn is_accepting_bids(&self) -> bool {
        let clock = Clock::get().unwrap();
        // Accept both Created and Delegated: the #[delegate] macro doesn't update
        // the status field, so the TEE copy still has status=Created.
        (self.status == AuctionStatus::Delegated || self.status == AuctionStatus::Created)
            && clock.unix_timestamp < self.end_time
    }

    pub fn is_expired(&self) -> bool {
        let clock = Clock::get().unwrap();
        clock.unix_timestamp >= self.end_time
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum AuctionStatus {
    /// Auction created on L1, not yet in PER
    Created,
    /// Delegated to Private ER (TEE) — accepting private bids
    Delegated,
    /// Winner computed inside TEE, committed back to L1
    Closed,
    /// Fully settled — item/funds transferred
    Settled,
}

// ─── Bid ─────────────────────────────────────────────────────────────────────

/// Private bid account. Lives on the Private Ephemeral Rollup (TEE).
/// The Permission Program restricts RPC read access to this PDA so that only
/// the bidder can query their own amount. The TEE can read all bids during
/// winner computation (close_auction instruction).
#[account]
pub struct Bid {
    /// Parent auction
    pub auction: Pubkey,
    /// The bidder's wallet
    pub bidder: Pubkey,
    /// Bid amount in lamports — PRIVATE (permission-gated via PER middleware)
    pub amount: u64,
    /// When the bid was placed
    pub timestamp: i64,
    /// PDA bump seed
    pub bump: u8,
}

impl Bid {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}
