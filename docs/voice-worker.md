# Host the voice worker on LiveKit Cloud (free tier)

The voice worker (`voice_agent/`) runs both the voice quiz and the voice coach. It needs to stay
connected to LiveKit, so it can't run on Vercel or a sleeping free Render service. LiveKit Cloud can
host it inside the same LiveKit project the API already uses. Check your project's **Billing** page
for what the free Build plan includes today.

You do this once, from your laptop, in a terminal.

## 1. Install the LiveKit CLI and sign in

```bash
brew install livekit-cli        # macOS. Other systems: docs.livekit.io/home/cli
lk cloud auth                   # opens the browser; pick the same project as LIVEKIT_URL on Render
```

## 2. Give the worker its two secrets

LiveKit Cloud provides `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` itself. The worker
also needs to reach the API. In the repo:

```bash
cd voice_agent
cat > .env.cloud <<'END'
API_URL=https://fde-learnings.onrender.com
VOICE_WORKER_KEY=paste-the-same-value-as-on-Render
END
```

`.env.cloud` is git-ignored. Never commit it.

## 3. Create the agent

```bash
lk agent create --secrets-file .env.cloud
```

Run it inside `voice_agent/`. LiveKit builds the image from `voice_agent/Dockerfile` and starts it.
It writes a `livekit.toml` that remembers which agent this is (safe to commit; it holds no secrets).

## 4. Check it

```bash
lk agent status
lk agent logs
```

The logs should show the worker registered as `fde-voice-quiz`. Then open the site, start the voice
quiz or press the mic in **Ask the coach**, and allow the microphone.

## Later updates

After a change to `voice_agent/` is merged, run `lk agent deploy` in `voice_agent/` to ship it.
To change a secret: `lk agent update-secrets --secrets-file .env.cloud`.

## How it fits

- The worker no longer needs the `content/` folder: it reads each week from the API (`API_URL`).
- Models (speech-to-text, LLM, text-to-speech) go through LiveKit Inference and bill to the same
  LiveKit project, so no other model keys are needed.
