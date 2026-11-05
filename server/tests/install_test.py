"""Exercise server installation and request framing without calling Claude."""
import base64
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

SERVER = Path(__file__).resolve().parents[1]
RUNTIME = SERVER / "claude-consult"
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(RUNTIME))
import install as installer
import remote_review


class ServerInstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="consult-install-test-")
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.body = b"---\r\nname: fixture-guide\r\ndescription: A test guide.\r\n---\r\nKeep the selected scope.\r\n"
        self.bundle = {
            "programs": {
                name: base64.b64encode((RUNTIME / name).read_bytes()).decode()
                for name in ("remote_review.py", "run_control.py", "history.py")
            },
            "skills": [{"name": "fixture-guide", "description": "A test guide.",
                        "body": base64.b64encode(self.body).decode()}],
            "proxy": "http://127.0.0.1:8118",
        }
        self.environment = {**os.environ, "HOME": str(self.home), "PYTHONDONTWRITEBYTECODE": "1"}

    def install(self):
        with patch.object(Path, "home", return_value=self.home):
            return installer.install(self.bundle)

    def test_install_update_and_native_history(self):
        skill_root = self.home / ".claude/skills"
        unrelated = skill_root / "personal/SKILL.md"
        unrelated.parent.mkdir(parents=True)
        unrelated.write_bytes(b"Keep this personal skill.")
        self.assertEqual(self.install()["status"], "installed")
        runtime = self.home / ".local/lib/project-consult"
        for name in self.bundle["programs"]:
            self.assertEqual((runtime / name).read_bytes(), (RUNTIME / name).read_bytes())
        self.assertEqual(json.loads((runtime / "history-config.json").read_text()),
                         {"proxy": self.bundle["proxy"]})
        launcher = self.home / ".local/bin/claude-history"
        history = subprocess.run([str(launcher), "--list-json"], env=self.environment,
                                 capture_output=True, text=True, timeout=5, check=True)
        self.assertEqual(json.loads(history.stdout), [])
        self.assertEqual((runtime / "remote_review.py").stat().st_mode & 0o777, 0o600)

        # The installed catalog must work with the actual reasoning-loop consumer.
        with patch.object(remote_review, "GUIDE_ROOT", skill_root):
            analysis = self.home / "first-turn"
            analysis.mkdir()
            first = remote_review.snapshot_guides(analysis)
            self.assertEqual(first["availableSkills"], ["fixture-guide"])
            self.assertEqual((analysis / "guides/fixture-guide/SKILL.md").read_bytes(), self.body)

            self.body += b"Use the updated rule.\r\n"
            self.bundle["skills"][0]["body"] = base64.b64encode(self.body).decode()
            self.install()
            analysis = self.home / "next-turn"
            analysis.mkdir()
            second = remote_review.snapshot_guides(analysis)
            self.assertNotEqual(first["guideSetId"], second["guideSetId"])
            self.assertEqual((analysis / "guides/fixture-guide/SKILL.md").read_bytes(), self.body)
        self.assertEqual(unrelated.read_bytes(), b"Keep this personal skill.")

    def test_invalid_program_is_rejected_before_installation(self):
        self.bundle["programs"]["remote_review.py"] = base64.b64encode(b"def invalid(").decode()
        with self.assertRaises(SyntaxError):
            self.install()
        self.assertFalse((self.home / ".local").exists())

    def test_request_frame_preserves_following_cancel(self):
        request = {"control": {"key": str(uuid.uuid4()), "runId": str(uuid.uuid4())},
                   "message": "A request with an embedded\nnewline."}
        worker = """
import json,sys,time
sys.path.insert(0,sys.argv[1])
import remote_review,run_control
request=json.loads(remote_review.read_request())
lease=run_control.Lease(request['control'])
deadline=time.monotonic()+2
while not lease.check() and time.monotonic()<deadline:
    time.sleep(.02)
print(json.dumps({'request':request,'reason':lease.check()}))
"""
        frame = base64.b64encode(gzip.compress(json.dumps(request).encode())) + b"\ncancel\n"
        result = subprocess.run([sys.executable, "-c", worker, str(RUNTIME)], input=frame,
                                capture_output=True, env=self.environment, timeout=5, check=True)
        reply = json.loads(result.stdout)
        self.assertEqual(reply["request"], request)
        self.assertEqual(reply["reason"], "cancelled")


if __name__ == "__main__":
    unittest.main(verbosity=2)
