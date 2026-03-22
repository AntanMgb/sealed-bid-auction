use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::{Auction, AuctionStatus, AUCTION_SEED, NFT_ESCROW_SEED};
use crate::errors::AuctionError;

/// Final settlement — called on L1 after the TEE has committed the winner.
///
/// Atomically:
///   1. Transfers SOL (winning bid) from winner to seller
///   2. Transfers NFT from escrow to winner
///   3. Closes the escrow token account (rent returned to seller)
///   4. Marks auction as Settled
pub fn handler(ctx: Context<SettleAuction>) -> Result<()> {
    // Extract all needed values before any mutable/immutable borrow conflicts
    let auction_status = ctx.accounts.auction.status;
    let auction_winner = ctx.accounts.auction.winner;
    let auction_seller = ctx.accounts.auction.seller;
    let winning_bid = ctx.accounts.auction.winning_bid;
    let auction_id = ctx.accounts.auction.auction_id;
    let escrow_amount = ctx.accounts.auction.escrow_amount;
    let bump = ctx.accounts.auction.bump;

    require!(
        auction_status == AuctionStatus::Closed,
        AuctionError::NotClosed
    );
    require!(
        auction_winner != Pubkey::default(),
        AuctionError::NoWinner
    );
    require!(
        ctx.accounts.winner.key() == auction_winner,
        AuctionError::NotWinner
    );

    // 1. Transfer SOL from winner to seller
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.winner.key(),
        &ctx.accounts.seller.key(),
        winning_bid,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.winner.to_account_info(),
            ctx.accounts.seller.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // 2. Transfer NFT from escrow to winner (Auction PDA signs)
    let auction_id_bytes = auction_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        AUCTION_SEED,
        auction_seller.as_ref(),
        &auction_id_bytes,
        &[bump],
    ];
    let signer_seeds = &[seeds];

    let transfer_nft = Transfer {
        from: ctx.accounts.escrow_nft_account.to_account_info(),
        to: ctx.accounts.winner_nft_account.to_account_info(),
        authority: ctx.accounts.auction.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_nft,
            signer_seeds,
        ),
        escrow_amount,
    )?;

    // 3. Close escrow token account — rent returned to seller
    let close_escrow = CloseAccount {
        account: ctx.accounts.escrow_nft_account.to_account_info(),
        destination: ctx.accounts.seller.to_account_info(),
        authority: ctx.accounts.auction.to_account_info(),
    };
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        close_escrow,
        signer_seeds,
    ))?;

    ctx.accounts.auction.status = AuctionStatus::Settled;

    let auction_key = ctx.accounts.auction.key();
    emit!(AuctionSettled {
        auction: auction_key,
        winner: auction_winner,
        seller: auction_seller,
        winning_bid,
    });

    msg!(
        "Auction {} settled. Winner {} paid {} lamports to seller {}. NFT transferred.",
        auction_key,
        auction_winner,
        winning_bid,
        auction_seller
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    /// The auction winner (must sign + pay)
    #[account(mut)]
    pub winner: Signer<'info>,

    /// The seller receives SOL + escrow rent refund
    /// CHECK: Validated against auction.seller in constraint below
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

    /// Escrow token account holding the NFT
    #[account(
        mut,
        seeds = [NFT_ESCROW_SEED, auction.seller.as_ref(), &auction.auction_id.to_le_bytes()],
        bump,
        constraint = escrow_nft_account.mint == auction.nft_mint,
    )]
    pub escrow_nft_account: Account<'info, TokenAccount>,

    /// Winner's token account for the NFT
    #[account(
        mut,
        constraint = winner_nft_account.owner == winner.key(),
        constraint = winner_nft_account.mint == auction.nft_mint,
    )]
    pub winner_nft_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AuctionSettled {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub seller: Pubkey,
    pub winning_bid: u64,
}
