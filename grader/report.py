"""Send result.json from the sandbox job to the FDE API.

Runs in its own job, which never executes learner code. Needs:
  GRADER_CALLBACK_KEY  (repo secret, same value as on Render)
  FDE_API_URL          (repo variable, defaults to the Render URL)
  RUN_ID, RUN_TOKEN, RUN_URL, SANDBOX_RESULT  (set by the workflow)
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path


def main() -> int:
    api = (os.environ.get("FDE_API_URL") or "https://fde-learnings.onrender.com").rstrip("/")
    key = os.environ.get("GRADER_CALLBACK_KEY", "")
    if not key:
        print("GRADER_CALLBACK_KEY isn't set as a repo secret; can't report.")
        return 1
    path = Path(os.environ.get("RESULT_PATH", "result/result.json"))
    result = None
    if path.exists() and path.stat().st_size < 2_000_000:
        try:
            result = json.loads(path.read_text())
        except ValueError:
            result = None
    body = {
        "run_id": int(os.environ["RUN_ID"]),
        "token": os.environ["RUN_TOKEN"],
        "run_url": os.environ.get("RUN_URL", ""),
        "result": result,
        "error": None if result else f"The sandbox job ended with '{os.environ.get('SANDBOX_RESULT', 'unknown')}' and left no result.",
    }
    req = urllib.request.Request(f"{api}/api/fde/grader/report", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Grader-Key": key,
                                          "User-Agent": "fde-project-grader"})
    for attempt in range(4):  # Render's free plan may be asleep.
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                print("Reported:", r.status)
                return 0
        except urllib.error.HTTPError as e:
            print("API said", e.code)
            if e.code < 500:
                return 1
        except Exception as e:  # noqa: BLE001
            print("Couldn't reach the API:", type(e).__name__)
        time.sleep(20)
    return 1


if __name__ == "__main__":
    sys.exit(main())
