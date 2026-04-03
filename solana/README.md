# LayerswapDepository — Solana

An Anchor program that forwards SOL and SPL/Token-2022 tokens to whitelisted Layerswap receiver addresses, matching the responsibilities of the EVM depository.

## Overview

`layerswap_depository` is a non-custodial Solana program built with the Anchor framework. It accepts deposits from users and forwards funds immediately to pre-approved (whitelisted) receiver accounts. The program never holds funds — all transfers are direct CPI calls from depositor to receiver.

### Key properties

- **Whitelist-gated** — receiver must have a `WhitelistEntry` PDA; existence of the PDA = whitelisted
- **Dual-asset** — supports native SOL and any SPL Token or Token-2022 token
- **Token-2022 ready** — supports transfer hooks (via remaining accounts), MemoTransfer (via memo CPI), and transfer fee tokens (via balance-delta)
- **Order-correlated** — every deposit includes a `[u8; 32]` id that maps to an off-chain Layerswap order
- **Pausable** — authority can halt all deposits in an emergency (with idempotency guards)
- **Non-custodial** — program holds zero balance at all times
- **Fee-on-transfer aware** — token deposits use balance-delta to emit the actual received amount
- **Two-step authority transfer** — ownership transfer requires acceptance by the new authority
- **transfer_checked** — token transfers validate mint and decimals

## Program Structure

```
programs/
  depository/
    src/
      lib.rs                  — program entry point, instruction declarations
      errors.rs               — custom error codes
      events.rs               — emitted events (Deposited, ReceiverAdded, ...)
      state/
        config.rs             — Config PDA  [seeds: "config"]
        whitelist_entry.rs    — WhitelistEntry PDA  [seeds: "whitelist", receiver]
      instructions/
        initialize.rs         — one-time setup, creates Config PDA
        deposit_native.rs     — forward SOL to whitelisted receiver
        deposit_token.rs      — forward SPL/Token-2022 tokens to whitelisted receiver
        add_receiver.rs       — whitelist a new receiver (creates WhitelistEntry PDA)
        remove_receiver.rs    — remove receiver (closes WhitelistEntry PDA)
        update_receiver.rs    — atomically replace one receiver with another
        pause.rs              — pause / unpause all deposits
        authority.rs          — two-step authority transfer
  test-transfer-hook/
    src/lib.rs                — minimal no-op transfer hook for testing
```

## PDAs

| Account | Seeds | Description |
|---------|-------|-------------|
| `Config` | `["config"]` | Global config: authority, paused flag |
| `WhitelistEntry` | `["whitelist", receiver]` | Presence = whitelisted; closing = removed |

## Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize(authority)` | payer (upgrade authority) | One-time setup |
| `deposit_native(id, amount)` | depositor | Forward SOL |
| `deposit_token(id, amount)` | depositor | Forward SPL/Token-2022 tokens (`transfer_checked`) |
| `add_receiver` | authority | Whitelist a receiver |
| `remove_receiver` | authority | Remove a receiver |
| `update_receiver` | authority | Atomic swap of receivers |
| `pause` / `unpause` | authority | Emergency halt (rejects duplicate calls) |
| `transfer_authority(new)` | authority | Step 1 of ownership transfer |
| `accept_authority` | pending authority | Step 2 — accept and take ownership |

## Requirements

| Tool | Version |
|------|---------|
| [Rust](https://rustup.rs) | stable |
| [Solana CLI (Agave)](https://docs.anza.xyz/cli/install) | >= 3.0 |
| [Anchor CLI](https://www.anchor-lang.com/docs/installation) | 0.32.1 |
| Node.js + npm | >= 18 |

## Setup

All commands below must be run from the `solana/` directory.

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
agave-install init

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1 && avm use 0.32.1

# Install Node dependencies
npm install
```

## Build

```bash
anchor build
```

After the first build, sync the program ID across all clusters:

```bash
npm run keys:sync
anchor build
```

This updates `declare_id!` in `src/lib.rs` and all `[programs.*]` sections in `Anchor.toml` to match the generated keypair.

## Test

```bash
# Downloads SPL Memo (if needed), starts local validator, deploys, and runs all tests
npm test
```

45 tests covering: initialize, add/remove/update receivers, deposit native, deposit SPL Token, deposit Token-2022, Token-2022 transfer fee, Token-2022 transfer hook, pause/unpause, two-step authority transfer, unauthorized access, account substitution attacks, input validation, and idempotency guards.

## Deploy

```bash
# Fund your wallet (devnet)
solana config set --url devnet
solana airdrop 2 && solana airdrop 2

# Deploy program + IDL to devnet
npm run deploy:devnet

# Deploy program + IDL to mainnet
npm run deploy:mainnet
```

`anchor deploy` uploads both the program binary and the IDL (on-chain interface definition) in one command. Only the depository is deployed — the test transfer hook is excluded.

After deployment, initialize the program:

```typescript
await program.methods
  .initialize(authorityPublicKey)
  .accounts({ payer: wallet.publicKey })
  .rpc();
```

Then whitelist receivers with `add_receiver`.

## Off-chain Indexing

Subscribe to program logs and filter for `Deposited` events. The `id` field matches the off-chain Layerswap order ID:

```typescript
connection.onLogs(programId, (logs) => {
  // Parse anchor events from logs.logs
  // Deposited { id, mint, receiver, amount }
});
```

`mint = null` for SOL deposits.

## License

MIT
