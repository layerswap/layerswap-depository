# LayerswapDepository — EVM

A Solidity smart contract that forwards native and ERC20 tokens to whitelisted Layerswap receiver addresses.

## Overview

`LayerswapDepository` acts as a secure on-chain entry point for Layerswap bridge orders. It accepts deposits from users and forwards funds immediately to pre-approved (whitelisted) Layerswap solver addresses. The contract never holds funds — all assets are forwarded atomically in the same transaction.

### Key properties

- **Whitelist-gated** — only pre-approved receiver addresses can receive funds
- **Dual-asset** — supports both native ETH and any ERC20 token
- **Order-correlated** — every deposit includes a `bytes32 id` that maps to an off-chain Layerswap order
- **Pausable** — owner can halt all deposits in an emergency
- **Non-custodial** — contract holds zero balance at all times

## Files

| File | Description |
|------|-------------|
| [`src/LayerswapDepository.sol`](src/LayerswapDepository.sol) | Main contract |
| [`script/DeployLayerswapDepository.s.sol`](script/DeployLayerswapDepository.s.sol) | Deployment script |
| [`script/VerifyAllFromBroadcast.ps1`](script/VerifyAllFromBroadcast.ps1) | Batch verification across all Etherscan V2 networks |
| [`test/LayerswapDepository.t.sol`](test/LayerswapDepository.t.sol) | Unit + fuzz tests (27 tests) |
| [`test/LayerswapDepository.gas.t.sol`](test/LayerswapDepository.gas.t.sol) | Gas benchmarks |

## Architecture

```
User
 │
 ├─ depositNative(id, receiver) ──────► receiver (ETH forwarded instantly)
 │
 └─ depositERC20(id, token, receiver, amount) ──► receiver (ERC20 forwarded instantly)
                                                        │
                                              emits Deposited(id, token, amount)
                                                        │
                                              Layerswap backend picks up event
                                              and fulfills the order on dst chain
```

## Dependencies

| Library | Version |
|---------|---------|
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | v5.6.1 |
| [forge-std](https://github.com/foundry-rs/forge-std) | v1.15.0 |

## Setup

All commands below must be run from the `evm/` directory.

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# From repo root — clone and enter the evm directory
git clone <repo>
cd layerswap-depository/evm
forge install
```

## Environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Deployer wallet private key |
| `OWNER_ADDRESS` | Contract owner (use a Gnosis Safe on mainnet) |
| `WHITELISTED_ADDRESSES` | Comma-separated initial whitelist (optional) |
| `RPC_*` | RPC endpoint per network |
| `ETHERSCAN_API_KEY` | Unified Etherscan V2 API key (covers all supported networks) |
| `CONTRACT_ADDRESS` | Deployed contract address (for verification) |
| `CONSTRUCTOR_ARGS` | ABI-encoded constructor args (for verification) |
| `VERIFY_CHAINS` | Comma-separated list of networks to verify on |

## Build & Test

```bash
# Build
forge build

# Run all tests
forge test -vvv

# Run with more fuzz iterations (CI profile)
FOUNDRY_PROFILE=ci forge test

# Format check
forge fmt --check
```

## Gas Benchmarks

```bash
# Save baseline
forge snapshot --match-contract GasTest

# Check for regressions
forge snapshot --check
```

| Operation | Gas |
|-----------|-----|
| `depositNative` | ~62,500 |
| `depositERC20` | ~59,100 |
| `addToWhitelist` | ~65,000 |
| `removeFromWhitelist` | ~21,100 |
| `updateWhitelistedAddress` | ~48,900 |
| Deploy (empty whitelist) | ~789,000 |

## Deploy

**Dry-run (no broadcast):**
```bash
forge script script/DeployLayerswapDepository.s.sol --rpc-url sepolia --private-key $PRIVATE_KEY
```

**Deploy + verify in one command:**
```bash
forge script script/DeployLayerswapDepository.s.sol \
  --rpc-url sepolia \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

## Batch Verification (all Etherscan V2 networks)

Fill `CONTRACT_ADDRESS`, `CONSTRUCTOR_ARGS`, and `VERIFY_CHAINS` in `.env`, then:

```powershell
.\script\VerifyAllFromBroadcast.ps1
```

Supports all 71 Etherscan V2 networks with a single unified API key.

## Whitelist Management

```bash
# Add a single address
cast send <CONTRACT> "addToWhitelist(address)" <ADDR> \
  --rpc-url mainnet --private-key $PRIVATE_KEY

# Replace an address atomically
cast send <CONTRACT> "updateWhitelistedAddress(address,address)" <OLD_ADDR> <NEW_ADDR> \
  --rpc-url mainnet --private-key $PRIVATE_KEY

# Remove
cast send <CONTRACT> "removeFromWhitelist(address)" <ADDR> \
  --rpc-url mainnet --private-key $PRIVATE_KEY

# View whitelist
cast call <CONTRACT> "getWhitelistedAddresses()" --rpc-url mainnet

# Emergency pause
cast send <CONTRACT> "pause()" --rpc-url mainnet --private-key $PRIVATE_KEY
```

## License

MIT
