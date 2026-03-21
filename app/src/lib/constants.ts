import { PublicKey } from "@solana/web3.js";

// ─── Program ─────────────────────────────────────────────────────────────────
// TODO: Replace with your real program ID after `anchor deploy`
// Temporary placeholder (System Program) so the UI loads without errors
export const PROGRAM_ID = new PublicKey(
  "5bnJuoZoBWCURr3hh3qYsBiD9jiQiL5vbMXTJS5VFXVy"
);

// ─── MagicBlock ──────────────────────────────────────────────────────────────

/** Standard Solana devnet RPC */
export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";

/**
 * Magic Router — routes transactions to the right layer (L1 or ER)
 * automatically based on whether the account is delegated.
 */
export const MAGIC_ROUTER_RPC = "https://devnet-router.magicblock.app";
export const MAGIC_ROUTER_WSS = "wss://devnet-router.magicblock.app/";

/**
 * Private Ephemeral Rollup (TEE) endpoint.
 * Uses local API proxy (/api/tee) to bypass CORS restrictions
 * when running from Codespaces or other non-localhost origins.
 */
export const TEE_RPC_BASE = typeof window !== "undefined"
  ? `${window.location.origin}/api/tee`
  : "https://tee.magicblock.app";

// ─── Validators ──────────────────────────────────────────────────────────────

/**
 * TEE validator devnet public key (Intel TDX-backed).
 * Pass this as remaining_accounts[0] to `delegate_auction`.
 */
export const TEE_VALIDATOR_DEVNET = new PublicKey(
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA"
);

// ─── Programs ────────────────────────────────────────────────────────────────

/** MagicBlock Permission Program — manages PER account access groups */
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);

/** MagicBlock Delegation Program */
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

// ─── PDA Seeds ───────────────────────────────────────────────────────────────
export const AUCTION_SEED = Buffer.from("auction");
export const BID_SEED = Buffer.from("bid");
export const PERM_GROUP_SEED = Buffer.from("perm_group");
