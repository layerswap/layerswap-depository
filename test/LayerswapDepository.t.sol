// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {LayerswapDepository} from "../src/LayerswapDepository.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

contract LayerswapDepositoryTest is Test {
    LayerswapDepository public depository;
    ERC20Mock public token;

    address public owner = makeAddr("owner");
    address public receiver = makeAddr("receiver");
    address public user = makeAddr("user");
    address public stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 1 ether;
    bytes32 constant ID = keccak256("test-order-id");

    function setUp() public {
        address[] memory initial = new address[](1);
        initial[0] = receiver;

        depository = new LayerswapDepository(owner, initial);
        token = new ERC20Mock();

        token.mint(user, 100 ether);
        vm.deal(user, 100 ether);
    }

    /// @dev Helper: simulate the Diamond approving the depository (as a facet would)
    function _approveDepository(address caller, uint256 amount) internal {
        vm.prank(caller);
        token.approve(address(depository), amount);
    }

    //////////////////////////////////////////////////////////////
    //                     depositNative                        //
    //////////////////////////////////////////////////////////////

    function test_depositNative_success() public {
        uint256 balBefore = receiver.balance;
        vm.prank(user);
        depository.depositNative{value: AMOUNT}(ID, receiver);
        assertEq(receiver.balance, balBefore + AMOUNT);
    }

    function test_depositNative_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit LayerswapDepository.Deposited(ID, address(0), AMOUNT);
        vm.prank(user);
        depository.depositNative{value: AMOUNT}(ID, receiver);
    }

    function test_depositNative_revertsNotWhitelisted() public {
        vm.prank(user);
        vm.expectRevert(LayerswapDepository.NotWhitelisted.selector);
        depository.depositNative{value: AMOUNT}(ID, stranger);
    }

    function test_depositNative_revertsZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(LayerswapDepository.ZeroAmount.selector);
        depository.depositNative{value: 0}(ID, receiver);
    }

    function test_depositNative_revertsWhenPaused() public {
        vm.prank(owner);
        depository.pause();

        vm.prank(user);
        vm.expectRevert();
        depository.depositNative{value: AMOUNT}(ID, receiver);
    }

    //////////////////////////////////////////////////////////////
    //                     depositERC20                         //
    //////////////////////////////////////////////////////////////

    function test_depositERC20_success() public {
        _approveDepository(user, AMOUNT);

        uint256 balBefore = token.balanceOf(receiver);
        vm.prank(user);
        depository.depositERC20(ID, address(token), receiver, AMOUNT);

        assertEq(token.balanceOf(receiver), balBefore + AMOUNT);
        assertEq(token.balanceOf(address(depository)), 0); // contract never holds tokens
    }

    function test_depositERC20_emitsEvent() public {
        _approveDepository(user, AMOUNT);

        vm.expectEmit(true, true, false, true);
        emit LayerswapDepository.Deposited(ID, address(token), AMOUNT);
        vm.prank(user);
        depository.depositERC20(ID, address(token), receiver, AMOUNT);
    }

    function test_depositERC20_revertsNotWhitelisted() public {
        _approveDepository(user, AMOUNT);

        vm.prank(user);
        vm.expectRevert(LayerswapDepository.NotWhitelisted.selector);
        depository.depositERC20(ID, address(token), stranger, AMOUNT);
    }

    function test_depositERC20_revertsZeroToken() public {
        vm.prank(user);
        vm.expectRevert(LayerswapDepository.ZeroAddress.selector);
        depository.depositERC20(ID, address(0), receiver, AMOUNT);
    }

    function test_depositERC20_revertsZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(LayerswapDepository.ZeroAmount.selector);
        depository.depositERC20(ID, address(token), receiver, 0);
    }

    function test_depositERC20_revertsWhenPaused() public {
        _approveDepository(user, AMOUNT);

        vm.prank(owner);
        depository.pause();

        vm.prank(user);
        vm.expectRevert();
        depository.depositERC20(ID, address(token), receiver, AMOUNT);
    }

    function test_depositERC20_revertsWithoutApproval() public {
        // No approval given — safeTransferFrom must revert
        vm.prank(user);
        vm.expectRevert();
        depository.depositERC20(ID, address(token), receiver, AMOUNT);
    }

    //////////////////////////////////////////////////////////////
    //                   Whitelist management                   //
    //////////////////////////////////////////////////////////////

    function test_addToWhitelist() public {
        vm.prank(owner);
        depository.addToWhitelist(stranger);
        assertTrue(depository.isWhitelisted(stranger));
    }

    function test_addToWhitelist_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.ZeroAddress.selector);
        depository.addToWhitelist(address(0));
    }

    function test_addToWhitelist_revertsAlreadyWhitelisted() public {
        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.AlreadyWhitelisted.selector);
        depository.addToWhitelist(receiver);
    }

    function test_removeFromWhitelist() public {
        vm.prank(owner);
        depository.removeFromWhitelist(receiver);
        assertFalse(depository.isWhitelisted(receiver));
    }

    function test_removeFromWhitelist_revertsNotWhitelisted() public {
        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.NotWhitelisted.selector);
        depository.removeFromWhitelist(stranger);
    }

    function test_updateWhitelistedAddress() public {
        vm.prank(owner);
        depository.updateWhitelistedAddress(receiver, stranger);

        assertFalse(depository.isWhitelisted(receiver));
        assertTrue(depository.isWhitelisted(stranger));

        address[] memory addrs = depository.getWhitelistedAddresses();
        assertEq(addrs.length, 1);
        assertEq(addrs[0], stranger);
    }

    function test_updateWhitelistedAddress_revertsOldNotWhitelisted() public {
        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.NotWhitelisted.selector);
        depository.updateWhitelistedAddress(stranger, makeAddr("new"));
    }

    function test_updateWhitelistedAddress_revertsNewZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.ZeroAddress.selector);
        depository.updateWhitelistedAddress(receiver, address(0));
    }

    function test_updateWhitelistedAddress_revertsNewAlreadyWhitelisted() public {
        address second = makeAddr("second");
        vm.prank(owner);
        depository.addToWhitelist(second);

        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.AlreadyWhitelisted.selector);
        depository.updateWhitelistedAddress(receiver, second);
    }

    function test_updateWhitelistedAddress_revertsNewIsContractSelf() public {
        vm.prank(owner);
        vm.expectRevert(LayerswapDepository.InvalidReceiver.selector);
        depository.updateWhitelistedAddress(receiver, address(depository));
    }

    function test_getWhitelistedAddresses() public view {
        address[] memory addrs = depository.getWhitelistedAddresses();
        assertEq(addrs.length, 1);
        assertEq(addrs[0], receiver);
    }

    //////////////////////////////////////////////////////////////
    //                    Access control                        //
    //////////////////////////////////////////////////////////////

    function test_onlyOwnerCanManageWhitelist() public {
        vm.prank(stranger);
        vm.expectRevert();
        depository.addToWhitelist(makeAddr("x"));

        vm.prank(stranger);
        vm.expectRevert();
        depository.removeFromWhitelist(receiver);

        vm.prank(stranger);
        vm.expectRevert();
        depository.updateWhitelistedAddress(receiver, makeAddr("x"));
    }

    function test_onlyOwnerCanPauseUnpause() public {
        vm.prank(stranger);
        vm.expectRevert();
        depository.pause();

        vm.prank(owner);
        depository.pause();

        vm.prank(stranger);
        vm.expectRevert();
        depository.unpause();

        vm.prank(owner);
        depository.unpause();
    }

    //////////////////////////////////////////////////////////////
    //                       Fuzz tests                         //
    //////////////////////////////////////////////////////////////

    function testFuzz_depositNative(bytes32 id, uint256 amount) public {
        amount = bound(amount, 1, 100 ether);
        vm.deal(user, amount);

        uint256 balBefore = receiver.balance;
        vm.prank(user);
        depository.depositNative{value: amount}(id, receiver);
        assertEq(receiver.balance, balBefore + amount);
    }

    function testFuzz_depositERC20(bytes32 id, uint256 amount) public {
        amount = bound(amount, 1, 100 ether);
        token.mint(user, amount);

        vm.prank(user);
        token.approve(address(depository), amount);

        uint256 balBefore = token.balanceOf(receiver);
        vm.prank(user);
        depository.depositERC20(id, address(token), receiver, amount);
        assertEq(token.balanceOf(receiver), balBefore + amount);
    }
}
