"""Deploy/publish/read on fresh loopback-only Anvil; never accepts real RPCs or keys."""
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LAYOUT = "0x03002828015050027878"


class RpcError(RuntimeError):
    pass


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, timeout=60).strip()


def decode_table(encoded):
    data = bytes.fromhex(encoded.removeprefix("0x"))
    assert len(data) >= 128, "truncated table return"

    def dynamic(head):
        offset = int.from_bytes(data[head:head + 32], "big")
        length = int.from_bytes(data[offset:offset + 32], "big")
        value = data[offset + 32:offset + 32 + length]
        assert len(value) == length, "truncated dynamic return"
        return value

    return {
        "creator": "0x" + data[12:32].hex(),
        "title": dynamic(32).decode("ascii"),
        "layout": "0x" + dynamic(64).hex(),
        "publishedAt": int.from_bytes(data[96:128], "big"),
    }


def run():
    tools: dict[str, str] = {}
    for name in ("forge", "cast", "anvil"):
        executable = shutil.which(name)
        if executable is None:
            raise RuntimeError("Install Foundry and put forge, cast and anvil on PATH")
        tools[name] = executable
    subprocess.run(
        [tools["forge"], "build", "--root", str(ROOT)],
        cwd=ROOT, stdout=sys.stderr, check=True, timeout=60,
    )
    artifact = json.loads((ROOT / "out/PinballFoundryRegistry.sol/PinballFoundryRegistry.json").read_text())
    assert artifact["abi"] == json.loads((ROOT / "PinballFoundryRegistry.abi.json").read_text()), "stale ABI"
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def rpc(method, params):
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"})
        with opener.open(request, timeout=2) as response:
            result = json.load(response)
        if "error" in result:
            raise RpcError(json.dumps(result["error"]))
        return result["result"]

    def calldata(signature, *args):
        return command(tools["cast"], "calldata", signature, *map(str, args))

    def receipt(tx):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = rpc("eth_getTransactionReceipt", [tx])
            if result is not None:
                assert int(result["status"], 16) == 1, f"transaction failed: {tx}"
                return result
            time.sleep(0.05)
        raise TimeoutError(f"receipt unavailable: {tx}")

    def call(address, data, sender=None):
        request = {"to": address, "data": data}
        if sender is not None:
            request["from"] = sender
        return rpc("eth_call", [request, "latest"])

    # Anvil generates random local accounts; mnemonic/private-key output is discarded.
    process = subprocess.Popen(
        [tools["anvil"], "--host", "127.0.0.1", "--port", str(port), "--chain-id", "31337",
         "--accounts", "2", "--mnemonic-random", "12", "--hardfork", "prague", "--no-cors", "--quiet"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 15
        while True:
            if process.poll() is not None:
                raise RuntimeError("Disposable Anvil exited before startup")
            try:
                chain_id = int(rpc("eth_chainId", []), 16)
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if time.monotonic() > deadline:
                    raise TimeoutError("Disposable Anvil did not become ready")
                time.sleep(0.05)
        assert chain_id == 31337, "refusing nonlocal chain"
        accounts = rpc("eth_accounts", [])
        assert len(accounts) == 2
        deployment_tx = rpc("eth_sendTransaction", [{
            "from": accounts[0], "data": artifact["bytecode"]["object"], "gas": hex(6_000_000), "value": "0x0",
        }])
        address = receipt(deployment_tx)["contractAddress"]
        runtime = rpc("eth_getCode", [address, "latest"])
        assert runtime.lower() == artifact["deployedBytecode"]["object"].lower(), "runtime differs from artifact"
        count_data = calldata("tableCount()")
        assert int(call(address, count_data), 16) == 0
        event_topic = command(tools["cast"], "keccak", "TablePublished(uint256,address,string,bytes)")
        tables = []
        for table_id, creator in enumerate(accounts, start=1):
            title = f"Local smoke {table_id}"
            data = calldata("publish(string,bytes)", title, LAYOUT)
            assert int(call(address, data, creator), 16) == table_id, "publish returned wrong id"
            tx = rpc("eth_sendTransaction", [{
                "from": creator, "to": address, "data": data, "gas": hex(2_000_000), "value": "0x0",
            }])
            mined = receipt(tx)
            table = decode_table(call(address, calldata("getTable(uint256)", table_id)))
            block = rpc("eth_getBlockByNumber", [mined["blockNumber"], False])
            assert table == {
                "creator": creator.lower(), "title": title, "layout": LAYOUT,
                "publishedAt": int(block["timestamp"], 16),
            }, "persistent readback mismatch"
            assert len(mined["logs"]) == 1
            log = mined["logs"][0]
            assert log["address"].lower() == address.lower()
            assert [topic.lower() for topic in log["topics"]] == [
                event_topic.lower(), "0x" + f"{table_id:064x}", "0x" + creator[2:].lower().zfill(64),
            ], "indexed event mismatch"
            expected_data = command(tools["cast"], "abi-encode", "f(string,bytes)", title, LAYOUT)
            assert log["data"].lower() == expected_data.lower(), "event payload mismatch"
            table.update(id=table_id, publicationTx=tx, eventVerified=True, gasUsed=int(mined["gasUsed"], 16))
            tables.append(table)
            assert int(call(address, count_data), 16) == table_id
        assert decode_table(call(address, calldata("getTable(uint256)", 1)))["creator"] == accounts[0].lower()
        not_found = command(tools["cast"], "sig", "TableNotFound()")
        for invalid_id in (0, 3):
            try:
                call(address, calldata("getTable(uint256)", invalid_id))
            except RpcError as error:
                assert not_found in str(error), "unexpected revert"
            else:
                raise AssertionError("unknown id accepted")
        report = {
            "chainId": chain_id, "contract": address, "deploymentTx": deployment_tx,
            "tableCount": int(call(address, count_data), 16), "runtimeMatchesArtifact": True,
            "unknownIdRejected": True, "tables": tables,
        }
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    report["anvilStopped"] = process.poll() is not None
    assert report["anvilStopped"], "failed to stop disposable Anvil"
    return report


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
