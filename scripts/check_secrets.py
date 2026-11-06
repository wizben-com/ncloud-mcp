"""Conservative tracked/source-file checks. Never print suspicious content."""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = [
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(rb"github_pat_[A-Za-z0-9_]{30,}"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"https://clovaspeech-gw\.ncloud\.com/external/v1/[0-9]+/[a-f0-9]{24,}"),
]
ASSIGNMENT = re.compile(rb"NCLOUD_SPEECH_SECRET\s*[=:]\s*([^\s\r\n]+)")
EXCLUDED = {".git", ".venv", ".pytest_cache", ".mypy_cache", ".ruff_cache", "__pycache__", "dist"}


def main() -> None:
    tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=False)
    paths = (
        [ROOT / p for p in tracked.stdout.decode().split("\0") if p]
        if tracked.returncode == 0 and tracked.stdout
        else list(ROOT.rglob("*"))
    )
    failures = []
    for path in paths:
        relative = path.relative_to(ROOT)
        if any(part in EXCLUDED for part in relative.parts) or not path.is_file():
            continue
        if path.is_symlink():
            failures.append(str(relative))
            continue
        content = path.read_bytes()
        unsafe_assignment = any(
            not match.group(1).strip(b"\"'").startswith((b"REPLACE_", b"SYNTHETIC"))
            for match in ASSIGNMENT.finditer(content)
        )
        if (
            (path.name.startswith(".env") and path.name != ".env.example")
            or path.suffix.lower() in {".wav", ".mp3", ".m4a", ".mp4", ".pem", ".key"}
            or unsafe_assignment
            or any(pattern.search(content) for pattern in PATTERNS)
        ):
            failures.append(str(relative))
    if failures:
        print(
            "Potential sensitive files (content suppressed): " + ", ".join(failures),
            file=sys.stderr,
        )
        raise SystemExit(1)
    print(
        "Source secret checks passed (patterns and forbidden file types; manual review required)."
    )


if __name__ == "__main__":
    main()
