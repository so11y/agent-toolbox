"""Install the server runtime and selected canonical skill sources from stdin."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def install(bundle):
    home = Path.home()
    runtime = home / ".local/lib/project-consult"
    skill_root = home / ".claude/skills"
    files = bundle["programs"]
    if set(files) != {"remote_review.py", "run_control.py", "history.py"}:
        raise ValueError("Unexpected server program set.")
    catalog = {"version": 1, "skills": []}
    decoded = []
    for entry in bundle["skills"]:
        name = entry["name"]
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
            raise ValueError("Invalid skill name.")
        body = base64.b64decode(entry["body"], validate=True)
        decoded.append((name, body))
        catalog["skills"].append({"name": name, "description": entry["description"],
                                  "sha256": hashlib.sha256(body).hexdigest()})
    programs = {name: base64.b64decode(body, validate=True) for name, body in files.items()}
    for name, body in programs.items():
        compile(body, name, "exec")
    def write(target, body, mode=0o600):
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".install.tmp")
        temporary.write_bytes(body)
        temporary.chmod(mode)
        temporary.replace(target)
    for name, body in programs.items():
        write(runtime / name, body)
    write(runtime / "history-config.json", (json.dumps({"proxy": bundle["proxy"]}) + "\n").encode())
    for name, body in decoded:
        write(skill_root / name / "SKILL.md", body)
    write(skill_root / ".project-consult.json", (json.dumps(catalog, indent=2) + "\n").encode())
    launcher = '#!/bin/sh\nexec python3 "$HOME/.local/lib/project-consult/history.py" "$@"\n'
    write(home / ".local/bin/claude-history", launcher.encode(), 0o755)
    return {"status": "installed", "programs": sorted(programs), "skills": [name for name, _ in decoded]}


if __name__ == "__main__":
    os.umask(0o077)
    if os.geteuid() == 0:
        raise SystemExit("Install as the non-root account that runs Claude.")
    print(json.dumps(install(json.load(sys.stdin))))
