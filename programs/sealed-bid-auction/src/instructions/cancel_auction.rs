use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::{Auction, AuctionStatus, AUCTION_SEED, NFT_ESCROW_SEED};
use crate::errors::AuctionError;

/// Cancel auction and return escrowed tokens to the seller.
///
/// **Permissionless** — anyone can call this (crank pattern) when:
///   - Auction is Closed AND no winner (no bids above reserve), OR
///   - Auction is Closed AND winner exists but settle_deadline has passed
///     (winner didn't pay within 15 minutes)
///
/// The frontend auto-detects expired deadlines and sends this transaction.
pub fn handler(ctx: Context<CancelAuction>) -> Result<()> {
    // Extract values before mutable/immutable borrow conflicts
    let status = ctx.accounts.auction.status;
    let auction_winner = ctx.accounts.auction.winner;
    let settle_deadline = ctx.accounts.auction.settle_deadline;
    let auction_id = ctx.accounts.auction.auction_id;
    let seller = ctx.accounts.auction.seller;
    let escrow_amount = ctx.accounts.auction.escrow_amount;
    let nft_mint = ctx.accounts.auction.nft_mint;
    let bump = ctx.accounts.auction.bump;

    require!(
        status == AuctionStatus::Closed,
        AuctionError::NotClosed
    );

    let no_winner = auction_winner == Pubkey::default();
    let deadline_expired = settle_deadline > 0 && {
        let clock = Clock::get()?;
        clock.unix_timestamp >= settle_deadline
    };

    require!(
        no_winner || deadline_expired,
        AuctionError::SettleDeadlineNotReached
    );

    // Transfer tokens from escrow back to seller (Auction PDA signs)
    let auction_id_bytes = auction_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        AUCTION_SEED,
        seller.as_ref(),
        &auction_id_bytes,
        &[bump],
    ];
    let signer_seeds = &[seeds];

    let transfer_tokens = Transfer {
        from: ctx.accounts.escrow_token_account.to_account_info(),
        to: ctx.accounts.seller_token_account.to_account_info(),
        authority: ctx.accounts.auction.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_tokens,
            signer_seeds,
        ),
        escrow_amount,
    )?;

    // Close escrow token account — rent returned to seller
    let close_escrow = CloseAccount {
        account: ctx.accounts.escrow_token_account.to_account_info(),
        destination: ctx.accounts.seller.to_account_info(),
        authority: ctx.accounts.auction.to_account_info(),
    };
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        close_escrow,
        signer_seeds,
    ))?;

    ctx.accounts.auction.status = AuctionStatus::Cancelled;

    let auction_key = ctx.accounts.auction.key();
    msg!(
        "Auction {} cancelled. {} tokens ({}) returned to seller {}.",
        auction_key,
        escrow_amount,
        nft_mint,
        seller
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CancelAuction<'info> {
    /// Anyone can crank this — pays tx fee only
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The seller — receives tokens back + escrow rent refund.
    /// Validated against auction.seller via constraint.
    #[account(
        mut,
        constraint = seller.key() == auction.seller @ AuctionError::NotSeller,
    )]
    pub seller: UncheckedAccount<'info>,

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

    /// Escrow token account holding the tokens/NFT
    #[account(
        mut,
        seeds = [NFT_ESCROW_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump,
        constraint = escrow_token_account.mint == auction.nft_mint,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Seller's token account to receive tokens back
    #[account(
        mut,
        constraint = seller_token_account.owner == auction.seller,
        constraint = seller_token_account.mint == auction.nft_mint,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
