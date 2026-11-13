# God mode (admin dashboard)

A private dashboard at `/god` that shows the admin's own required FDE assignments
(from `content/assignments.json`, taken from the FDE Training Plan and the Weeks 1–2 Kickoff)
and a live view of the site's internals: services, counts and recent activity.

## Who can open it

Both checks run on the server for every request:

1. The account's email is listed in the `ADMIN_EMAILS` env var (comma-separated) on Render.
2. The person signed in **with Google**. A password log-in is refused even with the same
   email, because password sign-up doesn't prove anyone owns the address.

Everyone else gets a plain 404, and the "GOD MODE" link in the top bar only appears for the admin.
With `ADMIN_EMAILS` empty, nobody gets in.

## Setup

1. Render → the API service → Environment → add `ADMIN_EMAILS` with your Google address. Save (it redeploys).
2. Make sure Google sign-in is set up (see `google-sign-in.md`).
3. Sign out, sign in with Google, and open `/god` or use the GOD MODE link.

## Status of each assignment

- P1 and P2 follow your course checklist automatically: not started, in progress once any step
  or submission field is filled, done when every step and field is filled.
- Every other assignment starts as not started. Set it with the buttons on its card and add a note.
- A status you set by hand wins. On P1/P2, "Follow course progress again" clears it.
- New weeks: add entries to `content/assignments.json` (unique `id`, `week` as shown on the board).

## Build log (keep it updated)

`content/build-log.json` holds one entry per shipped feature: where it lives in the code,
how it works in plain English, and a tiny demo (commands, output and notes). God mode shows
the entries on the assignment cards they practise and as a timeline under the assignment bus.

**Every PR that ships a feature appends one entry to the end of `entries`, in the same PR.**
The fields are described at the top of the file. `assignments` uses ids from
`content/assignments.json` (it can be empty). The API checks the file at start-up and the tests
fail on a bad entry, so a mistake can't take the live site down. Never put emails, keys or
connection strings in it.

## Cohort view

The **Cohort** panel lists every learner as one row (names only, never emails): status, the top
flag or next item, overall progress, score pills (graded-quiz average, latest voice score, project
grades) and last activity. Stuck learners sort first. Click a row to open their stats drawer:
stat tiles, flags, weak topics, every week's items and quiz/voice/practice scores, project links,
voice calls with transcripts and all quiz attempts.

A learner is flagged **stuck** when any of these is true (constants at the top of `backend/app/cohort.py`):

- no activity for 3 days while the course isn't finished,
- signed up 2+ days ago and has done nothing,
- 2+ graded-quiz attempts on a week without passing,
- practice quizzes average under 50% over 2+ attempts.

API: `GET /api/fde/admin/learners` and `GET /api/fde/admin/learners/{id}`, both behind `require_admin`.
Other features add per-learner data with `LEARNER_EXTRAS["key"] = fn(db, user_ids) -> {user_id: {...}}`;
the value appears on each row under that key (voice scorecards use `voice`, project grades use `grades`).

## Statuses that keep themselves up to date

A build-log entry can also move your assignments forward with `status_updates`:

```json
"status_updates": [
  {"assignment": "w3-p3", "status": "doing", "note": "what was built and what's left", "at": "2026-11-12T16:30:00Z"}
]
```

God mode shows whichever is newest: your own click, or the latest update from shipped work.
The card says which one it is. "Back to automatic" drops your click and keeps your note.
P1 and P2 follow your course checklist when neither has set them. Only claim what's true:
site work that practises an assignment is `doing`; `done` means your own deliverable is submitted.
