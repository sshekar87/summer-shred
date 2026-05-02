# Summer Shred — Feature Addition Brief
# The app is already built and deployed. Add these specific features only.
# Do NOT refactor existing code unless directly required by a feature below.

---

## CONTEXT

The app is a Next.js Summer Shred gym challenge app already deployed on Vercel.
Backend: Supabase (auth + DB). Email: Resend. Stack is already wired up.

Read the existing codebase before touching anything.
Identify where auth, DB calls, and habit log writes currently live.
All new features bolt onto what exists.

---

## FEATURE 1 — Weekly Backfill View

Users need to log habits for days they missed. Right now they can only log today.

**What to build:**
A "Weekly" tab/page that shows all 7 days of the current week (Wed–Tue) and lets the user tap into any past day and log habits for it.

**Behaviour:**
- Show all 7 days of the selected week as expandable rows
- Each row shows: day name, date, points logged (or "—" if empty), expand chevron
- Tapping a row expands it to show all 10 habit toggles inline as pill buttons
- Future days are visible but greyed out and non-interactive
- Today's row is expanded by default
- A week selector at the top lets the user switch between weeks 1–8
- Clicking a week pill in the existing WeekTrack component navigates here with that week pre-selected
- Saving a past day uses the same upsert logic as today's log — same DB call, different date

**DB:** No schema changes needed. `habit_logs` already has `(user_id, log_date)` unique constraint — upsert handles backfill writes the same as today.

**Key constraint:** Only allow writes to dates within the program window (Apr 9 – end of Week 8). Reject writes to future dates silently.

---

## FEATURE 2 — Offline Write Queue

Users are in a gym on spotty WiFi. A failed save should never lose their data.

**What to build:**
A `writeQueue` utility that sits between the habit toggle and the Supabase write.

**Behaviour:**
- On every habit toggle: write the full updated habits object to a `localStorage` queue entry immediately, then fire the Supabase upsert
- If the upsert succeeds: remove the entry from the queue
- If the upsert fails: leave it in the queue silently — do NOT roll back the UI
- On app load: call `flushQueue()` which retries all pending queue entries in order
- Show a small "Syncing..." or offline indicator in the header if queue has pending items — disappear once flushed
- Queue entries: `{ id, type: 'habit_log', payload: { user_id, log_date, habits }, queuedAt, attempts }`

**File to create:** `src/lib/writeQueue.ts` (or wherever your lib utilities live)

**Wire into:** The existing habit toggle function — wrap the current Supabase upsert call, don't replace it.

---

## FEATURE 3 — Admin Panel

A protected `/admin` route for the gym owner. Accessible only to users where `profiles.is_admin = true`. The existing middleware already protects routes — extend it for `/admin`.

Build as a single page with three tabs: Users, Dashboard, Quotes.

### Tab 1: Users

**What to build:**
- Table of all members: name | email | days logged | total points | last logged | admin toggle | deactivate button
- "Invite Member" button → modal with email input field → calls `supabase.auth.admin.inviteUserByEmail(email)` via a server action or API route using the service role key
- Admin toggle: flips `profiles.is_admin` boolean — requires confirmation dialog
- Deactivate: sets `profiles.is_active = false` — soft delete, data preserved, user can no longer log in

**API route needed:** `POST /api/admin/invite` — takes `{ email, name }`, calls Supabase admin invite, returns success/error. Must use `SUPABASE_SERVICE_ROLE_KEY`. Never expose service role to browser.

### Tab 2: Challenge Dashboard

**What to build:**
- Participation today: "X / Y members logged today" as a large stat with progress bar
- This week's leaderboard with full detail visible (admin sees everyone's individual habit breakdowns, not just totals)
- User log viewer: clicking any user's name opens a modal/drawer showing their full log history — a calendar grid with points per day, and individual habit checkboxes for any selected date
- Manual log correction: in the user log viewer, admin can check/uncheck any habit for any date and save — this overwrites that user's entry. Use the service role client so RLS doesn't block cross-user writes.

**API routes needed:**
- `GET /api/admin/users` — all profiles with aggregated stats
- `GET /api/admin/logs?userId=&date=` — single user's log for a date
- `PATCH /api/admin/logs` — body: `{ userId, date, habits }` — admin override of any user's log

### Tab 3: Quotes

**What to build:**
- 7-slot week view (Wed–Tue) showing current week's quotes — filled slots show preview text, empty slots show "No quote set"
- Click any slot → inline form to type quote text and author name → save
- Date navigation to go back/forward weeks and fill past or future quotes
- Save calls the existing `POST /api/quotes` endpoint (already built) or creates it if not there yet

---

## FEATURE 4 — Supabase Schema Additions

Run this SQL in Supabase SQL editor. These are the only schema changes needed:

```sql
-- Add is_active to profiles if it doesn't exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Add updated_at to habit_logs for last-write-wins conflict resolution
ALTER TABLE habit_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Trigger to auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS habit_logs_updated_at ON habit_logs;
CREATE TRIGGER habit_logs_updated_at
  BEFORE UPDATE ON habit_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Admin RLS policy for habit_logs — allows service role to write any user's log
-- (service role already bypasses RLS, this is just documentation)
-- No policy change needed — service role key bypasses RLS automatically.

-- Leaderboard view — if it doesn't exist yet
CREATE OR REPLACE VIEW leaderboard_summary AS
  SELECT
    p.id,
    p.name,
    COUNT(DISTINCT h.log_date)                             AS days_logged,
    COALESCE(SUM(h.points), 0)                             AS total_pts,
    COALESCE(SUM(h.points) FILTER (
      WHERE h.log_date >= CURRENT_DATE - 6
    ), 0)                                                   AS week_pts,
    MAX(h.updated_at)                                      AS last_logged_at
  FROM profiles p
  LEFT JOIN habit_logs h ON h.user_id = p.id
  WHERE p.is_active = true
  GROUP BY p.id, p.name;
```

---

## FEATURE 5 — Admin Invite Email (Resend)

When the gym owner invites a member, send a branded welcome email via Resend in addition to the Supabase magic link.

**In `POST /api/admin/invite`**, after the Supabase invite call succeeds, send:

```typescript
await resend.emails.send({
  from: 'Summer Shred <shred@yourdomain.com>',
  to: email,
  subject: "You're in — Summer Shred 2025 🔥",
  html: `
    <div style="background:#111111;padding:40px;font-family:sans-serif;max-width:480px;margin:0 auto;border-radius:12px">
      <div style="text-align:center;margin-bottom:32px">
        <div style="font-size:48px;margin-bottom:8px">☀️</div>
        <div style="font-size:28px;font-weight:900;color:#F7F7F7;letter-spacing:4px;text-transform:uppercase">
          SUMMER <span style="color:#DE3341">SHRED</span>
        </div>
      </div>
      <p style="color:#F7F7F7;font-size:16px;line-height:1.6;margin-bottom:8px">
        Hey ${name || 'there'} 👋
      </p>
      <p style="color:#F7F7F7;font-size:16px;line-height:1.6;margin-bottom:24px">
        You've been added to the Summer Shred 8-week challenge.
        Check your next email for your login link — it comes from Supabase and gets you straight in.
      </p>
      <p style="color:#7A7A7A;font-size:13px;margin-top:24px;text-align:center">
        Max 20 points a day. 8 weeks. Let's go.
      </p>
    </div>
  `,
});
```

---

## BUILD ORDER

Do these in order. Each one is independent — complete and test each before moving on.

1. **Schema additions** — output the SQL for manual run in Supabase, don't skip this
2. **Write queue** — `writeQueue.ts` utility + wire into existing habit toggle
3. **Weekly backfill view** — new page/tab, week selector, day rows, inline habit pills
4. **Admin middleware guard** — extend existing middleware to block `/admin` for non-admins
5. **Admin: Quotes tab** — simplest admin feature, good first test of admin auth
6. **Admin: Users tab** — user table + invite modal + deactivate
7. **Admin invite API route** — server-side Supabase admin invite + Resend welcome email
8. **Admin: Challenge Dashboard tab** — participation stats + leaderboard + log viewer + manual correction

---

## CRITICAL RULES

- Read the existing codebase first. Find where habit toggles, Supabase calls, and auth currently live before writing a single line.
- Do not change existing working features. Add alongside, don't replace.
- Admin API routes (`/api/admin/*`) must use the service role key server-side. Never in browser code.
- The write queue wraps the existing upsert — it does not replace it.
- Weekly backfill uses the exact same DB upsert as today's log. No new table, no new endpoint needed.
- All new UI must match existing design tokens: `#DE3341` red, `#111111` black, `#F7F7F7` off-white, DM Sans font.
