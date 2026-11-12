# FDE-Learning

All new FDEs can learn more about voice bots, and quiz themselves on it.

A multi-user training site for RevRag's Forward Deployed Engineers, built one block of weeks at a time.
Each week has concept cards, the projects to build (with a step checklist and submission links),
a multiple-choice quiz and a LiveKit voice quiz.

| Folder | What it is |
|---|---|
| `content/` | One JSON file per block of weeks. `week-01-02.json` comes from the weeks 1–2 kickoff deck. |
| `backend/` | FastAPI API: accounts, weeks, quiz grading, progress, LiveKit tokens. |
| `frontend/` | React (Vite) site. |
| `voice_agent/` | LiveKit Agents worker that runs the voice quiz. |
| `docs/build-plan.md` | The 11-step build list and how this merges into sunny-side later. |
| `docs/google-sign-in.md` | Turning on "Sign in with Google": Google Cloud setup and env vars. |

## Run it on your laptop

You need Python 3.11+ and Node 20+.

```bash
# 1. API (uses a local SQLite file if DATABASE_URL is blank)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # fill in later; works blank for local use
uvicorn app.main:app --reload --port 8000

# 2. Site, in a second terminal
cd frontend
npm install
cp .env.example .env          # set VITE_API_URL=http://localhost:8000
npm run dev                   # open http://localhost:5173

# 3. Voice quiz worker (optional, needs LiveKit keys), in a third terminal
cd voice_agent
pip install -r requirements.txt
cp .env.example .env
python agent.py dev
```

Run the tests with `cd backend && pytest`.

## Keys and where they go

Keys never go in code, GitHub, chat or screenshots. Locally they go in each folder's `.env`
(git-ignored). Online they go in each host's settings page.

| Variable | Where you get it | Goes in |
|---|---|---|
| `DATABASE_URL` | Neon → your project → **Connect**. Click Show password, then copy the whole string on one line. | `backend/.env`, Render |
| `JWT_SECRET` | Make one: `python -c "import secrets; print(secrets.token_urlsafe(48))"` | `backend/.env`, Render |
| `VOICE_WORKER_KEY` | Make one the same way. Must match in both places. | `backend/.env`, `voice_agent/.env`, Render, wherever the worker runs |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud → your project → **Settings → API keys** | `backend/.env`, `voice_agent/.env`, Render |
| `CORS_ORIGINS` | Your Vercel site's address | `backend/.env`, Render |
| `VITE_API_URL` | Your Render service's address | `frontend/.env`, Vercel |
| `API_URL` | Your Render service's address | `voice_agent/.env` |

The voice worker uses LiveKit Inference model names (see `voice_agent/.env.example`), so it bills
through your LiveKit project and needs no separate speech or LLM keys.

## Deploy

- **Neon:** create a project and copy the connection string.
- **Render:** the API deploys from the `Dockerfile` at the repo root. Either use New → Blueprint (reads `render.yaml`), or New → Web Service with Language **Docker**, Root Directory blank, Dockerfile Path `./Dockerfile`, Health Check Path `/health`. Add the secret values in its Environment tab.
- To test the image locally: `docker build -t fde-learning-api . && docker run -p 8000:8000 --env-file backend/.env fde-learning-api`
- **Vercel:** import the repo with root directory `frontend` and set `VITE_API_URL`.
- **Voice-quiz worker:** it holds a live connection to LiveKit, so it needs an always-on host. Vercel
  can't run it, and Render's free web services sleep. Build the image from the repo root:
  `docker build -f voice_agent/Dockerfile -t fde-voice-quiz .` and run it on any always-on Docker
  host (for example a Render background worker) with `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`, `VOICE_WORKER_KEY` and `API_URL` set. LiveKit Cloud's own agent hosting
  (`lk agent create`) is the other option.

## Adding a new week

Add `content/week-NN.json` with the same shape as `week-01.json`, then set its `id` in `content/course.json`. The API validates every
file at startup, so a typo shows up as an error straight away.
