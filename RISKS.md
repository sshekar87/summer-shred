# Live B.I.G 365 — Known Risks & Tech Debt

A running list of things we've shipped pragmatically that have known gaps or
fragility. None are fires today; revisit when scaling members or adding new
features adjacent to them.

---

## H1 · Edge Function URLs are publicly callable (`--no-verify-jwt`)

**What:** Both `weekly-recap` and `leaderboard-digest` were deployed with
`--no-verify-jwt` because the new Supabase API key format (`sb_publishable_...`)
isn't a JWT and was rejected by the gateway. Anyone who knows the function URL
can hit it without auth.

**Blast radius:** Trigger duplicate emails to the existing member list. Cannot
be used to send mail to arbitrary recipients (function only loops over
`profiles where is_active = true`). Cannot leak data — function only returns
"Sent to N users" text.

**Real worst case:** A leak of the function URL → someone hits it on a loop →
real members get spammed with duplicate emails → Resend free tier (3,000/mo)
hits its cap → cost = annoyance + capped sends.

**Mitigation when worth doing:** Add a shared-secret header check inside each
function (5-min change). Set `CRON_SECRET=<random>` in Edge Function secrets,
require `x-cron-secret` header to match. Cron's HTTP trigger config supports
custom headers.

**When to fix:** Before opening the URL to a wider gym audience or if Resend
usage spikes unexpectedly.

---

## M1 · `SUPABASE_SERVICE_ROLE_KEY` lives in Vercel env vars

**What:** The `/api/admin-invite` endpoint (deferred — not yet built) and any
future server-side admin routes need the service role key in Vercel env. It
bypasses all RLS — full read/write access to every table.

**Blast radius:** If exposed (logged accidentally, checked into git, leaked
via misconfigured CI), any attacker can read/modify all user data, change
admin flags, etc.

**Mitigation:**
- Never log it
- Never reference it client-side (only in `api/*` serverless functions)
- Rotate periodically (Supabase dashboard → Settings → API)

**When to fix:** Already follows best practices. Just an inherent risk to
flag if anyone new touches the codebase.

---

## M2 · Slack webhook URL was previously exposed in chat

**What:** During development the webhook URL was pasted into a Claude
conversation before being moved to a Vercel env var. The original URL was
rotated. Current URL is in `SLACK_WEBHOOK_URL` env on Vercel only.

**Blast radius:** Spam to the feedback Slack channel — already rotated.

**Mitigation:** Rotate immediately if anyone ever needs to reference it.
Never paste a secret in chat or commit messages.

---

## L1 · Single-file `index.html` (~3500 lines) is hard to maintain

**What:** The whole frontend is one HTML file with inline CSS + JS. Quick to
deploy, easy to grep, but no module boundaries, no type checking, no
component isolation.

**Blast radius:** A bug anywhere can affect anywhere. Hard to onboard new
contributors. Hard to add tests.

**Mitigation:** A future refactor to a proper framework (Next.js / Vite +
React) would cost ~1-2 weeks and rewrite most of the frontend. Don't do it
unless we have a real reason (complex new features, multiple contributors,
needing tests).

**When to fix:** When the app crosses ~5000 lines or 3+ active contributors.

---

## L2 · Offline write queue cap was tuned reactively

**What:** Original write queue retried failed entries forever, which once
saturated the Supabase JS client and froze the admin Quotes tab. Fixed with
8-attempt cap + 7-day TTL (commit `4a36075`). Cap was guessed, not measured.

**Blast radius:** If a real network issue persists for >5 min and a user is
offline that long, their data still saves on next open (queue replays). If
the issue persists over 7 days, queued entries silently drop.

**Mitigation:** Add a visible toast when queue items get dropped, so users
know to re-tap. Or surface "you have N pending writes from last week"
somewhere. Not urgent.

**When to fix:** If we see complaints about lost data after extended offline
periods.

---

## L3 · Day-rollover assumes browser-local time

**What:** `todayKey()` builds the date from `getFullYear/Month/Date()`. If
the user's device clock is wrong, the `log_date` will be wrong too. Most
people have correct device clocks, so this is fine.

**Blast radius:** A user with a wrong clock logs habits on the wrong calendar
day. Their leaderboard pts are correct but their per-day audit trail is off.

**Mitigation:** Could trust the server clock by stamping `log_date` on
insert (via a trigger or default). Adds complexity. Not urgent.

**When to fix:** If anyone reports their habits showing on the wrong day.

---

## L4 · No cron-failure alerting

**What:** If a Sunday or Tuesday email fails (Edge Function errors, Resend
outage, etc.), nothing tells us. The next manual invoke would surface the
problem, but only by chance.

**Mitigation:** Add a "low-volume cron" that hits a Supabase log query daily
and pings Slack if either function had no successful runs in the last 24h.
Or use Resend's webhook to flag delivery failures.

**When to fix:** First time we miss a Sunday email. Maybe never if delivery
stays clean for the 8-week run.

---

## How to use this file

When fixing one: delete the section (it lives in git history) and reference
the commit that closed it. When adding one: short, structured, link to the
relevant commit or function.
