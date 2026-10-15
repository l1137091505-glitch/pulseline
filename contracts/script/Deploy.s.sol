// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PulseMarkets} from "../src/PulseMarkets.sol";

contract DeployPulseMarkets is Script {
    function run() external returns (PulseMarkets markets) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address treasury = vm.envOr("TREASURY", deployer);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(200)));

        vm.startBroadcast(deployerKey);
        markets = new PulseMarkets(deployer, treasury, feeBps);
        vm.stopBroadcast();
        console.log("PulseMarkets deployed:", address(markets));
    }
}
