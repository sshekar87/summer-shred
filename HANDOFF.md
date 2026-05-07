# Summer Shred Dashboard — Claude Code Handoff

## What You're Getting

A complete single-file HTML dashboard (`index.html`) for an 8-week gym habit challenge.
This is a production-ready frontend prototype that needs a real backend, auth, and database.

---

## Current State (What's Built)

- **Auth screen** with magic link flow (email input → send link) — currently simulates login with demo pills
- **Today View** — daily habit log with tap-to-check habits, points counter, "SHRED IT" button with shred animation + confetti
- **Weekly View** — expand any week, log any past day with collapsible day rows and inline habit toggles
- **Leaderboard** — this week / all-time tabs, podium for top 3, ranked table
- **Benchmarks** — per-user start/end numbers for 7 lifts/tests, auto-calculates improvements
- **Badges** — 10 unlockable achievements based on computed stats
- **Summer countdown** — live ticking timer to June 21
- **Daily quote** — admin-editable quote of the day
- **Program info bar** — shows start/end dates, current week, week dates, weeks left
- All data stored in `localStorage` (needs real backend — see below)

---

## Design Tokens

```css
--red:       #DE3341
--black:     #111111
--off-white: #F7F7F7
--white:     #FFFFFF
--bg2:       #1A1A1A   (card backgrounds)
--bg3:       #222222   (input backgrounds)
--border:    #2E2E2E
--sun:       #FF8C42   (countdown accent)
--sun-warm:  #FFBE0B   (countdown numbers)
--green:     #3DAA6C   (success states)
```

**Font:** `DM Sans` (Google Fonts) — weights 400/500/600/700/800/900

**Type Scale:**
- Display (stats, scores): `clamp(2rem, 5vw, 3rem)` / weight 900
- H1 (page titles): `clamp(1.5rem, 3vw, 1.75rem)` / weight 800
- H2 (section headers): `clamp(1.25rem, 2.5vw, 1.375rem)` / weight 700
- Body: `1rem` / weight 400–500
- Labels/captions: `0.8125rem` / weight 600–700, often ALL CAPS + letter-spacing

---

## Program Configuration

**IMPORTANT — update these in `index.html` before deploying:**

```javascript
// Line ~344 in the script block
const PROGRAM_START = new Date('2025-04-09T00:00:00'); // First WEDNESDAY of the program
const PROGRAM_WEEKS = 8;
const SUMMER_START  = new Date('2025-06-21T00:00:00'); // First day of summer
```

**Week structure:** Wednesday → Tuesday (7 days). Week 1 starts on `PROGRAM_START`.
The `weekStartDate(wk)` and `weekEndDate(wk)` functions derive all dates from this.

**To set Week 3 as "current":** The week number is auto-calculated from `PROGRAM_START` and today's date.
If you want to force a specific week for testing, temporarily change `currentWeekNum()` to return a fixed number.

---

## Next Steps for Claude Code

### 1. Project Setup

```bash
# Recommended stack
npm create vite@latest summer-shred -- --template react-ts
cd summer-shred
npm install

# Or Next.js for full-stack
npx create-next-app@latest summer-shred --typescript --tailwind --app
```

### 2. Break Into Components

Convert `index.html` into these React components:

```
src/
  components/
    Auth/
      AuthScreen.tsx
      MagicLinkForm.tsx
    Layout/
      Header.tsx
      BottomNav.tsx
    Dashboard/
      ProgramInfoBar.tsx
      SummerCountdown.tsx
      DailyQuote.tsx
      HeroBanner.tsx
      WeekTrack.tsx
    Log/
      DailyLog.tsx
      HabitCard.tsx
      DailyTotal.tsx
      ShredButton.tsx        ← shred animation lives here
    Weekly/
      WeeklyView.tsx
      DayRow.tsx
      MiniHabitPill.tsx
    Leaderboard/
      LeaderboardView.tsx
      Podium.tsx
      LeaderboardTable.tsx
    Benchmarks/
      BenchmarkCard.tsx
    Badges/
      BadgesGrid.tsx
  hooks/
    useUserData.ts
    useCountdown.ts
  lib/
    constants.ts            ← HABITS, BENCHMARKS_DEF, BADGE_DEFS
    dateHelpers.ts          ← weekStartDate, weekEndDate, etc.
    scoring.ts              ← userPtsForDay, computeUserStats
```

### 3. Real Auth — Magic Links

Use **Stytch** (already connected in your Claude project):

```typescript
// Install
npm install @stytch/vanilla-js

// In your MCP server / API route:
import { Client } from 'stytch';
const client = new Client({ project_id: '...', secret: '...' });

// Send magic link
await client.magicLinks.email.send({
  email: userEmail,
  login_magic_link_url: 'https://yourapp.com/auth/callback',
  signup_magic_link_url: 'https://yourapp.com/auth/callback',
});

// Verify token from URL param
await client.magicLinks.authenticate({ token });
```

**Claude Code prompt:**
> "Set up Stytch magic link authentication. When a user submits their email on the auth screen, call the Stytch API to send a magic link. Create an `/auth/callback` route that verifies the token and creates a session. Store the session in a cookie."

### 4. Database — Replace localStorage

**Recommended: PlanetScale (MySQL) or Supabase (Postgres)**

Schema you need:

```sql
-- Users (created on first magic link login)
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Daily habit logs
CREATE TABLE habit_logs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id),
  log_date  DATE NOT NULL,
  habits    JSONB NOT NULL DEFAULT '{}',  -- { train: true, alcohol: false, ... }
  UNIQUE(user_id, log_date)
);

-- Benchmarks
CREATE TABLE benchmarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  metric_key  TEXT NOT NULL,     -- e.g. 'start_bench', 'end_bench'
  value       TEXT,
  UNIQUE(user_id, metric_key)
);

-- Daily quotes (admin only)
CREATE TABLE quotes (
  quote_date  DATE PRIMARY KEY,
  quote_text  TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'Coach'
);
```

**Claude Code prompt:**
> "Create API routes for the Summer Shred app:
> - `GET /api/logs?userId=&week=` — fetch all logs for a user in a given week
> - `POST /api/logs` — upsert a day's habit log (body: { userId, date, habits })
> - `GET /api/leaderboard?week=` — return all users sorted by points for that week
> - `GET /api/benchmarks?userId=` — fetch benchmarks for a user
> - `POST /api/benchmarks` — save a benchmark value
> - `GET /api/quotes?date=` — get quote for a date
> - `POST /api/quotes` — admin: save a quote for a date"

### 5. Deploy to Railway

**Claude Code prompt:**
> "Deploy this app to Railway. Set up environment variables for DATABASE_URL and STYTCH_PROJECT_ID and STYTCH_SECRET. Create a Procfile or railway.toml. The app should use the Railway PostgreSQL plugin for the database."

**Or Vercel (already connected):**
> "Deploy to Vercel with the Vercel MCP. Create a vercel.json, set up environment variables, and connect the GitHub repo."

### 6. Admin Role for Quotes

The current code has `state.isAdmin` — wire this to a real role:

```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT false;
```

Then in your auth callback, check `user.is_admin` and set it in the session.
The quote edit button (`#quote-edit-btn`) already checks `state.isAdmin` — just replace with the real session flag.

---

## Key Business Logic to Preserve

### Week Calculation (Wed–Tue)

```javascript
// Week 1 = PROGRAM_START (Wednesday) through PROGRAM_START + 6 days (Tuesday)
function weekStartDate(wk) {
  const d = new Date(PROGRAM_START);
  d.setDate(d.getDate() + (wk - 1) * 7);
  return d; // Always a Wednesday
}
function weekEndDate(wk) {
  return dayOffset(weekStartDate(wk), 6); // Always a Tuesday
}
```

### Max Points
- 6 habits × 1 pt = 6 pts
- 3 abstinence habits × 5 pts = 15 pts  
- Extra credit = 1 pt
- **Max daily: 20 pts | Max weekly: 140 pts | Max 8-week: 1,120 pts**

### Leaderboard Sorting
Weekly leaderboard = sum of all `habit_logs` for `log_date` between `weekStartDate(cw)` and `weekEndDate(cw)` for each user.

---

## Claude Code Prompts to Use

### To start the conversation:
```
I have a single-file HTML dashboard for a gym challenge app called Summer Shred. 
I need to convert it into a deployable React/Next.js app with:
1. Stytch magic link auth
2. PostgreSQL database (Railway)
3. REST API routes

Here is the full HTML file: [paste index.html]

Start by setting up the Next.js project structure and breaking the HTML into components.
Keep the exact same design tokens, colors (#DE3341, #111111, #F7F7F7), and DM Sans font.
```

### For the weekly view specifically:
```
The weekly view shows all 7 days (Wed–Tue) for a selected week. 
Each day row expands to show mini habit toggles. 
Users can backfill any past day — this is important for people who forgot to log.
The API endpoint should be POST /api/logs with { userId, date, habits } and upsert on (userId, date).
```

### For the shred animation:
```
The "SHRED IT" button triggers an animation: 
- Canvas-based vertical strips that fall apart like shredded paper
- Large "SHREDDED! ✂️" text fades in at center
- Confetti in brand colors: #DE3341, #FF8C42, #FFBE0B
- Duration: ~2 seconds then auto-dismiss
See the launchShred() and animateShredCanvas() functions in the HTML for the current implementation.
```

---

## Files in This Handoff

- `index.html` — the complete working frontend prototype
- `HANDOFF.md` — this document

---

## Quick Reference: What to Tell Claude Code First

> "I'm handing off a single-file HTML prototype. The file is `index.html`. 
> Read it fully before starting. Key things to know:
> - Brand colors: Red #DE3341, Black #111111, Off-white #F7F7F7, White #FFFFFF
> - Font: DM Sans (Google Fonts), weights 400–900
> - Week structure: Wednesday to Tuesday, 8 weeks total
> - Program start date: April 9, 2025 (first Wednesday) — this drives ALL date logic
> - Max 20 points per day across 10 habits
> - The localStorage data model is the source of truth for the schema
> - Auth: Stytch magic links (already connected as MCP)
> - Deploy target: Railway or Vercel (both connected as MCPs)
> - Do NOT change the visual design — only migrate it to React components"

---

## 30-Day Sessions (manual one-time Supabase config)

By default Supabase JWTs expire after 1 hour, which kicks gym members back to the login screen often. Keep them signed in for 30 days of inactivity:

**Supabase Dashboard → Authentication → Configuration → Sessions:**

1. **JWT expiry:** `2592000` (30 days, in seconds)
2. **Refresh token rotation:** ON
3. **Reuse interval:** `10` (seconds) — prevents rapid double-refreshes from invalidating sessions
4. Click **Save**

**Already wired in code:** the inline script in `index.html` calls `sb.auth.onAuthStateChange(...)` in `init()`, which auto-refreshes the access token on every page load. No code change needed — just the dashboard config above.

**Result:** members only see the login screen if they haven't opened the app in 30 days. Token rotates silently in the background on every visit.

---

## Branded Sign-In Email (one-time)

The auth flow uses **email OTP** — members get a 6-digit code in the inbox and type it into the PWA. The same email also includes a clickable magic link as a desktop fallback. This avoids the iOS PWA storage isolation problem (where tapping a magic link always opens Safari, never the home-screen PWA).

To install the branded template:

1. Open `supabase/email_templates/magic_link.html` in this repo — copy the entire file body.
2. **Supabase Dashboard → Authentication → Email Templates → Magic Link.**
3. Subject line: `Your Live B.I.G 365 sign-in code`
4. Paste the HTML into the message body. Save.
5. Test: sign out, request a code, confirm the inbox version shows the 6-digit code in a monospace box and a "Sign in →" button below.

The template uses both `{{ .Token }}` (the code) and `{{ .ConfirmationURL }}` (the link). Edit the file in the repo if you tweak it later — keep dashboard + repo in sync.

**Allowlist:** Auth → URL Configuration → Redirect URLs needs both `https://livebig365.fit/**` and `https://summer-shred-*-sukesh-shekars-projects.vercel.app/**` so the magic-link fallback path lands on the right host on production AND branch previews.

**Email confirmations must be OFF.** Supabase Dashboard → Authentication → Sign In / Providers → Email → toggle **"Confirm email" OFF** (or whatever the current dashboard label is — sometimes "Email confirmations"). With it ON, new members get a "confirm your email" email FIRST and have to click it before the OTP code is sent — two emails for what should be one step. The OTP code is itself proof the user owns the inbox; the confirm step is redundant and confusing.

**OTP length must be 6.** Same Auth section, look for **"OTP length"** — set to **6**. The client expects exactly 6 digits. If this is set to 7 or 8, members will get longer codes and the sign-in form will reject them.

---

## Weekly Email Cron Jobs — Setup (one-time, on `feature/pwa-polish` branch)

The branch ships two Supabase Edge Functions that send branded emails via Resend:

- **`weekly-recap`** — Sunday 8 PM EDT per-user personal recap of the prior Sun-Sat week
- **`leaderboard-digest`** — Tuesday 9 PM EDT group leaderboard digest, last call before Tina's Wednesday lock-in
- **`inactivity-reminder`** — Thursday 7 PM EDT nudge for members who haven't logged in 3+ days (skipped during pre-program / post-program windows)

Both read from `program_config`, `profiles`, `habit_logs`, and `week_overrides`. Auth emails are resolved via `auth.admin.listUsers()`. Sender: `noreply@livebig365.fit` (already verified in Resend).

### 1. Install Supabase CLI

```bash
brew install supabase/tap/supabase
supabase --version    # confirm install
```

### 2. Login + link to the project

```bash
supabase login
cd /Users/sukeshshekar/Documents/CodingJourney/summer-shred
supabase link --project-ref nstgevgekqtmeixdukvi
```

### 3. Set Edge Function secrets

In **Supabase Dashboard → Project Settings → Edge Functions → Secrets**, add:

```
RESEND_API_KEY=<your re_xxx key from resend.com → API Keys>
APP_URL=https://livebig365.fit
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — **do not add them manually**.

### 4. Deploy both functions

```bash
supabase functions deploy weekly-recap --no-verify-jwt
supabase functions deploy leaderboard-digest --no-verify-jwt
supabase functions deploy inactivity-reminder --no-verify-jwt
```

`--no-verify-jwt` is required so pg_cron's HTTP calls (which carry no Authorization header) reach the function instead of getting 401s at the gateway.

### 5. Schedule the cron jobs in the database

**Important:** the `schedule = "..."` line in each function's `config.toml` only matters for `supabase serve` local dev. **Production scheduling lives in the database**, via the `pg_cron` extension calling the function via `pg_net`.

One-time setup, run in **Supabase Dashboard → SQL Editor**:

```sql
-- Enable extensions (idempotent; safe to re-run)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Weekly recap — Sunday 8 PM EDT = Monday 00:00 UTC
select cron.schedule(
  'weekly-recap-sunday-evening',
  '0 0 * * 1',
  $$
    select net.http_post(
      url := 'https://nstgevgekqtmeixdukvi.supabase.co/functions/v1/weekly-recap',
      headers := jsonb_build_object('Content-Type', 'application/json')
    ) as request_id;
  $$
);

-- Inactivity reminder — Thursday 7 PM EDT = Thursday 23:00 UTC
select cron.schedule(
  'inactivity-reminder-thursday-evening',
  '0 23 * * 4',
  $$
    select net.http_post(
      url := 'https://nstgevgekqtmeixdukvi.supabase.co/functions/v1/inactivity-reminder',
      headers := jsonb_build_object('Content-Type', 'application/json')
    ) as request_id;
  $$
);

-- Leaderboard digest — Tuesday 9 PM EDT = Wednesday 01:00 UTC
select cron.schedule(
  'leaderboard-digest-tuesday-evening',
  '0 1 * * 3',
  $$
    select net.http_post(
      url := 'https://nstgevgekqtmeixdukvi.supabase.co/functions/v1/leaderboard-digest',
      headers := jsonb_build_object('Content-Type', 'application/json')
    ) as request_id;
  $$
);
```

Verify after running:

```sql
select jobid, schedule, command, jobname from cron.job;
```

Should show both rows. To see whether a scheduled run actually executed:

```sql
select * from cron.job_run_details
order by start_time desc limit 10;
```

To **change a schedule later**, the easiest path is unschedule + reschedule:

```sql
select cron.unschedule('weekly-recap-sunday-evening');
-- then re-run the cron.schedule(...) above with the new expression
```

> **Daylight saving:** the cron expressions above are EDT (Mar–Nov). For EST (Nov–Mar), shift by one hour:
> - `weekly-recap`: `0 1 * * 1` (instead of `0 0 * * 1`)
> - `leaderboard-digest`: `0 2 * * 3` (instead of `0 1 * * 3`)

### 6. Test before waiting for the cron

```bash
supabase functions invoke weekly-recap
supabase functions invoke leaderboard-digest
```

Each should return `Sent to N users (skipped 0)` and you should receive the corresponding email at your account's address. **Run from `feature/pwa-polish` branch — these functions only exist there until merged.**

---

## Testing Checklist (phone first, before merging `feature/pwa-polish` → `main`)

### F1 — Safe area
- [ ] Open https://livebig365.fit on iPhone Safari
- [ ] Bottom nav (Today / Weekly / Coach / Board / Track) sits **above** the home indicator with breathing room — not flush
- [ ] Trigger a toast (toggle a habit, then send a quote suggestion) → toast pill renders above the home indicator
- [ ] Add to Home Screen → open the PWA → bottom nav still clears the home bar

### F2 — Haptics
- [ ] iPhone: toggle a habit → no haptic (iOS Safari does not support Vibration API; expected)
- [ ] Android Chrome: toggle a habit → feel a 10ms tap
- [ ] Android: hit Shred It → feel tap-pause-tap rhythm
- [ ] Desktop: toggling habits still works without errors

### F3 — Sessions
- [ ] Run the manual Supabase steps in this file (JWT 30d + refresh rotation + reuse interval)
- [ ] Sign in, hard refresh, still signed in
- [ ] Close the PWA, wait 1 hour, reopen — still signed in

### F5 — Onboarding
- [ ] DevTools console (or Safari Web Inspector on iPhone): `localStorage.removeItem('shred_onboarding_done'); location.reload();`
- [ ] After login, the 3-screen overlay appears
- [ ] Swipe left → screen 2 (10 habits, Big 3 highlighted), dot indicator updates
- [ ] Swipe left → screen 3 (Add to Home Screen instructions for your platform)
- [ ] Button text changes to **LET'S GO 🔥** on screen 3
- [ ] Tap LET'S GO → overlay dismisses, dashboard visible
- [ ] Reload → onboarding does **not** reappear (flag persisted)
- [ ] Skip button on any screen also dismisses
- [ ] Private browsing: onboarding skipped silently if localStorage unavailable, no crash

### F4 — Emails (after Edge Function deploy + secrets set)
- [ ] `supabase functions invoke weekly-recap` returns `Sent to N users` and an email arrives at your inbox from `noreply@livebig365.fit`
- [ ] Email renders correctly on iPhone Mail (no broken HTML, big-stat tiles aligned, habit-bar table readable)
- [ ] Recap shows correct week pts (matches what you see on the Weekly tab including any `week_overrides`)
- [ ] `supabase functions invoke leaderboard-digest` returns success and group leaderboard email arrives
- [ ] Your row in the leaderboard table is highlighted with red tint + `(you)` tag
- [ ] Highlights section only contains positive callouts (no "X did not log" wording anywhere)
- [ ] Schedules in dashboard show next run at: Sunday 12:00 UTC + Wednesday 01:00 UTC
- [ ] Wait for actual Sunday morning → real recap arrives at 8 AM EDT

### Cross-cutting
- [ ] Browser console on the deployed branch URL — no red errors anywhere
- [ ] All existing flows (log a habit, weekly view, admin panel, feedback widget, suggest a quote) still work — no regressions from F1/F2/F5
- [ ] Onboarding overlay swipes smoothly, no janky animation
- [ ] Sign out + sign back in fresh email → onboarding shows for that email's first session, then never again
- [ ] No JavaScript errors in DevTools when the onboarding is dismissed via Skip vs LET'S GO vs swipe

When everything above passes:
```bash
git checkout main
git merge --no-ff feature/pwa-polish
git push origin main
# Vercel auto-deploys main. Monitor the next Sunday + Tuesday emails to confirm cron fires correctly in production.
```
