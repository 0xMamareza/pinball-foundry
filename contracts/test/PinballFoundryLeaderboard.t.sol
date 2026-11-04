// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PinballFoundryLeaderboard as Board} from "../src/PinballFoundryLeaderboard.sol";

interface LeaderboardVm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function expectRevert(bytes4) external;
}

contract PinballFoundryLeaderboardTest {
    LeaderboardVm constant vm = LeaderboardVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant KEY = 0x123456; // Disposable test-only key.
    bytes32 constant TABLE = keccak256("official-table");
    Board board;
    address alice;

    function setUp() public {
        board = new Board(vm.addr(KEY));
        alice = vm.addr(0xabcdef);
    }

    function record(address wallet, uint256 score, uint256 nonce) internal view returns (Board.Score memory) {
        return Board.Score(wallet, TABLE, score, bytes32(nonce), uint64(block.timestamp + 900), keccak256("proof"));
    }

    function signature(Board.Score memory s) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(KEY, board.scoreDigest(s));
        return abi.encodePacked(r, ss, v);
    }

    function submit(address wallet, uint256 score, uint256 nonce) internal {
        Board.Score memory s = record(wallet, score, nonce);
        bytes memory sig = signature(s);
        vm.prank(wallet);
        board.submit(s, sig);
    }

    function testRejectsTamperedScore() public {
        Board.Score memory s = record(alice, 100, 1);
        bytes memory sig = signature(s);
        s.score = 999999;
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        board.submit(s, sig);
    }

    function testRejectsTamperedBindings() public {
        for (uint256 i; i < 5; ++i) {
            Board.Score memory s = record(alice, 100, 1);
            bytes memory sig = signature(s);
            if (i == 0) s.tableId = keccak256("other");
            if (i == 1) s.nonce = bytes32(uint256(2));
            if (i == 2) s.expiresAt += 1;
            if (i == 3) s.proofHash = keccak256("other");
            if (i == 4) s.wallet = vm.addr(123);
            vm.prank(s.wallet);
            vm.expectRevert(Board.InvalidSignature.selector);
            board.submit(s, sig);
        }
    }

    function testRejectsNonceReplay() public {
        submit(alice, 100, 1);
        Board.Score memory s = record(alice, 200, 1);
        bytes memory sig = signature(s);
        vm.prank(alice);
        vm.expectRevert(Board.NonceUsed.selector);
        board.submit(s, sig);
    }

    function testRejectsWrongWallet() public {
        Board.Score memory s = record(alice, 100, 1);
        bytes memory sig = signature(s);
        vm.expectRevert(Board.WrongWallet.selector);
        board.submit(s, sig);
    }

    function testRejectsExpiryAtExactTimestamp() public {
        Board.Score memory s = record(alice, 100, 1);
        bytes memory sig = signature(s);
        vm.warp(s.expiresAt);
        vm.prank(alice);
        vm.expectRevert(Board.Expired.selector);
        board.submit(s, sig);
    }

    function testRejectsWrongChain() public {
        Board.Score memory s = record(alice, 100, 1);
        bytes memory sig = signature(s);
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        board.submit(s, sig);
    }

    function testRejectsWrongContract() public {
        Board other = new Board(vm.addr(KEY));
        Board.Score memory s = record(alice, 100, 1);
        bytes memory sig = signature(s);
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        other.submit(s, sig);
    }

    function testRejectsWrongSignerAndMalformedSignature() public {
        Board.Score memory s = record(alice, 100, 1);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(0x777, board.scoreDigest(s));
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        board.submit(s, abi.encodePacked(r, ss, v));
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        board.submit(s, hex"01");
        bytes memory sig = signature(s);
        sig[64] = bytes1(uint8(1));
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        board.submit(s, sig);
    }

    function testRejectsHighSMalleability() public {
        Board.Score memory s = record(alice, 100, 1);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(KEY, board.scoreDigest(s));
        bytes32 highS = bytes32(0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141 - uint256(ss));
        vm.prank(alice);
        vm.expectRevert(Board.InvalidSignature.selector);
        board.submit(s, abi.encodePacked(r, highS, v == 27 ? uint8(28) : uint8(27)));
    }

    function testRejectsZeroVerifierAndEmptyBindings() public {
        vm.expectRevert(Board.InvalidVerifier.selector);
        new Board(address(0));
        for (uint256 i; i < 3; ++i) {
            Board.Score memory s = record(alice, 100, 1);
            if (i == 0) s.nonce = bytes32(0);
            if (i == 1) s.tableId = bytes32(0);
            if (i == 2) s.proofHash = bytes32(0);
            bytes memory sig = signature(s);
            vm.prank(alice);
            vm.expectRevert(Board.InvalidScore.selector);
            board.submit(s, sig);
        }
    }

    function testBestNeverDecreasesAndTablesAreIndependent() public {
        submit(alice, 200, 1);
        submit(alice, 100, 2);
        submit(alice, 200, 3);
        require(board.bestScore(TABLE, alice) == 200, "best decreased");
        require(board.getLeaderboard(TABLE).length == 1, "duplicate wallet");
        Board.Score memory s = record(alice, 50, 4);
        s.tableId = keccak256("second table");
        bytes memory sig = signature(s);
        vm.prank(alice);
        board.submit(s, sig);
        require(board.bestScore(s.tableId, alice) == 50, "table binding");
    }

    function testTop20SortedBoundedAndStableTies() public {
        require(board.getLeaderboard(TABLE).length == 0, "empty");
        for (uint256 i = 1; i <= 25; ++i) {
            submit(address(uint160(i)), i * 100, i);
        }
        Board.Entry[] memory top = board.getLeaderboard(TABLE);
        require(top.length == 20 && top[0].score == 2500 && top[19].score == 600, "top20");
        for (uint256 i; i < top.length - 1; ++i) {
            require(top[i].score >= top[i + 1].score, "order");
        }
        require(board.bestScore(TABLE, address(1)) == 100, "evicted best lost");
        submit(alice, 2500, 26);
        top = board.getLeaderboard(TABLE);
        require(top[0].wallet == address(25) && top[1].wallet == alice, "stable tie");
        submit(address(1), 5000, 27);
        require(board.getLeaderboard(TABLE)[0].wallet == address(1), "reentry");
        submit(alice, 6000, 28);
        require(board.getLeaderboard(TABLE)[0].wallet == alice, "update");
    }

    function testZeroScoreIsValidButDoesNotInflateBest() public {
        submit(alice, 0, 1);
        require(board.bestScore(TABLE, alice) == 0, "zero");
        require(board.getLeaderboard(TABLE).length == 1, "zero entry");
    }

    function testFuzzBestMonotonic(uint128 a, uint128 b) public {
        submit(alice, a, 1);
        submit(alice, b, 2);
        require(board.bestScore(TABLE, alice) == (a > b ? a : b), "monotonic");
        require(board.getLeaderboard(TABLE).length == 1, "duplicate");
    }

    function testAcceptsAttestedScoreAndTracksBest() public {
        submit(alice, 100, 1);
        require(board.bestScore(TABLE, alice) == 100, "best score");
        require(board.usedNonces(bytes32(uint256(1))), "nonce not consumed");
        Board.Entry[] memory leaders = board.getLeaderboard(TABLE);
        require(leaders.length == 1 && leaders[0].wallet == alice && leaders[0].score == 100, "leaders");
    }
}
