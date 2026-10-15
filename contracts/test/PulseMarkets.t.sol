// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PulseMarkets} from "../src/PulseMarkets.sol";

contract PulseMarketsTest is Test {
    PulseMarkets internal markets;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        markets = new PulseMarkets(owner, owner, 200);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _create() internal returns (uint256) {
        vm.prank(owner);
        return markets.createMarket(
            "Will BOT close above the target?",
            "Deterministic price snapshot.",
            "https://example.com/source",
            0,
            uint64(block.timestamp + 1 hours),
            1 ether,
            50 ether
        );
    }

    function testOwnerStartsWithRoles() public view {
        assertTrue(markets.isCreator(owner));
        assertTrue(markets.isResolver(owner));
    }

    function testCreatorCanCreateMarket() public {
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(markets.marketCount(), 1);
        PulseMarkets.Market memory market = markets.getMarket(id);
        assertEq(market.minStake, 1 ether);
    }

    function testUserCanStakeOnlyOneSide() public {
        uint256 id = _create();
        vm.startPrank(alice);
        markets.stake{value: 3 ether}(id, PulseMarkets.Side.Yes);
        vm.expectRevert("Pulse: side locked");
        markets.stake{value: 2 ether}(id, PulseMarkets.Side.No);
        vm.stopPrank();
    }

    function testResolveAndWinnerClaim() public {
        uint256 id = _create();
        vm.prank(alice);
        markets.stake{value: 10 ether}(id, PulseMarkets.Side.Yes);
        vm.prank(bob);
        markets.stake{value: 10 ether}(id, PulseMarkets.Side.No);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(owner);
        markets.resolve(id, PulseMarkets.Outcome.Yes, "snapshot");
        assertEq(markets.claimable(id, alice), 19.8 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        markets.claim(id);
        assertEq(alice.balance, before + 19.8 ether);
        assertEq(markets.accruedFees(), 0.2 ether);
    }

    function testInvalidMarketRefundsBothSides() public {
        uint256 id = _create();
        vm.prank(alice);
        markets.stake{value: 4 ether}(id, PulseMarkets.Side.Yes);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(owner);
        markets.resolve(id, PulseMarkets.Outcome.Invalid, "source unavailable");
        assertEq(markets.claimable(id, alice), 4 ether);
    }

    function testAnyoneCanVoidAfterGracePeriod() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 1 hours + 3 days);
        vm.prank(alice);
        markets.voidStaleMarket(id);
        PulseMarkets.Market memory market = markets.getMarket(id);
        assertEq(uint256(market.outcome), uint256(PulseMarkets.Outcome.Invalid));
    }
}
