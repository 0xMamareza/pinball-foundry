// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice A pre-play receipt only. Scores and leaderboard are replay-verified OFFCHAIN.
/// @dev Deploy with the two pinned replay table IDs. No owner, signer, fee or score submission.
contract PinballFoundryRankedStart {
    error InvalidTable();
    bytes32 public immutable firstTable;
    bytes32 public immutable secondTable;
    event RunStarted(address indexed wallet, bytes32 indexed tableId);

    constructor(bytes32 first, bytes32 second) {
        if (first == bytes32(0) || second == bytes32(0) || first == second) revert InvalidTable();
        firstTable = first;
        secondTable = second;
    }
    function officialTable(bytes32 tableId) public view returns (bool) {
        return tableId == firstTable || tableId == secondTable;
    }
    /// @dev Nonpayable: the player's only cost is network testnet gas, never a service fee.
    function startRun(bytes32 tableId) external {
        if (!officialTable(tableId)) revert InvalidTable();
        emit RunStarted(msg.sender, tableId);
    }
}
