use anchor_lang::prelude::*;
use crate::state::{Auction, AuctionStatus, AUCTION_SEED};
use crate::errors::AuctionError;

/// Final settlement — called on L1 after the TEE has committed the winner.
///
/// The winner sends the winning bid amount (SOL) and receives confirmation.
/// In production you'd transfer an escrowed NFT/token here; for this demo
/// the settlement confirms payment intent and marks the auction fully closed.
///
/// At this point the result is already on L1:
///   - `auction.winner` and `auction.winning_bid` are the TEE-computed values
///   - The commit transaction (from close_auction) is the cryptographic proof
pub fn handler(ctx: Context<SettleAuction>) -> Result<()> {
    let auction = &mut ctx.accounts.auction;

    require!(
        auction.status == AuctionStatus::Closed,
        AuctionError::NotClosed
    );
    require!(
        auction.winner != Pubkey::default(),
        AuctionError::NoWinner
    );
    require!(
        ctx.accounts.winner.key() == auction.winner,
        AuctionError::NotWinner
    );

    // Transfer winning bid (SOL) from winner to seller
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.winner.key(),
        &ctx.accounts.seller.key(),
        auction.winning_bid,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.winner.to_account_info(),
            ctx.accounts.seller.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    auction.status = AuctionStatus::Settled;

    emit!(AuctionSettled {
        auction: auction.key(),
        winner: auction.winner,
        seller: auction.seller,
        winning_bid: auction.winning_bid,
    });

    msg!(
        "Auction {} settled. Winner {} paid {} lamports to seller {}.",
        auction.key(),
        auction.winner,
        auction.winning_bid,
        auction.seller
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    /// The auction winner (must sign + pay)
    #[account(mut)]
    pub winner: Signer<'info>,

    /// The seller receives the funds
    /// CHECK: Validated against auction.seller inside the handler
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            AUCTION_SEED,
            auction.seller.as_ref(),
            &auction.auction_id.to_le_bytes(),
        ],
        bump = auction.bump,
        constraint = auction.seller == seller.key() @ AuctionError::NotSeller,
    )]
    pub auction: Account<'info, Auction>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct AuctionSettled {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub seller: Pubkey,
    pub winning_bid: u64,
}
