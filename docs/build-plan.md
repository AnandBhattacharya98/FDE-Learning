# Build plan

The site is built in 11 steps. Each step is small enough to review on its own.

| # | Step | Status |
|---|---|---|
| 1 | Scaffold the repo: `backend/` (FastAPI), `frontend/` (Vite + React), `content/`, `.env.example` files with blank placeholders | Done |
| 2 | Weeks 1–2 content file (now `content/week-01.json` and `content/week-02.json`) and a loader that validates it at startup | Done |
| 3 | Database models: users, quiz attempts, project step progress, submissions. SQLite locally, Postgres (Neon) when deployed | Done |
| 4 | Multi-user auth: sign up, log in, JWT bearer tokens, bcrypt password hashes | Done |
| 5 | Weeks API: list weeks, get one week (quiz answers stripped before sending) | Done |
| 6 | Multiple-choice quiz API: graded on the server, every attempt stored, best score returned | Done |
| 7 | Progress API: project step checklist and submission links per user | Done |
| 8 | React app: theme (light/dark), layout, login, week page with concept cards and resources | Done |
| 9 | Quiz and progress UI: take the quiz, see explanations, tick project steps, save submission links | Done |
| 10 | Illustrations: 18 SVG diagrams, one per brief in the content file | Next |
| 11 | LiveKit voice quiz: token endpoint, agent worker that asks the voice prompts, browser call page; then deploy (Render, Vercel, Neon) | API and site deployed. Worker code and image done; worker hosting and the live call test are waiting on keys |

After step 9 the site was restructured into a Coursera-style course: a syllabus page for weeks 1–6,
and each week split into modules (Start here, three topic modules, Assessment) with lessons, readings,
practice quizzes, a graded quiz (80% to pass), the project and the voice quiz.

## Merging into sunny-side later

- All API routes live under one `APIRouter` (`backend/app/api.py`) mounted at `/api/fde`, so sunny-side can `include_router` it.
- All tables are prefixed `fde_` so they can't clash with sunny-side's tables.
- Settings come from environment variables only, read in `backend/app/config.py`.
- Content is plain JSON in `content/`, one file per block of weeks.
