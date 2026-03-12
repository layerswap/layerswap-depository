// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {LayerswapDepository} from "../src/LayerswapDepository.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

/// @dev Run with: forge snapshot --match-contract GasTest
///      Compare runs: forge snapshot --check
contract LayerswapDepositoryGasTest is Test {
    LayerswapDepository internal depository;
    ERC20Mock internal token;

    address internal owner = makeAddr("owner");
    address internal receiver = makeAddr("receiver");
    address internal user = makeAddr("user");

    bytes32 internal constant ID = keccak256("order-1");
    uint256 internal constant AMOUNT = 1 ether;

    function setUp() public {
        address[] memory initial = new address[](1);
        initial[0] = receiver;
        depository = new LayerswapDepository(owner, initial);

        token = new ERC20Mock();
        token.mint(user, 1000 ether);
        vm.deal(user, 1000 ether);

        vm.prank(user);
        token.approve(address(depository), type(uint256).max);
    }

    // ── Deposit hot paths ────────────────────────────────────────────────────

    function test_gas_depositNative() public {
        vm.prank(user);
        depository.depositNative{value: AMOUNT}(ID, receiver);
    }

    function test_gas_depositERC20() public {
        vm.prank(user);
        depository.depositERC20(ID, address(token), receiver, AMOUNT);
    }

    // ── Whitelist management ─────────────────────────────────────────────────

    function test_gas_addToWhitelist() public {
        address newAddr = makeAddr("new");
        vm.prank(owner);
        depository.addToWhitelist(newAddr);
    }

    function test_gas_removeFromWhitelist() public {
        vm.prank(owner);
        depository.removeFromWhitelist(receiver);
    }

    function test_gas_updateWhitelistedAddress() public {
        address newAddr = makeAddr("new");
        vm.prank(owner);
        depository.updateWhitelistedAddress(receiver, newAddr);
    }

    // ── Deployment cost ──────────────────────────────────────────────────────

    function test_gas_deployment_emptyWhitelist() public {
        new LayerswapDepository(owner, new address[](0));
    }

    function test_gas_deployment_10Addresses() public {
        address[] memory addrs = new address[](10);
        for (uint256 i; i < 10; ++i) {
            addrs[i] = address(uint160(uint256(keccak256(abi.encode("addr", i + 1000)))));
        }
        new LayerswapDepository(owner, addrs);
    }
}
