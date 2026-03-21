use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use crate::state::{Auction, AuctionStatus, Bid, AUCTION_SEED, BID_SEED};
use crate::errors::AuctionError;

/// Creates an empty Bid PDA on L1.
/// Must be called BEFORE `delegate_bid` and `place_bid`.
/// The ER does not allow `init` (account creation) directly —
/// accounts must be created on L1 first.
pub fn handler(ctx: Context<InitBid>) -> Result<()> {
    require!(
        ctx.accounts.auction.status == AuctionStatus::Delegated
            || ctx.accounts.auction.status == AuctionStatus::Created,
        AuctionError::NotDelegated
    );

    let bid = &mut ctx.accounts.bid;
    bid.auction = ctx.accounts.auction.key();
    bid.bidder = ctx.accounts.bidder.key();
    bid.amount = 0;
    bid.timestamp = 0;
    bid.bump = ctx.bumps.bid;

    msg!(
        "Bid PDA created for bidder {} on auction {}",
        ctx.accounts.bidder.key(),
        ctx.accounts.auction.key()
    );

    Ok(())
}

/// Delegates the Bid PDA to the PER/TEE.
/// Called on L1 after `init_bid`.
/// Pass the TEE validator as `remaining_accounts[0]`.
pub fn delegate_handler(ctx: Context<DelegateBid>) -> Result<()> {
    let auction_key = ctx.accounts.auction.key();
    let bidder_key = ctx.accounts.bidder.key();

    ctx.accounts.delegate_bid(
        &ctx.accounts.bidder,
        &[
            BID_SEED,
            auction_key.as_ref(),
            bidder_key.as_ref(),
        ],
        DelegateConfig {
            validator: ctx.remaining_accounts.first().map(|a| a.key()),
            ..Default::default()
        },
    )?;

    msg!(
        "Bid PDA delegated for bidder {} on auction {}",
        bidder_key,
        auction_key
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        seeds = [
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction.auction_id.to_le_bytes(),
        ],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

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

#[delegate]
#[derive(Accounts)]
pub struct DelegateBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    #[account(
        seeds = [
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction.auction_id.to_le_bytes(),
        ],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    /// CHECK: The Bid PDA to delegate. Already initialized by init_bid.
    #[account(mut, del)]
    pub bid: AccountInfo<'info>,
}
