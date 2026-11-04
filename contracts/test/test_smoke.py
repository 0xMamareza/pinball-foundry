"""Exercise the smoke runner as a real local integration, not a mocked RPC."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SmokeTest(unittest.TestCase):
    def test_ephemeral_chain_publishes_and_reads_two_creators(self):
        run = subprocess.run(
            [sys.executable, str(ROOT / "script" / "smoke.py")],
            cwd=ROOT, capture_output=True, text=True, timeout=90, check=True,
        )
        report = json.loads(run.stdout)
        self.assertEqual(report.get("chainId"), 31337)
        self.assertEqual(report["tableCount"], 2)
        self.assertTrue(report["runtimeMatchesArtifact"])
        self.assertTrue(report["unknownIdRejected"])
        self.assertTrue(report["anvilStopped"])
        self.assertRegex(report["deploymentTx"], r"^0x[0-9a-f]{64}$")
        self.assertEqual([table["id"] for table in report["tables"]], [1, 2])
        self.assertNotEqual(report["tables"][0]["creator"], report["tables"][1]["creator"])
        for table in report["tables"]:
            self.assertRegex(table["publicationTx"], r"^0x[0-9a-f]{64}$")
            self.assertEqual(table["layout"], "0x03002828015050027878")
            self.assertGreater(table["publishedAt"], 0)
            self.assertTrue(table["eventVerified"])


if __name__ == "__main__":
    unittest.main()
