// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface RunVm {
    function getCode(string calldata artifactPath) external returns (bytes memory);
    function prank(address sender) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function deal(address, uint256) external;
}
interface RankedStart {
    function startRun(bytes32 tableId) external;
    function officialTable(bytes32 tableId) external view returns (bool);
}
contract PinballFoundryRankedStartTest {
    RunVm constant vm = RunVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    event RunStarted(address indexed wallet, bytes32 indexed tableId);
    bytes32 constant FIRST = keccak256("official first");
    bytes32 constant SECOND = keccak256("official second");
    RankedStart target;
    function setUp() public {
        bytes memory code = abi.encodePacked(vm.getCode("PinballFoundryRankedStart.sol:PinballFoundryRankedStart"), abi.encode(FIRST, SECOND));
        address deployed;
        assembly { deployed := create(0, add(code, 32), mload(code)) }
        require(deployed != address(0), "deploy");
        target = RankedStart(deployed);
    }
    function testEmitsCallerAndOfficialTable() public {
        address alice = address(0xA11CE);
        require(target.officialTable(FIRST) && target.officialTable(SECOND), "official tables");
        vm.expectEmit(true, true, false, true, address(target));
        emit RunStarted(alice, FIRST);
        vm.prank(alice);
        target.startRun(FIRST);
        target.startRun(SECOND);
        target.startRun(FIRST);
    }
    function testRejectsUnofficialTableAndEther() public {
        (bool arbitrary,) = address(target).call(abi.encodeCall(target.startRun, (keccak256("custom"))));
        require(!arbitrary, "custom table");
        (bool zero,) = address(target).call(abi.encodeCall(target.startRun, (bytes32(0))));
        require(!zero, "zero table");
        vm.deal(address(this), 1 ether);
        (bool paid,) = address(target).call{value: 1}(abi.encodeCall(target.startRun, (FIRST)));
        (bool receiveEther,) = address(target).call{value: 1}("");
        require(!paid && !receiveEther && address(target).balance == 0, "no service fee");
    }
    function testRejectsInvalidImmutableTableSet() public {
        bytes memory code = vm.getCode("PinballFoundryRankedStart.sol:PinballFoundryRankedStart");
        bytes memory args = abi.encodePacked(code, abi.encode(FIRST, FIRST));
        address deployed;
        assembly { deployed := create(0, add(args, 32), mload(args)) }
        require(deployed == address(0), "duplicate tables");
        args = abi.encodePacked(code, abi.encode(bytes32(0), SECOND));
        assembly { deployed := create(0, add(args, 32), mload(args)) }
        require(deployed == address(0), "zero table");
    }
}
