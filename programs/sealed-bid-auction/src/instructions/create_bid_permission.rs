use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use crate::state::{Auction, AuctionStatus, AUCTION_SEED, BID_SEED, PERM_GROUP_SEED};
use crate::errors::AuctionError;

/// MagicBlock Permission Program (L1).
/// Manages fine-grained read-access groups for PER accounts.
/// See: https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/authorization
pub const PERMISSION_PROGRAM_ID: Pubkey =
    pubkey!("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");

/// Called on L1 BEFORE the bidder places their bid on PER.
///
/// Creates a Permission Group that restricts RPC read access to the bidder's
/// Bid PDA so that only the bidder can query their bid amount via the TEE
/// middleware. The TEE itself can still read all bids during winner computation.
///
/// Flow:
///   1. Derive the bid PDA that will be created on PER (deterministic)
///   2. Create a permission group owned by the bidder
///   3. Associate the future bid PDA with this group
///   4. PER middleware enforces: only group members (= bidder) can RPC-read it
pub fn handler(ctx: Context<CreateBidPermission>) -> Result<()> {
    require!(
        ctx.accounts.auction.status == AuctionStatus::Delegated,
        AuctionError::NotDelegated
    );
    require!(
        ctx.accounts.auction.is_accepting_bids(),
        AuctionError::BiddingClosed
    );

    // Derive the bid PDA that will be created when place_bid is called on PER
    let (bid_pda, _) = Pubkey::find_program_address(
        &[
            BID_SEED,
            ctx.accounts.auction.key().as_ref(),
            ctx.accounts.bidder.key().as_ref(),
        ],
        ctx.program_id,
    );

    // CPI to MagicBlock Permission Program
    // Creates a group with `bidder` as sole member, governing `bid_pda`
    //
    // ⚠️  The exact instruction discriminator and argument layout depend on
    //     the Permission Program's IDL. Fetch it with:
    //       anchor idl fetch ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1
    //     or check @magicblock-labs/ephemeral-rollups-sdk for typed helpers.
    //
    // Anchor discriminator = sha256("global:create_permission_group")[..8]
    let discriminator: [u8; 8] = {
        let hash = anchor_lang::solana_program::hash::hashv(&[
            b"global:create_permission_group",
        ]);
        hash.to_bytes()[..8].try_into().unwrap()
    };

    // Instruction args: (group_bump: u8, governed_account: Pubkey)
    let mut ix_data = discriminator.to_vec();
    ix_data.extend_from_slice(&ctx.bumps.permission_group.to_le_bytes());
    ix_data.extend_from_slice(bid_pda.as_ref());

    let accounts_meta = vec![
        AccountMeta::new(ctx.accounts.bidder.key(), true),
        AccountMeta::new(ctx.accounts.permission_group.key(), false),
        AccountMeta::new_readonly(bid_pda, false),
        AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: PERMISSION_PROGRAM_ID,
        accounts: accounts_meta,
        data: ix_data,
    };

    let perm_group_bump = ctx.bumps.permission_group;
    let auction_key = ctx.accounts.auction.key();
    let bidder_key = ctx.accounts.bidder.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        PERM_GROUP_SEED,
        auction_key.as_ref(),
        bidder_key.as_ref(),
        &[perm_group_bump],
    ]];

    invoke_signed(
        &ix,
        &[
            ctx.accounts.bidder.to_account_info(),
            ctx.accounts.permission_group.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    emit!(BidPermissionCreated {
        auction: ctx.accounts.auction.key(),
        bidder: ctx.accounts.bidder.key(),
        bid_pda,
        permission_group: ctx.accounts.permission_group.key(),
    });

    msg!(
        "Permission group created for bidder {} on auction {}",
        ctx.accounts.bidder.key(),
        ctx.accounts.auction.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CreateBidPermission<'info> {
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

    /// PDA that the Permission Program will initialise as the access-control group.
    /// Seeds are deterministic so the PER middleware can derive + verify on every RPC call.
    /// CHECK: Initialised by the Permission Program CPI; we only pass the address.
    #[account(
        mut,
        seeds = [PERM_GROUP_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub permission_group: UncheckedAccount<'info>,

    /// CHECK: MagicBlock Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct BidPermissionCreated {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub bid_pda: Pubkey,
    pub permission_group: Pubkey,
}
