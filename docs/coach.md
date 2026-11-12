# Ask the coach

A chat (and voice) agent that answers learners' questions from the course content. Signed-in
learners see an **Ask the coach** pill in the bottom-right corner of every page.

## How it answers

1. On start-up the API cuts every week's lessons, readings, projects and voice-quiz prompts into
   passages, each tagged with the course page it came from (`backend/app/coach.py`).
   The graded quiz is never indexed, so the coach can't hand out quiz answers.
2. A question is ranked against the passages with BM25 (keyword search, no extra service),
   with a boost for the week the learner is looking at.
3. With `ANTHROPIC_API_KEY` set, Claude writes the answer from the top 5 passages only and
   cites them as [1], [2]. The chat shows those sources as chips that open the lesson.
   Without the key, or if the call fails, the coach answers by quoting the best passages.

New weeks need no extra work: add `content/week-NN.json` and the coach indexes it on the next deploy.

## Setup (Render → API service → Environment)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on AI answers. Create a key at console.anthropic.com. Blank = search-only answers. |
| `COACH_MODEL` | Optional. Defaults to `claude-haiku-5-5`. |
| `COACH_HOURLY_LIMIT` | Optional. Questions per learner per hour, default 40. |

## Voice

The mic button in the chat starts a LiveKit call (`POST /api/fde/coach/voice/token`). It uses the same
worker as the voice quiz (`voice_agent/agent.py`): when the room metadata has `"mode": "coach"`, the
worker runs `CourseCoach`, which looks things up through `POST /api/fde/coach/internal/search`
(protected by `VOICE_WORKER_KEY`). So voice needs the LiveKit keys and the worker running, the same as
the voice quiz.

## God mode

Every question is stored in `fde_coach_questions`. God mode shows the count, a **Coach AI** chip in the
system schematic (on when the key is set) and recent questions in the live terminal.
