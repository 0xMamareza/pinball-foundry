// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PinballFoundryRegistry} from "../src/PinballFoundryRegistry.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
    function deal(address account, uint256 balance) external;
}

contract PinballFoundryRegistryTest {
    event TablePublished(uint256 indexed id, address indexed creator, string title, bytes layout);
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    PinballFoundryRegistry internal registry;
    bytes internal constant VALID = hex"03002828015050027878";

    function setUp() public {
        registry = new PinballFoundryRegistry();
    }

    function testMultipleCreatorsReceiveSequentialImmutableIds() public {
        address alice = address(0xA11CE);
        address bob = address(0xB0B);
        vm.warp(100);
        vm.prank(alice);
        require(registry.publish("Alice", VALID) == 1, "alice id");
        vm.warp(200);
        vm.prank(bob);
        require(registry.publish("Bob", VALID) == 2, "bob id");
        vm.prank(alice);
        require(registry.publish("Alice again", VALID) == 3, "repeat layout id");
        require(registry.tableCount() == 3, "total published");
        (address first, string memory title, bytes memory layout, uint64 at) = registry.getTable(1);
        require(first == alice && at == 100, "first identity/timestamp changed");
        require(keccak256(bytes(title)) == keccak256("Alice"), "first title changed");
        require(keccak256(layout) == keccak256(VALID), "first layout changed");
        (address second,,, uint64 secondAt) = registry.getTable(2);
        require(second == bob && secondAt == 200, "second identity/timestamp");
    }

    function testAcceptsInclusiveCoordinateAndTitleBoundaries() public {
        registry.publish("!", hex"03001c1801e318021cbe");
        registry.publish("1234567890123456789012345678901234567890", VALID);
        registry.publish(" ~ ", VALID);
        require(registry.tableCount() == 3, "boundary count");
    }

    function testAcceptsExactMinimumDistanceInBothAxes() public {
        registry.publish("Horizontal", hex"03002828013828027878");
        registry.publish("Vertical", hex"03002828012838027878");
        registry.publish("Diagonal", hex"03002828013434027878");
    }

    function testRejectsEtherAndUnknownCalls() public {
        vm.deal(address(this), 1 ether);
        (bool published,) = address(registry).call{value: 1}(abi.encodeCall(registry.publish, ("Paid", VALID)));
        require(!published && registry.tableCount() == 0, "payable publish");
        (bool received,) = address(registry).call{value: 1}("");
        require(!received, "payable receive");
        (bool unknown,) = address(registry).call(hex"deadbeef");
        require(!unknown, "unknown selector");
        require(address(registry).balance == 0, "unexpected balance");
    }

    function testRejectionPreservesExistingState() public {
        registry.publish("Saved", VALID);
        vm.expectRevert(bytes4(keccak256("InvalidLayout()")));
        registry.publish("Invalid", hex"03002828012828027878");
        require(registry.tableCount() == 1, "failed write incremented");
        (, string memory title, bytes memory layout,) = registry.getTable(1);
        require(keccak256(bytes(title)) == keccak256("Saved"), "failed write changed title");
        require(keccak256(layout) == keccak256(VALID), "failed write changed layout");
        require(registry.publish("Next", VALID) == 2, "failed write left id gap");
    }

    function testFuzzAcceptsThreeToTwelveElements(uint8 seed) public {
        uint8 count = 3 + seed % 10;
        bytes memory layout = new bytes(1 + 3 * count);
        layout[0] = bytes1(count);
        for (uint8 i; i < count; ++i) {
            layout[1 + 3 * i] = bytes1(i % 3);
            layout[2 + 3 * i] = bytes1(uint8(28) + (i % 4) * 48);
            // Integer division deliberately selects one of three grid rows.
            // forge-lint: disable-next-line(divide-before-multiply)
            layout[3 + 3 * i] = bytes1(uint8(24) + (i / 4) * 48);
        }
        uint256 id = registry.publish("Grid", layout);
        (,, bytes memory stored,) = registry.getTable(id);
        require(keccak256(stored) == keccak256(layout), "grid readback");
    }

    function testFuzzElementValidationMatchesSignedDistance(uint8 kind, uint8 x, uint8 y, uint8 index) public {
        uint256 i = uint256(index) % 3;
        bytes memory layout = VALID;
        layout[1 + 3 * i] = bytes1(kind);
        layout[2 + 3 * i] = bytes1(x);
        layout[3 + 3 * i] = bytes1(y);
        bool valid = kind <= 2 && x >= 28 && x <= 227 && y >= 24 && y <= 190;
        for (uint256 j; j < 3; ++j) {
            if (i == j) continue;
            int256 dx = int256(uint256(x)) - int256(uint256(uint8(layout[2 + 3 * j])));
            int256 dy = int256(uint256(y)) - int256(uint256(uint8(layout[3 + 3 * j])));
            if (dx * dx + dy * dy < 256) valid = false;
        }
        if (valid) {
            require(registry.publish("Fuzz", layout) == 1, "valid mutation");
        } else {
            _rejectLayout(layout);
        }
    }

    function testFuzzTitleByteValidation(uint8 character, uint8 size) public {
        uint256 length = uint256(size) % 43;
        bytes memory title = new bytes(length);
        for (uint256 i; i < length; ++i) {
            title[i] = bytes1(character);
        }
        bool valid = length > 0 && length <= 40 && character >= 33 && character <= 126;
        if (valid) {
            registry.publish(string(title), VALID);
        } else {
            vm.expectRevert(bytes4(keccak256("InvalidTitle()")));
            registry.publish(string(title), VALID);
            require(registry.tableCount() == 0, "invalid fuzz title changed count");
        }
    }

    function testRejectsUnknownTableIds() public {
        vm.expectRevert(bytes4(keccak256("TableNotFound()")));
        registry.getTable(0);
        vm.expectRevert(bytes4(keccak256("TableNotFound()")));
        registry.getTable(1);
        registry.publish("Exists", VALID);
        vm.expectRevert(bytes4(keccak256("TableNotFound()")));
        registry.getTable(2);
        vm.expectRevert(bytes4(keccak256("TableNotFound()")));
        registry.getTable(type(uint256).max);
    }

    function testEmitsPublicationWithIndexedIdentity() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit TablePublished(1, address(this), "Event table", VALID);
        registry.publish("Event table", VALID);
    }

    function testRejectsOverlapForEveryPair() public {
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                for (uint256 mode; mode < 4; ++mode) {
                    bytes memory layout = VALID;
                    uint8 dx = mode == 1 ? 15 : mode == 3 ? 11 : 0;
                    uint8 dy = mode == 2 ? 15 : mode == 3 ? 11 : 0;
                    layout[2 + 3 * j] = bytes1(uint8(layout[2 + 3 * i]) + dx);
                    layout[3 + 3 * j] = bytes1(uint8(layout[3 + 3 * i]) + dy);
                    _rejectLayout(layout);
                }
            }
        }
    }

    function testRejectsInvalidElementsAtEveryIndex() public {
        for (uint256 i; i < 3; ++i) {
            for (uint256 field; field < 3; ++field) {
                for (uint256 side; side < 2; ++side) {
                    bytes memory layout = VALID;
                    uint8 invalid = field == 0
                        ? (side == 0 ? 3 : 255)
                        : field == 1 ? (side == 0 ? 27 : 228) : (side == 0 ? 23 : 191);
                    layout[1 + i * 3 + field] = bytes1(invalid);
                    _rejectLayout(layout);
                }
            }
        }
    }

    function _rejectLayout(bytes memory layout) internal {
        vm.expectRevert(bytes4(keccak256("InvalidLayout()")));
        registry.publish("Valid", layout);
        require(registry.tableCount() == 0, "invalid layout changed count");
    }

    function testRejectsMalformedLayout() public {
        bytes[8] memory invalid = [
            bytes(hex""),
            hex"00",
            hex"02002828015050",
            hex"0d",
            hex"ff",
            hex"03002828015050",
            hex"0300282801505002787800",
            hex"04002828015050027878"
        ];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(bytes4(keccak256("InvalidLayout()")));
            registry.publish("Valid", invalid[i]);
            require(registry.tableCount() == 0, "malformed layout changed count");
        }
    }

    function testRejectsInvalidTitles() public {
        string[8] memory invalid = [
            "",
            " ",
            "     ",
            "12345678901234567890123456789012345678901",
            string(hex"1f"),
            string(hex"7f"),
            string(hex"c3a9"),
            "Tab\tname"
        ];
        for (uint256 i; i < invalid.length; ++i) {
            vm.expectRevert(bytes4(keccak256("InvalidTitle()")));
            registry.publish(invalid[i], VALID);
            require(registry.tableCount() == 0, "invalid title changed count");
        }
    }

    function testPublishPersistsTable() public {
        require(registry.tableCount() == 0, "initial count");
        vm.warp(1_800_000_000);
        uint256 id = registry.publish("First table", VALID);
        require(id == 1, "first id");
        require(registry.tableCount() == 1, "count");
        (address creator, string memory title, bytes memory layout, uint64 publishedAt) = registry.getTable(id);
        require(creator == address(this), "creator");
        require(keccak256(bytes(title)) == keccak256("First table"), "title");
        require(keccak256(layout) == keccak256(VALID), "layout");
        require(publishedAt == 1_800_000_000, "timestamp");
    }
}
