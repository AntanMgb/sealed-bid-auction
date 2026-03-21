use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use crate::state::{Auction, AuctionStatus, Bid, AUCTION_SEED, BID_SEED};
use crate::errors::AuctionError;

/// Closes the auction and computes the winner — runs ENTIRELY INSIDE the TEE.
///
/// This is the core privacy-preserving computation:
///   1. Reads every private Bid PDA (passed as remaining_accounts)
///   2. Finds the highest valid bid (≥ reserve price)
///   3. Writes winner + winning_bid to the auction state
///   4. Calls `commit_and_undelegate_accounts` to atomically:
///        a. Serialize the final auction state
///        b. Sign the commit with the TEE validator key (Intel TDX attestation)
///        c. Submit the commit transaction to L1
///        d. Return the auction account to its owner
///
/// After this call, anyone can verify on L1:
///   - The winner pubkey and winning bid amount
///   - The commit was signed by the TEE validator (FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA)
///   - The TDX remote attestation quote proving the validator runs in an Intel enclave
///
/// "Winner computed in a TEE, committed onchain with a verifiable result."
///
/// MUST be called via: https://tee.magicblock.app?token={authToken}
/// Pass all Bid PDAs as `remaining_accounts` (derive from auction.bidders list).
pub fn handler(ctx: Context<CloseAuction>) -> Result<()> {
    let auction = &mut ctx.accounts.auction;

    require!(
        auction.status == AuctionStatus::Delegated,
        AuctionError::NotDelegated
    );
    require!(
        auction.is_expired(),
        AuctionError::AuctionStillActive
    );

    // ─── Winner Computation (inside TEE) ────────────────────────────────────
    // Iterate all Bid PDAs passed as remaining_accounts.
    // The TEE can read these even though they are permission-gated for external
    // callers — this instruction runs inside the secure enclave.

    let mut highest_bid: u64 = 0;
    let mut winner = Pubkey::default();

    let auction_key = auction.key();
    let program_id = &crate::ID;

    for bid_account_info in ctx.remaining_accounts.iter() {
        // Deserialise and validate each Bid PDA
        let bid = Account::<Bid>::try_from(bid_account_info)
            .map_err(|_| error!(AuctionError::NotClosed))?;

        // Verify this bid PDA belongs to this auction
        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                BID_SEED,
                auction_key.as_ref(),
                bid.bidder.as_ref(),
            ],
            program_id,
        );
        if bid_account_info.key() != expected_pda {
            continue; // Skip malformed accounts
        }

        // Find the highest valid bid
        if bid.amount > highest_bid && bid.amount >= auction.reserve_price {
            highest_bid = bid.amount;
            winner = bid.bidder;
        }
    }

    if winner == Pubkey::default() {
        // No valid bids above reserve — auction fails
        auction.status = AuctionStatus::Closed;
        auction.winner = Pubkey::default();
        auction.winning_bid = 0;

        emit!(AuctionClosed {
            auction: auction_key,
            winner: None,
            winning_bid: 0,
            bid_count: auction.bid_count,
            success: false,
        });

        msg!("Auction {} closed with no winner (no bids above reserve).", auction_key);
    } else {
        auction.status = AuctionStatus::Closed;
        auction.winner = winner;
        auction.winning_bid = highest_bid;

        emit!(AuctionClosed {
            auction: auction_key,
            winner: Some(winner),
            winning_bid: highest_bid,
            bid_count: auction.bid_count,
            success: true,
        });

        msg!(
            "Auction {} closed. Winner: {}. Winning bid: {} lamports.",
            auction_key,
            winner,
            highest_bid
        );
    }

    // Serialize the updated auction state before committing
    auction.exit(&crate::ID)?;

    // ─── Commit + Undelegate (TEE → L1) ─────────────────────────────────────
    // This call:
    //   1. Bundles the final auction state into a Solana transaction
    //   2. Signs it with the TEE validator's key (Intel TDX-attested)
    //   3. Submits the transaction to Solana L1 — creates the verifiable proof
    //   4. Returns ownership of the auction account back to the program
    //
    // The signed commit transaction IS the "verifiable result":
    // anyone can check that it was signed by the TEE validator, whose key is
    // publicly attested to run inside an Intel TDX Trust Domain.
    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&ctx.accounts.auction.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    Ok(())
}

/// The `#[commit]` macro injects `magic_context` and `magic_program` accounts
/// required by `commit_and_undelegate_accounts`.
#[commit]
#[derive(Accounts)]
pub struct CloseAuction<'info> {
    /// Caller (seller or any crank — auction is expired and anyone can trigger)
    #[account(mut)]
    pub payer: Signer<'info>,

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

    // remaining_accounts: all Bid PDAs for this auction
    // Derive them client-side from auction.bidders:
    //   bidders.map(b => PublicKey.findProgramAddressSync(
    //     [Buffer.from("bid"), auctionPda.toBytes(), b.toBytes()], programId
    //   ))
}

/// Emitted on L1 as part of the TEE commit transaction.
/// This event is the public, verifiable proof of the TEE computation result.
#[event]
pub struct AuctionClosed {
    pub auction: Pubkey,
    pub winner: Option<Pubkey>,
    pub winning_bid: u64,
    pub bid_count: u32,
    pub success: bool,
}
