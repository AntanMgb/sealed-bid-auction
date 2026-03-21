use anchor_lang::prelude::*;
use crate::state::{Auction, AuctionStatus, Bid, AUCTION_SEED, BID_SEED, MAX_BIDDERS};
use crate::errors::AuctionError;

/// Places a sealed bid on the Private Ephemeral Rollup (TEE).
///
/// This instruction MUST be called via the TEE endpoint:
///   https://tee.magicblock.app?token={authToken}
///
/// Privacy guarantees:
///   - The `amount` field is stored in a Bid PDA on PER, NOT on L1
///   - The Permission Group (created by `create_bid_permission`) restricts
///     RPC read access so only the bidder can query their own bid amount
///   - The TEE reads all bids during `close_auction` to compute the winner
///   - No bid amount is ever visible on the public Solana state
///
/// What IS public (real-time visible via PER):
///   - That a bid was placed (bid_count increments)
///   - The bidder's wallet address (added to auction.bidders list)
///   - The timestamp of each bid
pub fn handler(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
    let auction = &mut ctx.accounts.auction;

    require!(
        auction.status == AuctionStatus::Delegated,
        AuctionError::NotDelegated
    );
    require!(auction.is_accepting_bids(), AuctionError::BiddingClosed);
    require!(
        amount >= auction.reserve_price,
        AuctionError::BidBelowReserve
    );
    require!(
        !auction.bidders.contains(&ctx.accounts.bidder.key()),
        AuctionError::AlreadyBid
    );
    require!(
        auction.bidders.len() < MAX_BIDDERS,
        AuctionError::MaxBiddersReached
    );

    // Create the private Bid PDA on PER
    let bid = &mut ctx.accounts.bid;
    let clock = Clock::get()?;

    bid.auction = auction.key();
    bid.bidder = ctx.accounts.bidder.key();
    bid.amount = amount; // ← stored privately in TEE, permission-gated
    bid.timestamp = clock.unix_timestamp;
    bid.bump = ctx.bumps.bid;

    // Update public auction state (real-time visible on PER connection)
    auction.bidders.push(ctx.accounts.bidder.key());
    auction.bid_count += 1;

    // Emit public event (no amount — only existence of bid)
    emit!(BidPlaced {
        auction: auction.key(),
        bidder: ctx.accounts.bidder.key(),
        bid_count: auction.bid_count,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Sealed bid placed by {} on auction {}. Total bids: {}",
        ctx.accounts.bidder.key(),
        auction.key(),
        auction.bid_count
    );

    Ok(())
}

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        mut,
        seeds = [
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction.auction_id.to_le_bytes(),
        ],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    /// Private Bid PDA — created on PER, protected by Permission Group.
    /// Only the bidder can read `amount` via TEE RPC; the TEE program can
    /// read it during `close_auction` to compute the winner.
    #[account(
        init,
        payer = bidder,
        space = Bid::LEN,
        seeds = [BID_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub bid: Account<'info, Bid>,

    pub system_program: Program<'info, System>,
}

/// Public event emitted per bid — NO amount included.
/// Subscribers to the PER WebSocket see this in real-time, confirming
/// "a sealed bid was received" without revealing anything about the amount.
#[event]
pub struct BidPlaced {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub bid_count: u32,
    pub timestamp: i64,
}
