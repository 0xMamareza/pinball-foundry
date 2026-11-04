// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Permissionless, append-only publication of public pinball table layouts.
/// @dev A creator is the publishing caller, not an owner or an authority over gameplay.
contract PinballFoundryRegistry {
    event TablePublished(uint256 indexed id, address indexed creator, string title, bytes layout);
    error InvalidTitle();
    error InvalidLayout();
    error TableNotFound();

    struct Table {
        address creator;
        uint64 publishedAt;
        string title;
        bytes layout;
    }

    /// @notice Number published and highest valid ID; initially zero. IDs start at one.
    uint256 public tableCount;
    mapping(uint256 => Table) private tables;

    /// @notice Permanently publish a validated title and compact layout as the caller.
    /// @return id The next sequential ID, starting at one.
    function publish(string calldata title, bytes calldata layout) external returns (uint256 id) {
        _validateTitle(bytes(title));
        _validateLayout(layout);
        id = ++tableCount;
        tables[id] = Table(msg.sender, uint64(block.timestamp), title, layout);
        emit TablePublished(id, msg.sender, title, layout);
    }

    /// @notice Read a published table. Reverts unless 1 <= id <= tableCount.
    function getTable(uint256 id)
        external
        view
        returns (address creator, string memory title, bytes memory layout, uint64 publishedAt)
    {
        if (id == 0 || id > tableCount) revert TableNotFound();
        Table storage table = tables[id];
        return (table.creator, table.title, table.layout, table.publishedAt);
    }

    function _validateTitle(bytes calldata title) private pure {
        if (title.length == 0 || title.length > 40) revert InvalidTitle();
        bool hasNonSpace;
        for (uint256 i; i < title.length; ++i) {
            uint8 character = uint8(title[i]);
            if (character < 32 || character > 126) revert InvalidTitle();
            if (character != 32) hasNonSpace = true;
        }
        if (!hasNonSpace) revert InvalidTitle();
    }

    function _validateLayout(bytes calldata layout) private pure {
        if (layout.length == 0) revert InvalidLayout();
        uint256 count = uint8(layout[0]);
        if (count < 3 || count > 12 || layout.length != 1 + 3 * count) revert InvalidLayout();
        for (uint256 i; i < count; ++i) {
            uint256 offset = 1 + 3 * i;
            uint256 kind = uint8(layout[offset]);
            uint256 x = uint8(layout[offset + 1]);
            uint256 y = uint8(layout[offset + 2]);
            if (kind > 2 || x < 28 || x > 227 || y < 24 || y > 190) revert InvalidLayout();
            for (uint256 j; j < i; ++j) {
                uint256 otherX = uint8(layout[2 + 3 * j]);
                uint256 otherY = uint8(layout[3 + 3 * j]);
                uint256 dx = x > otherX ? x - otherX : otherX - x;
                uint256 dy = y > otherY ? y - otherY : otherY - y;
                if (dx * dx + dy * dy < 256) revert InvalidLayout();
            }
        }
    }
}
