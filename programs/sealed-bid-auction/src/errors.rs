use anchor_lang::prelude::*;

#[error_code]
pub enum AuctionError {
    #[msg("Auction is not in Created status")]
    NotCreated,
    #[msg("Auction is not delegated to PER")]
    NotDelegated,
    #[msg("Auction bidding is not open")]
    BiddingClosed,
    #[msg("Auction has not yet expired")]
    AuctionStillActive,
    #[msg("Auction has already expired")]
    AuctionExpired,
    #[msg("Bid amount is below the reserve price")]
    BidBelowReserve,
    #[msg("Bidder has already placed a bid")]
    AlreadyBid,
    #[msg("Auction is not closed (winner not yet computed)")]
    NotClosed,
    #[msg("No valid winner: all bids were below reserve price")]
    NoWinner,
    #[msg("Auction is already settled")]
    AlreadySettled,
    #[msg("Title exceeds maximum length of 64 characters")]
    TitleTooLong,
    #[msg("Maximum number of bidders reached")]
    MaxBiddersReached,
    #[msg("Caller is not the auction seller")]
    NotSeller,
    #[msg("Caller is not the auction winner")]
    NotWinner,
}
