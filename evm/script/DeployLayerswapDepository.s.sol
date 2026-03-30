// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {LayerswapDepository} from "../src/LayerswapDepository.sol";

contract DeployLayerswapDepository is Script {
    function run() external {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address[] memory initialAddresses = _parseAddresses();

        vm.startBroadcast();
        LayerswapDepository depository = new LayerswapDepository(owner, initialAddresses);
        vm.stopBroadcast();

        console.log("LayerswapDepository deployed at:", address(depository));
        console.log("Owner:", owner);
        console.log("Whitelisted addresses:", initialAddresses.length);
    }

    function _parseAddresses() internal view returns (address[] memory) {
        // Set WHITELISTED_ADDRESSES as a comma-separated list in your .env
        // e.g. WHITELISTED_ADDRESSES=0xabc...,0xdef...
        // If not set, deploys with an empty whitelist.
        try vm.envString("WHITELISTED_ADDRESSES") returns (string memory raw) {
            return _splitAddresses(raw);
        } catch {
            return new address[](0);
        }
    }

    function _splitAddresses(string memory raw) internal pure returns (address[] memory) {
        // Count commas to size the array
        bytes memory b = bytes(raw);
        uint256 count = 1;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == ",") ++count;
        }

        address[] memory addrs = new address[](count);
        uint256 start;
        uint256 idx;
        for (uint256 i; i <= b.length; ++i) {
            if (i == b.length || b[i] == ",") {
                bytes memory slice = new bytes(i - start);
                for (uint256 j; j < i - start; ++j) {
                    slice[j] = b[start + j];
                }
                addrs[idx++] = vm.parseAddress(string(slice));
                start = i + 1;
            }
        }
        return addrs;
    }
}
