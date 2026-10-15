// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PulseMarkets
/// @notice Short-duration, pari-mutuel YES/NO markets settled in native BOT.
contract PulseMarkets is Ownable2Step, Pausable, ReentrancyGuard {
    enum Side { None, Yes, No }
    enum Outcome { Unresolved, Yes, No, Invalid }

    struct Market {
        uint128 totalYes;
        uint128 totalNo;
        uint128 minStake;
        uint128 maxStake;
        uint64 openTime;
        uint64 closeTime;
        uint64 resolvedAt;
        uint16 feeBps;
        Outcome outcome;
        address creator;
        string question;
        string description;
        string resolutionSource;
        string resolutionEvidence;
    }

    struct Position {
        Side side;
        bool claimed;
        uint128 amount;
    }

    uint16 public constant MAX_FEE_BPS = 500;
    uint64 public constant MIN_DURATION = 5 minutes;
    uint64 public constant MAX_DURATION = 30 days;
    uint64 public constant RESOLUTION_GRACE = 3 days;

    uint256 public marketCount;
    uint16 public feeBps;
    address public treasury;
    uint256 public accruedFees;

    mapping(uint256 => Market) private _markets;
    mapping(uint256 => mapping(address => Position)) private _positions;
    mapping(address => bool) public isCreator;
    mapping(address => bool) public isResolver;

    event MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint64 openTime, uint64 closeTime);
    event PositionTaken(uint256 indexed marketId, address indexed user, Side side, uint256 amount, uint256 totalYes, uint256 totalNo);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, address indexed resolver, uint256 fee, string evidence);
    event MarketVoided(uint256 indexed marketId, address indexed by);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event RoleUpdated(address indexed account, bool creator, bool resolver);
    event TreasuryUpdated(address indexed treasury);
    event FeeUpdated(uint16 feeBps);

    constructor(address initialOwner, address initialTreasury, uint16 initialFeeBps)
        Ownable(initialOwner)
    {
        require(initialTreasury != address(0), "Pulse: zero treasury");
        require(initialFeeBps <= MAX_FEE_BPS, "Pulse: fee too high");
        treasury = initialTreasury;
        feeBps = initialFeeBps;
        isCreator[initialOwner] = true;
        isResolver[initialOwner] = true;
    }

    function createMarket(
        string calldata question,
        string calldata description,
        string calldata resolutionSource,
        uint64 openTime,
        uint64 closeTime,
        uint128 minStake,
        uint128 maxStake
    ) external whenNotPaused returns (uint256 marketId) {
        require(isCreator[msg.sender], "Pulse: not creator");
        require(bytes(question).length >= 8, "Pulse: short question");
        require(bytes(resolutionSource).length > 0, "Pulse: source required");
        uint64 actualOpen = openTime == 0 ? uint64(block.timestamp) : openTime;
        require(actualOpen >= block.timestamp, "Pulse: open in past");
        require(closeTime >= actualOpen + MIN_DURATION, "Pulse: duration too short");
        require(closeTime <= actualOpen + MAX_DURATION, "Pulse: duration too long");
        require(minStake > 0 && maxStake >= minStake, "Pulse: invalid limits");

        marketId = ++marketCount;
        Market storage market = _markets[marketId];
        market.minStake = minStake;
        market.maxStake = maxStake;
        market.openTime = actualOpen;
        market.closeTime = closeTime;
        market.feeBps = feeBps;
        market.creator = msg.sender;
        market.question = question;
        market.description = description;
        market.resolutionSource = resolutionSource;
        emit MarketCreated(marketId, msg.sender, question, actualOpen, closeTime);
    }

    function stake(uint256 marketId, Side side) external payable whenNotPaused nonReentrant {
        Market storage market = _market(marketId);
        require(block.timestamp >= market.openTime && block.timestamp < market.closeTime, "Pulse: market closed");
        require(side == Side.Yes || side == Side.No, "Pulse: invalid side");
        require(msg.value >= market.minStake, "Pulse: below minimum");

        Position storage position = _positions[marketId][msg.sender];
        require(position.side == Side.None || position.side == side, "Pulse: side locked");
        require(uint256(position.amount) + msg.value <= market.maxStake, "Pulse: above maximum");
        require(msg.value <= type(uint128).max, "Pulse: amount overflow");

        position.side = side;
        position.amount += uint128(msg.value);
        if (side == Side.Yes) market.totalYes += uint128(msg.value);
        else market.totalNo += uint128(msg.value);
        emit PositionTaken(marketId, msg.sender, side, msg.value, market.totalYes, market.totalNo);
    }

    function resolve(uint256 marketId, Outcome outcome, string calldata evidence) external whenNotPaused {
        require(isResolver[msg.sender], "Pulse: not resolver");
        Market storage market = _market(marketId);
        require(block.timestamp >= market.closeTime, "Pulse: still open");
        require(market.outcome == Outcome.Unresolved, "Pulse: already resolved");
        require(outcome == Outcome.Yes || outcome == Outcome.No || outcome == Outcome.Invalid, "Pulse: invalid outcome");

        Outcome finalOutcome = outcome;
        if ((outcome == Outcome.Yes && market.totalYes == 0) || (outcome == Outcome.No && market.totalNo == 0)) {
            finalOutcome = Outcome.Invalid;
        }
        market.outcome = finalOutcome;
        market.resolvedAt = uint64(block.timestamp);
        market.resolutionEvidence = evidence;
        uint256 losingPool = finalOutcome == Outcome.Yes ? market.totalNo : finalOutcome == Outcome.No ? market.totalYes : 0;
        uint256 fee = losingPool * market.feeBps / 10_000;
        accruedFees += fee;
        emit MarketResolved(marketId, finalOutcome, msg.sender, fee, evidence);
    }

    function voidStaleMarket(uint256 marketId) external {
        Market storage market = _market(marketId);
        require(market.outcome == Outcome.Unresolved, "Pulse: already resolved");
        require(block.timestamp >= market.closeTime + RESOLUTION_GRACE, "Pulse: grace active");
        market.outcome = Outcome.Invalid;
        market.resolvedAt = uint64(block.timestamp);
        emit MarketVoided(marketId, msg.sender);
    }

    function claim(uint256 marketId) external nonReentrant returns (uint256 amount) {
        Market storage market = _market(marketId);
        require(market.outcome != Outcome.Unresolved, "Pulse: unresolved");
        Position storage position = _positions[marketId][msg.sender];
        require(position.amount > 0 && !position.claimed, "Pulse: nothing to claim");
        amount = claimable(marketId, msg.sender);
        require(amount > 0, "Pulse: losing position");
        position.claimed = true;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Pulse: payout failed");
        emit Claimed(marketId, msg.sender, amount);
    }

    function claimable(uint256 marketId, address user) public view returns (uint256) {
        Market storage market = _markets[marketId];
        Position storage position = _positions[marketId][user];
        if (position.claimed || position.amount == 0 || market.outcome == Outcome.Unresolved) return 0;
        if (market.outcome == Outcome.Invalid) return position.amount;
        bool won = (market.outcome == Outcome.Yes && position.side == Side.Yes)
            || (market.outcome == Outcome.No && position.side == Side.No);
        if (!won) return 0;
        uint256 winningPool = market.outcome == Outcome.Yes ? market.totalYes : market.totalNo;
        uint256 totalPool = uint256(market.totalYes) + uint256(market.totalNo);
        uint256 losingPool = totalPool - winningPool;
        uint256 fee = losingPool * market.feeBps / 10_000;
        return uint256(position.amount) * (totalPool - fee) / winningPool;
    }

    function getMarket(uint256 marketId) external view returns (Market memory) { return _market(marketId); }
    function getPosition(uint256 marketId, address user) external view returns (Position memory) { return _positions[marketId][user]; }

    function setRoles(address account, bool creator, bool resolver) external onlyOwner {
        isCreator[account] = creator;
        isResolver[account] = resolver;
        emit RoleUpdated(account, creator, resolver);
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Pulse: fee too high");
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Pulse: zero treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function withdrawFees() external nonReentrant {
        require(msg.sender == treasury || msg.sender == owner(), "Pulse: not treasury");
        uint256 amount = accruedFees;
        require(amount > 0, "Pulse: no fees");
        accruedFees = 0;
        (bool ok,) = payable(treasury).call{value: amount}("");
        require(ok, "Pulse: transfer failed");
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _market(uint256 marketId) private view returns (Market storage market) {
        require(marketId > 0 && marketId <= marketCount, "Pulse: unknown market");
        return _markets[marketId];
    }
}
