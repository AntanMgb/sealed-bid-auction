# Deploy Guide — Sealed-Bid Auction (MagicBlock Private ER)

## Requirements

```bash
# Install exact versions required by MagicBlock SDK
solana --version   # 2.3.13
rustup --version   # 1.85.0
anchor --version   # 0.32.1
node --version     # 24.10.0
```

## 1. Deploy the Anchor Program

```bash
cd sealed-bid-auction

# Build
anchor build

# Get your program ID
solana-keygen pubkey target/deploy/sealed_bid_auction-keypair.json

# Update the ID in:
#   - programs/sealed-bid-auction/src/lib.rs  → declare_id!(...)
#   - Anchor.toml                              → [programs.devnet]
#   - app/src/idl/sealed_bid_auction.json      → metadata.address
#   - app/src/lib/constants.ts                 → PROGRAM_ID

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## 2. Copy IDL to frontend

```bash
cp target/idl/sealed_bid_auction.json app/src/idl/sealed_bid_auction.json
```

## 3. Start the frontend

```bash
cd app
npm install
npm run dev
```

Open http://localhost:3000

## 4. How to demo the full flow

### Seller
1. Connect wallet (Phantom, devnet)
2. Click **Create Auction** — fills title, reserve price, duration
3. Sign two transactions: create (L1) + delegate to TEE (L1)
4. Share the **Auction PDA** with bidders

### Bidders (at least 2 for a good demo)
1. Paste the Auction PDA in "Join Auction"
2. Click **Seal Bid in TEE** — enter bid amount (hidden from everyone)
3. Sign two transactions: permission setup (L1) + bid submission (TEE)
4. Watch the **Live Feed** show "🔒 New sealed bid received" in real-time
   - Note: bid count goes up, but amounts are NEVER shown

### After expiry
1. Click **Close & Reveal Winner (TEE)**
2. `close_auction` runs inside Intel TDX:
   - Reads all private bid PDAs
   - Finds highest bid ≥ reserve
   - Commits winner to L1
3. **ResultPanel** shows:
   - Winner pubkey + winning amount
   - TEE validator address (attested Intel TDX)
   - Commit transaction signature (verifiable proof)

### Winner
1. Click **Settle & Pay** to send the winning SOL to the seller

---

## Architecture

```
┌─────────────────── Solana L1 ───────────────────────┐
│  create_auction    →  Auction PDA (public metadata)  │
│  create_bid_permission → Permission Group (privacy)  │
│  delegate_auction  →  Lock auction to PER            │
│                                                      │
│  [TEE commits winner here with attestation]          │
│  settle_auction    →  Winner pays, auction closes    │
└──────────────────────────────────────────────────────┘
                          ↕ delegation / commit
┌─────────────── Private ER (Intel TDX) ──────────────┐
│  Auction account (delegated)                         │
│    bid_count: visible in real-time                   │
│    status:    visible in real-time                   │
│                                                      │
│  Bid PDAs (private, permission-gated)                │
│    amount:  ONLY the bidder can query                │
│    bidder:  public (who bid)                         │
│                                                      │
│  close_auction (runs in TEE):                        │
│    1. Reads ALL bid amounts (enclave access)         │
│    2. Finds max bid ≥ reserve                        │
│    3. commit_and_undelegate → L1 with TDX proof      │
└──────────────────────────────────────────────────────┘
```

## Key program addresses

| Name | Address |
|------|---------|
| MagicBlock Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| MagicBlock Permission Program | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |
| TEE Validator (devnet) | `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA` |
| Magic Router RPC | `https://devnet-router.magicblock.app` |
| TEE RPC | `https://tee.magicblock.app?token={authToken}` |

## Permission Program CPI note

The `create_bid_permission` instruction CPIs to the MagicBlock Permission Program
(`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`). The exact instruction
discriminator is computed as `sha256("global:create_permission_group")[..8]`.

If the instruction name differs, fetch the actual IDL:
```bash
anchor idl fetch ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 --provider.cluster devnet
```
And update `create_bid_permission.rs` accordingly, or ask in the MagicBlock
Telegram for the correct CPI interface.
