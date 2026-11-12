# Project auto-grading (P1 and P2)

When a learner saves their GitHub repo link on the P1 (call-log app) or P2 (voice bot) page,
the project is graded on its own: cloned, installed, built and tested in a sandbox, then
reviewed by Claude against a rubric. The learner sees the score and feedback under their
submission, and the admin sees every learner's grade in God mode → **Project grader**.

## How it works

```
learner saves repo link ─▶ API stores a GradingRun ─▶ GitHub API: start grade-submission.yml
                                                         │
             ┌───────────────── GitHub Actions (throwaway machine) ─────────────────┐
             │ job "sandbox": no secrets, read-only token                            │
             │   git clone → static checks + secret scan (reads files only)          │
             │   pip install / compileall / pytest / npm run build  ← inside Docker  │
             │   GET the live API and page links                                     │
             │   → result.json                                                       │
             │ job "report": runs no learner code                                    │
             │   POST result.json to /api/fde/grader/report with GRADER_CALLBACK_KEY │
             └───────────────────────────────────────────────────────────────────────┘
                                                         │
API: Claude scores the rubric from the repo excerpts + checks + notes ─▶ score /100 ─▶ learner + God mode
```

- **Why GitHub Actions:** learner code is untrusted, so it never runs inside the API on Render.
  Actions gives a fresh VM per run for free, and the learner's commands run in Docker
  containers inside it with capped memory, CPU and processes and nothing from the host.
  The job that runs learner code holds no secrets; the job that holds the callback key runs
  none of it, and the result file is written by the grader script outside the containers.
- **Score (out of 100):** 60 points of sandbox checks and 40 of rubric review, set per project in
  `content/grading.json`. Checks that don't apply (a repo with no tests) drop out and the rest
  scale up. Without `ANTHROPIC_API_KEY` the checks are scaled to 100. Pass mark: 70.
- **The review:** `claude-opus-5-5` with structured output, so every criterion comes back as a
  number capped at its maximum. The prompt treats the repo and notes as evidence, never
  instructions, and secret-looking strings are masked before they leave the sandbox. Source
  excerpts are deleted from the database once the review is done.
- **Triggers:** saving a new repo link, the learner's "Grade again" (once per 5 minutes), or
  "Regrade" in God mode. A run that doesn't report back within 45 minutes is marked as an error.

### P1 checks
Clones · README with run steps · no committed keys · GET and POST `/calls` · a `calls` table ·
React frontend · Python deps install · code compiles · repo's tests pass · `npm run build` ·
live `GET /calls` returns a JSON list · live page loads.

### P2 checks
Clones · README · no committed LiveKit/model keys · LiveKit Agents dependency · prompt in the repo ·
`.env.example` · Python deps install · code compiles · repo's tests pass · recording link opens.

## Switch it on (about 5 minutes)

1. **GitHub token.** github.com → Settings → Developer settings → Fine-grained tokens → Generate.
   Repository access: only `FDE-Learning`. Permissions: **Actions: Read and write**. Copy it.
2. **Callback key.** Make a long random string:
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`
3. **Render** → the API service → Environment → add
   `GRADER_GITHUB_TOKEN` (step 1), `GRADER_CALLBACK_KEY` (step 2) and, for the rubric review,
   `ANTHROPIC_API_KEY`. Save (it redeploys).
4. **GitHub** → the FDE-Learning repo → Settings → Secrets and variables → Actions →
   New repository secret `GRADER_CALLBACK_KEY` with the same value as step 2.
   Only if the API isn't at `https://fde-learnings.onrender.com`, add a repository
   *variable* `FDE_API_URL` with its address.
5. Open God mode: the three lights on the Project grader panel turn green. Save a repo link on
   the P1 page to try it, and watch the run under the repo's Actions tab.

Never paste these keys into chat or commit them.

Optional: to keep learner repo links out of this repo's public Actions history, put the
workflow and the `grader/` folder in a private repo and set `GRADER_REPO=owner/that-repo`
(private repos get 2,000 free Actions minutes a month; a run takes about 3–8).

## Try the checks locally

```
python grader/run_checks.py --project P1 --repo https://github.com/<you>/<repo> \
  --links '{"api_url": "https://...", "page_url": "https://..."}' --out result.json
```

It needs Docker. `--sandbox none` runs the commands straight on your machine: only do that
with your own code.

## Files

- `content/grading.json`: checks, rubric and points per project
- `grader/run_checks.py`, `grader/report.py`, `.github/workflows/grade-submission.yml`: the sandbox
- `backend/app/grading.py`, `backend/app/models_grading.py`: runs, callback, Claude review, scores
- `frontend/src/components/GradeCard.jsx` (learner), `GraderPanel.jsx` (God mode)
