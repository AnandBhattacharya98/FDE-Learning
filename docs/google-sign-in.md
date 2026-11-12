# Sign in with Google

People can sign in with their Google (Gmail or Workspace) account as well as with an email and
password. It uses the same server-side OAuth flow as sunny-side: the API talks to Google, so the
client secret never reaches the browser. Someone who already has a password account and then uses
Google with the same address lands in the same account.

The button only appears once both Google keys are set on the API.

## One-time setup in Google Cloud

1. Open https://console.cloud.google.com/ and pick (or create) a project, e.g. "FDE Learning".
2. **APIs & Services → OAuth consent screen** (called "Google Auth Platform → Branding" in newer consoles):
   - User type: **External**.
   - App name "FDE Learning", your support email, developer contact email. Save.
   - Scopes: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (all non-sensitive, so no review is needed).
   - **Audience / Publishing status**: press **Publish app** so anyone can sign in. While it stays
     in "Testing", only the test users you list can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name "FDE Learning API".
   - Authorised JavaScript origins: `https://fde-learning-rho.vercel.app`
   - Authorised redirect URIs (exact, no trailing slash):
     - `https://fde-learnings.onrender.com/api/fde/auth/google/callback`
     - `http://localhost:8000/api/fde/auth/google/callback` (for local testing)
   - Create, then copy the **Client ID** and **Client secret**. Don't paste them in chat.

## Env vars (Render → service → Environment)

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the Client ID from step 3 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from step 3 |
| `FRONTEND_URL` | `https://fde-learning-rho.vercel.app` (optional, defaults to the first `CORS_ORIGINS` entry) |

Save; Render redeploys. Nothing changes on Vercel. For local work put the same names in `backend/.env`.

## How it works

1. The Login page asks `GET /api/fde/auth/providers` whether Google is on.
2. "Continue with Google" goes to `GET /api/fde/auth/google/start`, which redirects to Google with a
   signed `state` and sets a 10-minute cookie holding its nonce.
3. Google returns to `GET /api/fde/auth/google/callback`. The API checks the state and cookie, swaps
   the code for the verified email and name, finds or creates the user, and redirects to
   `<site>/auth/callback#token=...`. The token is in the URL fragment so it never hits server logs.
4. The site stores the token exactly as an email/password login would.

Errors (cancelled, expired link, unverified email) come back as `/login#error=...` and show on the form.

## Troubleshooting

- **"redirect_uri_mismatch"**: the redirect URI in Google Cloud must match the callback above exactly (https, no trailing slash).
- **"Access blocked: app not verified / not a test user"**: publish the consent screen (step 2).
- **No Google button**: one of the two keys is missing on Render, or the API hasn't redeployed yet.
