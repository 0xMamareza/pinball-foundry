// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice A verifier-attested scoreboard, not trustless proof of gameplay or humanity.
contract PinballFoundryLeaderboard {
    struct Score {
        address wallet;
        bytes32 tableId;
        uint256 score;
        bytes32 nonce;
        uint64 expiresAt;
        bytes32 proofHash;
    }

    struct Entry {
        address wallet;
        uint256 score;
    }

    bytes32 public constant SCORE_TYPEHASH = keccak256(
        "Score(address wallet,bytes32 tableId,uint256 score,bytes32 nonce,uint64 expiresAt,bytes32 proofHash)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    address public immutable verifier;
    mapping(bytes32 => bool) public usedNonces;
    mapping(bytes32 => mapping(address => uint256)) public bestScore;
    mapping(bytes32 => Entry[]) private leaders;

    error InvalidVerifier();
    error WrongWallet();
    error Expired();
    error NonceUsed();
    error InvalidScore();
    error InvalidSignature();
    event ScoreSubmitted(
        bytes32 indexed tableId, address indexed wallet, uint256 score, bytes32 indexed nonce, bytes32 proofHash
    );

    constructor(address verifier_) {
        if (verifier_ == address(0)) revert InvalidVerifier();
        verifier = verifier_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("PinballFoundryLeaderboard"), keccak256("1"), block.chainid, address(this)
            )
        );
    }

    function scoreDigest(Score memory s) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(SCORE_TYPEHASH, s.wallet, s.tableId, s.score, s.nonce, s.expiresAt, s.proofHash))
            )
        );
    }

    function submit(Score calldata s, bytes calldata signature) external {
        if (msg.sender != s.wallet) revert WrongWallet();
        // Expiry is deliberately based on chain time, not an offchain clock.
        // forge-lint: disable-next-line(block-timestamp)
        if (s.expiresAt <= block.timestamp) revert Expired();
        if (usedNonces[s.nonce]) revert NonceUsed();
        if (s.tableId == bytes32(0) || s.proofHash == bytes32(0) || s.nonce == bytes32(0)) revert InvalidScore();
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 ss;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            ss := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (
            (v != 27 && v != 28) || uint256(ss) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0
                || ecrecover(scoreDigest(s), v, r, ss) != verifier
        ) revert InvalidSignature();
        usedNonces[s.nonce] = true;
        if (s.score > bestScore[s.tableId][s.wallet]) bestScore[s.tableId][s.wallet] = s.score;
        Entry[] storage list = leaders[s.tableId];
        uint256 index = list.length;
        for (uint256 i; i < list.length; ++i) {
            if (list[i].wallet == s.wallet) {
                index = i;
                break;
            }
        }
        if (index < list.length) {
            if (s.score > list[index].score) list[index].score = s.score;
        } else if (list.length < 20) {
            list.push(Entry(s.wallet, s.score));
        } else if (s.score > list[19].score) {
            index = 19;
            list[index] = Entry(s.wallet, s.score);
        }
        if (index < list.length) {
            while (index > 0 && list[index].score > list[index - 1].score) {
                Entry memory previous = list[index - 1];
                list[index - 1] = list[index];
                list[index] = previous;
                --index;
            }
        }
        emit ScoreSubmitted(s.tableId, s.wallet, s.score, s.nonce, s.proofHash);
    }

    /// @notice At most 20 wallets, descending score; tied arrivals keep their order.
    function getLeaderboard(bytes32 tableId) external view returns (Entry[] memory) {
        return leaders[tableId];
    }
}
