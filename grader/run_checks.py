"""Run the automatic checks on a learner's project repo and write result.json.

This runs on a throwaway GitHub Actions machine (see .github/workflows/grade-submission.yml).
The learner's code is untrusted, so:

  * This script only *reads* the cloned files on the host (static checks, secret scan).
  * Anything that executes learner code (pip install, compile, tests, npm build) runs inside
    a Docker container that gets a copy of the repo and nothing else: no mounts, no tokens,
    no environment from the host, capped memory, CPU and processes. The container can't
    reach this script's files, so it can't change the result.
  * The job that runs this has no secrets and a read-only GitHub token. A separate job
    (grader/report.py) posts result.json to the API.

Usage:
  python grader/run_checks.py --project P1 --repo https://github.com/you/call-log \
      --links '{"page_url": "...", "api_url": "..."}' --out result.json
  Add --sandbox none to run the commands directly (only on a machine you don't mind
  running a stranger's code on, e.g. for local testing with your own repo).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO_RE = re.compile(r"^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?(?:\.git)?/?$")
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build", ".next", ".pytest_cache"}
TEXT_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".toml", ".cfg", ".ini", ".yaml", ".yml",
            ".sql", ".html", ".css", ".env", ".example", ".sh", ".prompt"}
MAX_FILE_BYTES = 200_000
EXCERPT_BUDGET = 60_000  # characters of source sent on for the rubric review

# Never record a secret's value: only the file and what kind it looks like.
SECRET_PATTERNS = [
    ("postgres connection string with a password", re.compile(r"postgres(?:ql)?(?:\+\w+)?://[^\s:/@'\"]+:(?!\s*(?:password|pass|\*+|<|\$\{|\{))[^\s@'\"]{6,}@[^\s'\"]+", re.I)),
    ("Anthropic API key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("OpenAI-style API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("LiveKit API secret", re.compile(r"LIVEKIT_API_SECRET\s*[=:]\s*['\"]?[A-Za-z0-9]{20,}")),
    ("LiveKit API key", re.compile(r"LIVEKIT_API_KEY\s*[=:]\s*['\"]?API[A-Za-z0-9]{8,}")),
    ("Deepgram/ElevenLabs/Cartesia key", re.compile(r"(?:DEEPGRAM|ELEVEN(?:LABS)?|CARTESIA)_API_KEY\s*[=:]\s*['\"]?[A-Za-z0-9_-]{24,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
]

CHECK_IDS = {
    "P1": ["clone", "readme", "no_secrets", "backend_routes", "calls_table", "frontend_react", "py_install",
           "py_compile", "tests", "frontend_build", "live_api", "live_page"],
    "P2": ["clone", "readme", "no_secrets", "livekit_agents", "prompt", "env_example", "py_install", "py_compile",
           "tests", "recording"],
}


class Result:
    def __init__(self, project: str, repo: str):
        self.data = {"project": project, "repo": {"url": repo}, "checks": [], "files": [], "logs": [],
                     "started_at": time.time()}

    def check(self, cid: str, status: str, detail: str = "") -> None:
        assert status in ("pass", "fail", "skip"), status
        self.data["checks"].append({"id": cid, "status": status, "detail": detail[:400]})

    def log(self, name: str, out: str) -> None:
        self.data["logs"].append({"step": name, "tail": out[-3000:]})


# ---------- the sandbox ----------

class Sandbox:
    """Runs commands against a copy of the repo inside a locked-down container."""

    def __init__(self, repo_dir: Path, mode: str):
        self.repo_dir, self.mode, self.containers = repo_dir, mode, {}

    def _container(self, image: str) -> str:
        if image in self.containers:
            return self.containers[image]
        name = f"grade-{os.getpid()}-{len(self.containers)}"
        subprocess.run(["docker", "run", "-d", "--name", name, "--memory", "3g", "--cpus", "2",
                        "--pids-limit", "512", "--security-opt", "no-new-privileges",
                        "-w", "/work", image, "sleep", "3600"], check=True, capture_output=True, timeout=300)
        subprocess.run(["docker", "cp", f"{self.repo_dir}/.", f"{name}:/work"], check=True, capture_output=True, timeout=120)
        self.containers[image] = name
        return name

    def run(self, image: str, workdir: str, cmd: str, timeout: int) -> tuple[int, str]:
        if self.mode == "none":
            argv = ["bash", "-lc", cmd]
            cwd = self.repo_dir / workdir
        else:
            name = self._container(image)
            argv = ["docker", "exec", "-w", f"/work/{workdir}".rstrip("/"), "-e", "CI=true", "-e", "HOME=/tmp",
                    name, "bash", "-lc", cmd]
            cwd = None
        try:
            p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                               env={"PATH": os.environ.get("PATH", ""), "CI": "true", "HOME": os.environ.get("HOME", "/tmp")}
                               if self.mode == "none" else None)
            return p.returncode, (p.stdout + p.stderr)
        except subprocess.TimeoutExpired as e:
            out = (e.stdout or b"") + (e.stderr or b"") if isinstance(e.stdout, bytes) else (e.stdout or "") + (e.stderr or "")
            return 124, (out.decode(errors="replace") if isinstance(out, bytes) else out) + f"\n[timed out after {timeout}s]"

    def close(self) -> None:
        for name in self.containers.values():
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=60)


# ---------- reading the repo (host side, never executes it) ----------

def walk(root: Path) -> list[Path]:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            p = Path(dirpath) / f
            if not p.is_symlink():
                out.append(p)
    return out


def read(p: Path) -> str:
    try:
        if p.stat().st_size > MAX_FILE_BYTES:
            return ""
        return p.read_text(errors="replace")
    except OSError:
        return ""


def is_text(p: Path) -> bool:
    return p.suffix.lower() in TEXT_EXT or p.name.lower() in {"dockerfile", "procfile", ".env", "readme"} or p.name.startswith(".env")


def scan_secrets(root: Path, files: list[Path]) -> list[str]:
    found = []
    for p in files:
        rel = p.relative_to(root).as_posix()
        name = p.name.lower()
        if name == ".env" or (name.startswith(".env.") and not name.endswith(("example", "sample", "template"))):
            body = read(p)
            if re.search(r"^\s*[A-Z0-9_]+\s*=\s*\S+", body, re.M):
                found.append(f"{rel}: a filled-in .env file is committed")
                continue
        if not is_text(p):
            continue
        body = read(p)
        for kind, pat in SECRET_PATTERNS:
            if pat.search(body):
                found.append(f"{rel}: looks like a {kind}")
                break
    return found


def readme_check(root: Path) -> tuple[str, str]:
    readmes = [p for p in root.iterdir() if p.is_file() and p.name.lower().startswith("readme")]
    if not readmes:
        return "fail", "No README at the top of the repo."
    body = read(readmes[0])
    words = len(body.split())
    how = re.search(r"\b(install|npm|pip|uv |uvicorn|python|run|start|docker)\b", body, re.I)
    if words >= 40 and how:
        return "pass", f"{readmes[0].name}: {words} words with run steps."
    return "fail", f"{readmes[0].name} is short ({words} words) or has no run steps."


def find_dirs(root: Path, files: list[Path], marker: str) -> list[Path]:
    return sorted({p.parent for p in files if p.name == marker}, key=lambda d: len(d.parts))


def has_python_tests(root: Path, files: list[Path]) -> bool:
    return any(re.match(r"(test_.*|.*_test)\.py$", p.name) for p in files)


def pick_excerpts(root: Path, files: list[Path]) -> list[dict]:
    """README first, then the most relevant source files, within a size budget."""
    def rank(p: Path) -> tuple:
        n = p.name.lower()
        rel = p.relative_to(root).as_posix().lower()
        if n.startswith("readme"):
            return (0, len(rel))
        if any(k in rel for k in ("prompt", "agent", "main", "app", "server", "api", "calls", "schema", "models")):
            return (1, len(rel))
        if p.suffix in (".py", ".jsx", ".tsx", ".js", ".ts", ".sql"):
            return (2, len(rel))
        if n in ("requirements.txt", "package.json", "pyproject.toml", ".env.example"):
            return (3, len(rel))
        return (9, len(rel))

    out, budget = [], EXCERPT_BUDGET
    for p in sorted((f for f in files if is_text(f) and not f.name.startswith(".env") or f.name.endswith(".example")), key=rank):
        if rank(p)[0] == 9 or p.name in ("package-lock.json",) or budget <= 0:
            continue
        text = read(p)
        if not text.strip():
            continue
        # Mask anything secret-looking before it leaves the sandbox job.
        for _, pat in SECRET_PATTERNS:
            text = pat.sub("[REDACTED]", text)
        text = text[:min(12_000, budget)]
        budget -= len(text)
        out.append({"path": p.relative_to(root).as_posix(), "text": text})
    return out


def http_get(url: str, timeout: int = 25) -> tuple[int, str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "fde-project-grader"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read(200_000).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, "", ""
    except Exception as e:  # noqa: BLE001  (network errors of every kind)
        return 0, "", str(e)[:200]


def safe_url(url: str | None) -> str | None:
    url = (url or "").strip()
    return url if re.match(r"^https?://[^\s/]+\.[^\s]+$", url) and not re.search(r"//(localhost|127\.|10\.|192\.168\.|169\.254\.)", url) else None


# ---------- checks ----------

def static_checks(res: Result, project: str, root: Path, files: list[Path]) -> None:
    st, detail = readme_check(root)
    res.check("readme", st, detail)

    leaks = scan_secrets(root, files)
    res.check("no_secrets", "fail" if leaks else "pass", "; ".join(leaks[:5]) if leaks else "No keys found in the files.")

    texts = {p: read(p) for p in files if p.suffix in (".py", ".js", ".ts", ".jsx", ".tsx", ".sql", ".prisma", ".json", ".toml", ".txt")}
    if project == "P1":
        code = "\n".join(t for p, t in texts.items() if p.suffix in (".py", ".js", ".ts"))
        get = re.search(r"""(\.get|methods=\[?["']GET)[^\n]{0,80}["']/calls/?["']|["']/calls/?["'][^\n]{0,80}GET""", code)
        post = re.search(r"""(\.post|methods=\[?["']POST)[^\n]{0,80}["']/calls/?["']|["']/calls/?["'][^\n]{0,80}POST""", code)
        res.check("backend_routes", "pass" if get and post else "fail",
                  "Found GET and POST /calls." if get and post else f"Missing {'GET ' if not get else ''}{'POST ' if not post else ''}/calls in the code.")
        alltext = "\n".join(texts.values())
        table = re.search(r"create\s+table\s+(if\s+not\s+exists\s+)?[\"`]?calls\b|__tablename__\s*=\s*[\"']calls[\"']|model\s+Calls?\s*\{|Table\(\s*[\"']calls[\"']", alltext, re.I)
        res.check("calls_table", "pass" if table else "fail", "calls table defined." if table else "No calls table definition found.")
        react = any('"react"' in read(p) for p in files if p.name == "package.json")
        res.check("frontend_react", "pass" if react else "fail", "React found in package.json." if react else "No package.json with react.")
    else:
        deps = "\n".join(read(p) for p in files if p.name in ("requirements.txt", "pyproject.toml", "package.json", "uv.lock", "Pipfile"))
        lk = re.search(r"livekit-agents|livekit\.agents|@livekit/agents", deps + "\n".join(texts.values()))
        res.check("livekit_agents", "pass" if lk else "fail", "LiveKit Agents in the dependencies." if lk else "livekit-agents not found.")
        prompt_file = [p for p in files if "prompt" in p.name.lower() or "instruction" in p.name.lower()]
        inline = re.search(r"instructions\s*=\s*(\(|[\"'f]|\w)", "\n".join(t for p, t in texts.items() if p.suffix in (".py", ".js", ".ts")))
        res.check("prompt", "pass" if prompt_file or inline else "fail",
                  f"Prompt in {prompt_file[0].relative_to(root)}." if prompt_file else ("Prompt passed as instructions= in the code." if inline else "No prompt file or instructions= found."))
        ex = [p for p in files if p.name.lower() in (".env.example", ".env.sample", ".env.template", "env.example")]
        res.check("env_example", "pass" if ex else "fail", f"{ex[0].relative_to(root)} present." if ex else "No .env.example.")


def sandbox_checks(res: Result, project: str, root: Path, files: list[Path], box: Sandbox) -> None:
    py_dirs = [d for d in find_dirs(root, files, "requirements.txt") + find_dirs(root, files, "pyproject.toml")]
    py_dirs = sorted(set(py_dirs), key=lambda d: len(d.parts))[:2]
    if not py_dirs:
        res.check("py_install", "fail", "No requirements.txt or pyproject.toml found.")
    else:
        ok, notes = True, []
        for d in py_dirs:
            rel = d.relative_to(root).as_posix() if d != root else ""
            cmd = ("python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -q --upgrade pip && "
                   + ("pip install -q -r requirements.txt" if (d / "requirements.txt").exists() else "pip install -q ."))
            code, out = box.run("python:3.12-slim", rel, cmd, timeout=420)
            res.log(f"pip install ({rel or '.'})", out)
            ok &= code == 0
            notes.append(f"{rel or '.'}: {'ok' if code == 0 else f'failed (exit {code})'}")
        res.check("py_install", "pass" if ok else "fail", "; ".join(notes))

    if any(p.suffix == ".py" for p in files):
        code, out = box.run("python:3.12-slim", "", "python -m compileall -q -x '(node_modules|\\.venv|venv)' .", timeout=120)
        res.log("compileall", out)
        res.check("py_compile", "pass" if code == 0 else "fail", "All .py files compile." if code == 0 else out.strip()[-300:])
    else:
        res.check("py_compile", "fail", "No Python files.")

    if has_python_tests(root, files):
        code, out = box.run("python:3.12-slim", "", ". /tmp/venv/bin/activate 2>/dev/null; pip install -q pytest && python -m pytest -q -x 2>&1 | tail -40", timeout=420)
        # `| tail` hides pytest's exit code, so read the summary line.
        passed = bool(re.search(r"\b\d+ passed\b", out)) and not re.search(r"\b\d+ (failed|error)", out)
        res.log("pytest", out)
        res.check("tests", "pass" if passed else "fail", (re.findall(r"=+ (.+?) =+\s*$", out, re.M) or [out.strip()[-200:]])[-1])
    else:
        res.check("tests", "skip", "The repo has no tests, so this check doesn't count.")

    if project == "P1":
        fe = [p.parent for p in files if p.name == "package.json" and '"react"' in read(p)]
        if not fe:
            res.check("frontend_build", "fail", "No React package.json to build.")
        else:
            d = sorted(fe, key=lambda x: len(x.parts))[0]
            rel = d.relative_to(root).as_posix() if d != root else ""
            pkg = json.loads(read(d / "package.json") or "{}")
            if "build" not in (pkg.get("scripts") or {}):
                res.check("frontend_build", "fail", f"{rel or '.'}/package.json has no build script.")
            else:
                lock = (d / "package-lock.json").exists()
                code, out = box.run("node:20-slim", rel, ("npm ci" if lock else "npm install") + " --no-audit --no-fund && npm run build", timeout=480)
                res.log(f"npm build ({rel or '.'})", out)
                res.check("frontend_build", "pass" if code == 0 else "fail", "npm run build succeeded." if code == 0 else f"npm run build failed (exit {code}).")


def live_checks(res: Result, project: str, links: dict) -> None:
    if project == "P1":
        api = safe_url(links.get("api_url"))
        if not api:
            res.check("live_api", "fail", "No public API link submitted.")
        else:
            url = api.rstrip("/") + ("" if api.rstrip("/").endswith("/calls") else "/calls")
            code, ctype, body = 0, "", ""
            for attempt in range(3):  # Render's free plan sleeps; give it time to wake.
                code, ctype, body = http_get(url, timeout=40)
                if code and code < 500:
                    break
                time.sleep(10)
            try:
                data = json.loads(body)
                rows = data if isinstance(data, list) else next((v for v in data.values() if isinstance(v, list)), None)
            except (ValueError, AttributeError):
                rows = None
            ok = code == 200 and rows is not None
            res.check("live_api", "pass" if ok else "fail",
                      f"GET {url} → 200 with {len(rows)} rows." if ok else f"GET {url} → {code or 'no answer'}{'' if rows is not None else ', not a JSON list'}.")
        page = safe_url(links.get("page_url"))
        if not page:
            res.check("live_page", "fail", "No public page link submitted.")
        else:
            code, ctype, body = http_get(page)
            ok = code == 200 and "<html" in body.lower()
            res.check("live_page", "pass" if ok else "fail", f"{page} → {code or 'no answer'}.")
    else:
        rec = safe_url(links.get("recording_url"))
        if not rec:
            res.check("recording", "fail", "No recording link submitted.")
        else:
            code, _, _ = http_get(rec)
            res.check("recording", "pass" if 200 <= code < 400 else "fail", f"Recording link → {code or 'no answer'}.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, choices=sorted(CHECK_IDS))
    ap.add_argument("--repo", required=True)
    ap.add_argument("--links", default="{}")
    ap.add_argument("--out", default="result.json")
    ap.add_argument("--sandbox", default="docker", choices=["docker", "none"])
    ap.add_argument("--local-dir", help="Grade an already-cloned folder instead of cloning (for tests).")
    a = ap.parse_args(argv)

    res = Result(a.project, a.repo)
    try:
        links = json.loads(a.links or "{}")
        if not isinstance(links, dict):
            links = {}
    except ValueError:
        links = {}
    work = Path(tempfile.mkdtemp(prefix="grade-"))
    root = work / "repo"
    box = None
    try:
        if a.local_dir:
            shutil.copytree(a.local_dir, root, ignore=shutil.ignore_patterns(".git", "node_modules"))
            res.check("clone", "pass", "Local folder.")
        elif not REPO_RE.match(a.repo.strip()):
            res.check("clone", "fail", "The link isn't a GitHub repo link like https://github.com/you/project.")
        else:
            env = {"PATH": os.environ.get("PATH", ""), "GIT_TERMINAL_PROMPT": "0", "HOME": str(work)}
            p = subprocess.run(["git", "clone", "--depth", "1", "--no-recurse-submodules", "-c", "core.symlinks=false",
                                a.repo.strip().removesuffix("/"), str(root)], capture_output=True, text=True, timeout=180, env=env)
            if p.returncode != 0:
                res.check("clone", "fail", "Couldn't clone the repo. Is it public?")
            else:
                sha = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, env=env).stdout.strip()
                res.data["repo"]["commit"] = sha
                res.check("clone", "pass", f"Cloned at {sha[:7]}.")

        if root.exists():
            files = walk(root)
            res.data["repo"]["files"] = len(files)
            res.data["repo"]["tree"] = sorted(p.relative_to(root).as_posix() for p in files)[:300]
            static_checks(res, a.project, root, files)
            res.data["files"] = pick_excerpts(root, files)
            box = Sandbox(root, a.sandbox)
            sandbox_checks(res, a.project, root, files, box)
        live_checks(res, a.project, links)
    except Exception as e:  # noqa: BLE001  — report a grader fault instead of a missing result
        res.data["error"] = f"{type(e).__name__}: {e}"[:500]
    finally:
        if box:
            box.close()
        shutil.rmtree(work, ignore_errors=True)

    # Anything not reached counts as failed, so a crash can't raise a score.
    done = {c["id"] for c in res.data["checks"]}
    for cid in CHECK_IDS[a.project]:
        if cid not in done:
            res.check(cid, "fail", "Not checked: an earlier step failed.")
    res.data["seconds"] = round(time.time() - res.data.pop("started_at"))
    Path(a.out).write_text(json.dumps(res.data, indent=1))
    passed = sum(c["status"] == "pass" for c in res.data["checks"])
    print(f"{a.project}: {passed}/{len(res.data['checks'])} checks passed in {res.data['seconds']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
