# LayerswapDepository — Solana

An Anchor program that forwards SOL and SPL tokens to whitelisted Layerswap receiver addresses, matching the responsibilities of the EVM depository.

## Overview

`layerswap_depository` is a non-custodial Solana program built with the Anchor framework. It accepts deposits from users and forwards funds immediately to pre-approved (whitelisted) receiver accounts. The program never holds funds — all transfers are direct CPI calls from depositor to receiver.

### Key properties

- **Whitelist-gated** — receiver must have a `WhitelistEntry` PDA; existence of the PDA = whitelisted
- **Dual-asset** — supports both native SOL and any SPL token
- **Order-correlated** — every deposit includes a `[u8; 32]` id that maps to an off-chain Layerswap order
- **Pausable** — authority can halt all deposits in an emergency
- **Non-custodial** — program holds zero balance at all times
- **Fee-on-transfer aware** — SPL deposits use balance-delta to emit the actual received amount
- **Two-step authority transfer** — ownership transfer requires acceptance by the new authority

## Program Structure

```
src/
  lib.rs                  — program entry point, instruction declarations
  errors.rs               — custom error codes
  events.rs               — emitted events (Deposited, ReceiverAdded, ...)
  state/
    config.rs             — Config PDA  [seeds: "config"]
    whitelist_entry.rs    — WhitelistEntry PDA  [seeds: "whitelist", receiver]
  instructions/
    initialize.rs         — one-time setup, creates Config PDA
    deposit_sol.rs        — forward SOL to whitelisted receiver
    deposit_spl.rs        — forward SPL tokens to whitelisted receiver
    add_receiver.rs       — whitelist a new receiver (creates WhitelistEntry PDA)
    remove_receiver.rs    — remove receiver (closes WhitelistEntry PDA)
    update_receiver.rs    — atomically replace one receiver with another
    pause.rs              — pause / unpause all deposits
    authority.rs          — two-step authority transfer
```

## PDAs

| Account | Seeds | Description |
|---------|-------|-------------|
| `Config` | `["config"]` | Global config: authority, paused flag |
| `WhitelistEntry` | `["whitelist", receiver]` | Presence = whitelisted; closing = removed |

## Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize(authority)` | payer | One-time setup |
| `deposit_sol(id, amount)` | depositor | Forward SOL |
| `deposit_spl(id, amount)` | depositor | Forward SPL tokens |
| `add_receiver` | authority | Whitelist a receiver |
| `remove_receiver` | authority | Remove a receiver |
| `update_receiver` | authority | Atomic swap of receivers |
| `pause` / `unpause` | authority | Emergency halt |
| `transfer_authority(new)` | authority | Step 1 of ownership transfer |
| `accept_authority` | pending authority | Step 2 — accept and take ownership |

## Requirements

| Tool | Version |
|------|---------|
| [Rust](https://rustup.rs) | stable |
| [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) | ≥ 1.18 |
| [Anchor CLI](https://www.anchor-lang.com/docs/installation) | 0.30.1 |
| Node.js + npm | ≥ 18 |

## Setup

All commands below must be run from the `solana/` directory.

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

# Install Node dependencies
npm install
```

## Build

```bash
anchor build
```

After the first build, sync the program ID:

```bash
anchor keys sync
```

This updates the `declare_id!` in `src/lib.rs` and `[programs.localnet]` in `Anchor.toml` to match the generated keypair.

## Test

```bash
# Starts a local validator, deploys the program, and runs all tests
anchor test
```

Tests cover all 15 cases: initialize, add/remove/update receivers, deposit SOL, deposit SPL, pause/unpause, two-step authority transfer, unauthorized access.

## Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet
```

After deployment, initialize the program:

```typescript
await program.methods
  .initialize(authorityPublicKey)
  .accounts({ payer: wallet.publicKey, config: configPda, systemProgram })
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

`mint = null` for SOL deposits (mirrors `token = address(0)` on EVM).

## License

MIT
