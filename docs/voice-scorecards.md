# Voice quiz scorecards and leaderboard

After each voice-quiz call the learner sees a scorecard: their score, the topics to review
(linked to the lessons that teach them), each question with a note and the points they missed,
and the full transcript. Below it is a leaderboard of everyone's best scored call, for one week
or the whole course.

## How it works

1. The voice coach (`voice_agent/agent.py`) asks 3 questions. When it's done it calls its
   `record_score` tool with one result per question: correct or not, a note and the missed points.
2. The worker keeps the transcript from LiveKit's `conversation_item_added` events and posts
   everything to `POST /api/fde/internal/voice-quiz/calls` with the `x-worker-key` header.
3. When the room closes it posts again with the full transcript. If the learner hung up before
   scoring, that post saves an unscored card so they can still read the transcript.
4. The API (`backend/app/voice.py`) stores the call in `fde_voice_scorecards` (Neon), works out
   the score and weak topics from the week's content, and also writes a `fde_quiz_attempts`
   row (kind `voice`) so "best so far" and course progress keep working.

Only scored calls count for the leaderboard and course progress.

## Endpoints

| Route | Who | What |
|---|---|---|
| `POST /internal/voice-quiz/calls` | voice worker | save or update one call |
| `GET /weeks/{week}/voice-quiz/scorecards` | learner | their own calls, newest first |
| `GET /voice-quiz/leaderboard[?week_id=]` | any learner | best scored call per learner |
| `GET /admin/voice-scorecards[?user_id=]` | admin | every learner's calls with transcripts |

`voice_summary(db, user_ids)` in `voice.py` gives the cohort view each learner's latest score,
call count and most-missed topics.

## Setup

Nothing new: the worker already needs `API_URL` and `VOICE_WORKER_KEY`, and the table is
created on start-up.
