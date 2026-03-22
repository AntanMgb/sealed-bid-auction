use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::state::{Auction, AuctionStatus, AUCTION_SEED, NFT_ESCROW_SEED, MAX_TITLE_LEN};
use crate::errors::AuctionError;

/// Creates an auction on L1 and escrows the seller's NFT.
/// After creation, the seller calls `delegate_auction` to move the auction to TEE.
/// The NFT escrow stays on L1 — only the Auction PDA is delegated.
pub fn handler(
    ctx: Context<CreateAuction>,
    auction_id: u64,
    reserve_price: u64,
    duration_seconds: i64,
    title: String,
    escrow_amount: u64,
) -> Result<()> {
    require!(title.len() <= MAX_TITLE_LEN, AuctionError::TitleTooLong);
    require!(duration_seconds > 0, AuctionError::AuctionStillActive);
    require!(escrow_amount > 0, AuctionError::InvalidEscrowAmount);

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
    auction.nft_mint = ctx.accounts.nft_mint.key();
    auction.escrow_amount = escrow_amount;
    auction.settle_deadline = 0;
    auction.bump = ctx.bumps.auction;
    auction.bidders = Vec::new();

    // Transfer NFT from seller to escrow (PDA-owned token account)
    let cpi_accounts = Transfer {
        from: ctx.accounts.seller_nft_account.to_account_info(),
        to: ctx.accounts.escrow_nft_account.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, escrow_amount)?;

    emit!(AuctionCreated {
        auction: auction.key(),
        seller: ctx.accounts.seller.key(),
        auction_id,
        reserve_price,
        end_time: auction.end_time,
        title: auction.title.clone(),
        nft_mint: ctx.accounts.nft_mint.key(),
    });

    msg!(
        "Auction {} created. NFT {} escrowed. Reserve: {} lamports. Ends at: {}",
        auction_id,
        ctx.accounts.nft_mint.key(),
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

    /// The NFT mint being auctioned
    pub nft_mint: Account<'info, Mint>,

    /// Seller's token account holding the NFT
    #[account(
        mut,
        constraint = seller_nft_account.owner == seller.key(),
        constraint = seller_nft_account.mint == nft_mint.key(),
        constraint = seller_nft_account.amount >= 1 @ AuctionError::TokenNotOwned,
    )]
    pub seller_nft_account: Account<'info, TokenAccount>,

    /// Escrow token account — PDA-owned, holds the NFT during the auction.
    /// Authority is the Auction PDA so the program can transfer it out later.
    #[account(
        init,
        payer = seller,
        token::mint = nft_mint,
        token::authority = auction,
        seeds = [NFT_ESCROW_SEED, seller.key().as_ref(), &auction_id.to_le_bytes()],
        bump,
    )]
    pub escrow_nft_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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
    pub nft_mint: Pubkey,
}
