use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use crate::state::{Bid, BID_SEED};

/// Creates an empty Bid PDA on L1.
/// Must be called BEFORE `delegate_bid` and `place_bid`.
/// The ER does not allow `init` (account creation) directly —
/// accounts must be created on L1 first.
///
/// Note: `auction` is passed as UncheckedAccount because after delegation
/// its owner on L1 is the Delegation Program, not our program.
/// We only need auction.key() for the bid PDA seeds.
pub fn handler(ctx: Context<InitBid>) -> Result<()> {
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

    /// CHECK: The auction PDA. After delegation its owner is the Delegation
    /// Program on L1, so we cannot use Account<Auction>. We only need its
    /// key for the bid PDA seed derivation.
    pub auction: UncheckedAccount<'info>,

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

    /// CHECK: The auction PDA. Only needed for its key.
    pub auction: UncheckedAccount<'info>,

    /// CHECK: The Bid PDA to delegate. Already initialized by init_bid.
    #[account(mut, del)]
    pub bid: AccountInfo<'info>,
}
