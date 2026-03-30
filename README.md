# Layerswap Depository

On-chain depository programs for [Layerswap](https://layerswap.io). Each implementation accepts deposits from users, forwards funds immediately to whitelisted Layerswap solver addresses, and emits an order-correlated event for the Layerswap backend.

**Non-custodial** — no implementation holds funds. All transfers are atomic.

## Implementations

| Chain | Stack | Directory |
|-------|-------|-----------|
| EVM (Ethereum, Arbitrum, Optimism, Base, Polygon, ...) | Solidity + Foundry | [`evm/`](evm/) |
| Solana | Rust + Anchor | [`solana/`](solana/) |

## Shared Design Principles

- **Whitelist-gated** — only pre-approved receiver addresses can receive funds
- **Order-correlated** — every deposit carries a unique `id` that maps to an off-chain Layerswap order
- **Pausable** — authority can halt all deposits in an emergency
- **Two-step ownership** — ownership transfer requires acceptance by the new owner

## Repository Layout

```
layerswap-depository/
  evm/          Foundry project — run forge/cast from this directory
  solana/       Anchor program  — run anchor from this directory
  .gitignore
  .gitmodules
```

## Quick Start

**EVM**
```bash
cd evm
forge install
forge test
```

**Solana**
```bash
cd solana
npm install
anchor build
anchor test
```

See each subdirectory's `README.md` for full setup, deployment, and management instructions.

## License

MIT
