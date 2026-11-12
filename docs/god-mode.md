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
