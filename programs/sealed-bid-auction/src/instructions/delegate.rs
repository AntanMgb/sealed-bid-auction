use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use crate::state::AUCTION_SEED;

/// TEE (Private ER) validator address on devnet.
/// This is the Intel TDX-backed validator that provides hardware-level privacy.
/// All bid computation and winner selection runs inside this enclave.
pub const TEE_VALIDATOR_DEVNET: &str = "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA";

/// Delegates the auction account to the Private Ephemeral Rollup running inside
/// Intel TDX. After this call:
///   - The auction account is "locked" on L1 (read-only)
///   - A clone of it lives on the PER where bids are accepted in real-time
///   - All state is hidden from external observers until commit_and_undelegate
///
/// Pass `auction_id` so the handler can derive the correct PDA seeds.
/// Pass the TEE validator as `remaining_accounts[0]`.
pub fn handler(ctx: Context<DelegateAuction>, auction_id: u64) -> Result<()> {
    let seller = ctx.accounts.payer.key();

    // Delegate to the TEE validator (Intel TDX Private ER).
    // remaining_accounts[0] = TEE validator pubkey (client passes it).
    ctx.accounts.delegate_auction(
        &ctx.accounts.payer,
        &[
            AUCTION_SEED,
            seller.as_ref(),
            &auction_id.to_le_bytes(),
        ],
        DelegateConfig {
            validator: ctx.remaining_accounts.first().map(|a| a.key()),
            ..Default::default()
        },
    )?;

    msg!(
        "Auction {} delegated to Private ER (TEE). Accepting private bids.",
        auction_id
    );

    Ok(())
}

/// The `#[delegate]` macro injects the required Delegation Program accounts
/// (delegation_record, delegation_metadata, delegation_program, buffer_program).
#[delegate]
#[derive(Accounts)]
pub struct DelegateAuction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The auction PDA to delegate. Seeds are validated in handler via
    /// the same derivation used in create_auction.
    #[account(mut, del)]
    pub auction: AccountInfo<'info>,
}
