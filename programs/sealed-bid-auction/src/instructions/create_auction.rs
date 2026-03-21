use anchor_lang::prelude::*;
use crate::state::{Auction, AuctionStatus, AUCTION_SEED, MAX_TITLE_LEN};
use crate::errors::AuctionError;

/// Creates an auction on L1.
/// After creation, the seller calls `delegate_auction` to move it to the TEE.
pub fn handler(
    ctx: Context<CreateAuction>,
    auction_id: u64,
    reserve_price: u64,
    duration_seconds: i64,
    title: String,
) -> Result<()> {
    require!(title.len() <= MAX_TITLE_LEN, AuctionError::TitleTooLong);
    require!(duration_seconds > 0, AuctionError::AuctionStillActive);

    let auction = &mut ctx.accounts.auction;
    let clock = Clock::get()?;

    auction.seller = ctx.accounts.seller.key();
    auction.title = title;
    auction.reserve_price = reserve_price;
    auction.start_time = clock.unix_timestamp;
    auction.end_time = clock.unix_timestamp + duration_seconds;
    auction.bid_count = 0;
    auction.status = AuctionStatus::Created;
    auction.winner = Pubkey::default();
    auction.winning_bid = 0;
    auction.auction_id = auction_id;
    auction.bump = ctx.bumps.auction;
    auction.bidders = Vec::new();

    emit!(AuctionCreated {
        auction: auction.key(),
        seller: ctx.accounts.seller.key(),
        auction_id,
        reserve_price,
        end_time: auction.end_time,
        title: auction.title.clone(),
    });

    msg!(
        "Auction {} created. Reserve: {} lamports. Ends at: {}",
        auction_id,
        reserve_price,
        auction.end_time
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        init,
        payer = seller,
        space = Auction::LEN,
        seeds = [AUCTION_SEED, seller.key().as_ref(), &auction_id.to_le_bytes()],
        bump
    )]
    pub auction: Account<'info, Auction>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct AuctionCreated {
    pub auction: Pubkey,
    pub seller: Pubkey,
    pub auction_id: u64,
    pub reserve_price: u64,
    pub end_time: i64,
    pub title: String,
}
