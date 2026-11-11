# Build plan

The site is built in 11 steps. Each step is small enough to review on its own.

| # | Step | Status |
|---|---|---|
| 1 | Scaffold the repo: `backend/` (FastAPI), `frontend/` (Vite + React), `content/`, `.env.example` files with blank placeholders | Done |
| 2 | Weeks 1–2 content file (`content/week-01-02.json`) and a loader that validates it at startup | Done |
| 3 | Database models: users, quiz attempts, project step progress, submissions. SQLite locally, Postgres (Neon) when deployed | Done |
| 4 | Multi-user auth: sign up, log in, JWT bearer tokens, bcrypt password hashes | Done |
| 5 | Weeks API: list weeks, get one week (quiz answers stripped before sending) | Done |
| 6 | Multiple-choice quiz API: graded on the server, every attempt stored, best score returned | Done |
| 7 | Progress API: project step checklist and submission links per user | Done |
| 8 | React app: theme (light/dark), layout, login, week page with concept cards and resources | Done |
| 9 | Quiz and progress UI: take the quiz, see explanations, tick project steps, save submission links | Done |
| 10 | Illustrations: 18 SVG diagrams, one per brief in the content file | Next |
| 11 | LiveKit voice quiz: token endpoint, agent worker that asks the voice prompts, browser call page; then deploy (Render, Vercel, Neon) | Started: token endpoint and worker skeleton |

## Merging into sunny-side later

- All API routes live under one `APIRouter` (`backend/app/api.py`) mounted at `/api/fde`, so sunny-side can `include_router` it.
- All tables are prefixed `fde_` so they can't clash with sunny-side's tables.
- Settings come from environment variables only, read in `backend/app/config.py`.
- Content is plain JSON in `content/`, one file per block of weeks.
