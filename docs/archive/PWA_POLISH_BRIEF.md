# Summer Shred — PWA Polish & Engagement Brief
# 5 focused features. Add to existing app. Do not refactor anything that works.
# Read the codebase fully before writing a single line.

---

## FEATURE 1 — Safe Area Inset (2 minutes)

iPhones since iPhone X have a home indicator bar at the bottom. The bottom nav
currently sits on top of it. This makes it look like a web page, not an app.

**Find:** The bottom nav component (likely `BottomNav.tsx` or similar).

**Change:** Add safe area padding so the nav clears the home indicator.

```css
/* In your bottom nav styles — Tailwind or CSS */
padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
```

**Also add to `<html>` or root layout viewport meta tag:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

The `viewport-fit=cover` is required for `env(safe-area-inset-bottom)` to work.

**Also check:** Any fixed bottom elements (toasts, the ShredOverlay) — make sure
they also account for the safe area so they don't sit behind the home indicator.

**Verify:** Open on an iPhone with a home bar. The bottom nav should sit above
the thin home indicator line with comfortable breathing room, exactly like
a native app.

---

## FEATURE 2 — Haptic Feedback on Habit Check (1 line)

Physical feedback makes checking off a habit feel satisfying and intentional.
This is a standard micro-interaction in every well-made fitness app.

**Find:** The habit toggle function — wherever `toggleHabit()` or equivalent lives.

**Add this line at the start of the toggle function, before any state update:**
```typescript
navigator.vibrate?.(10);
```

The `?.` makes it safe — browsers that don't support it (desktop, some older
Android) silently skip it. No error handling needed.

**Also add a slightly longer pulse on the "SHRED IT" button press:**
```typescript
navigator.vibrate?.([10, 50, 20]); // tap, pause, tap — feels like a confirmation
```

**That's it.** One line per interaction. Do not add any additional logic.

---

## FEATURE 3 — Session Expiry to 30 Days

This is a Supabase dashboard config change, not a code change.
Document it clearly so the gym owner can action it.

**Output the following instructions as a clearly formatted comment or README
addition — do not try to set this via code:**

```
MANUAL STEP — Supabase Dashboard:

1. Go to: Authentication → Configuration → Sessions
2. Set "JWT expiry" to: 2592000  (30 days in seconds)
3. Enable: "Refresh token rotation" → ON
4. Enable: "Reuse interval" → set to 10 (seconds)
   This prevents multiple rapid refreshes from invalidating sessions.
5. Save changes.

Result: Users stay logged in for 30 days of inactivity.
Supabase silently refreshes their token in the background on each visit.
They will only see the login screen if they haven't opened the app in 30 days.
```

**In code:** Verify that your Supabase client is calling `getSession()` on app
load and that the `onAuthStateChange` listener is wired up in your root layout
or auth context. If the session refresh is already handled by `@supabase/ssr`
middleware, no code change is needed — just confirm it's there.

---

## FEATURE 4 — Weekly Summary Email

Every Tuesday night at 9pm, each active member receives a personal recap email
of their week via Resend. This is the single highest-impact engagement feature
for a challenge like this.

### 4a — Supabase Edge Function (cron job)

Create `supabase/functions/weekly-summary/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const resend = new Resend(Deno.env.get('RESEND_API_KEY')!);

// Week runs Wed–Tue. PROGRAM_START is the first Wednesday.
const PROGRAM_START = new Date('2025-04-09T00:00:00Z');
const HABITS = [
  { id: 'train',    name: 'Train',          pts: 1 },
  { id: 'mobility', name: 'Mobility',       pts: 1 },
  { id: 'sleep',    name: 'Sleep',          pts: 1 },
  { id: 'fasting',  name: 'Fasting',        pts: 1 },
  { id: 'veggies',  name: 'Veggies & Fruit',pts: 1 },
  { id: 'water',    name: 'Hydration',      pts: 1 },
  { id: 'alcohol',  name: 'No Alcohol',     pts: 5 },
  { id: 'bread',    name: 'No Bread',       pts: 5 },
  { id: 'sugar',    name: 'No Added Sugar', pts: 5 },
  { id: 'extra',    name: 'Extra Credit',   pts: 1 },
];
const MAX_DAILY = 20;

function currentWeekNum(): number {
  const diff = Math.floor((Date.now() - PROGRAM_START.getTime()) / (7 * 86400000));
  return Math.max(1, Math.min(8, diff + 1));
}
function weekStartDate(wk: number): Date {
  const d = new Date(PROGRAM_START);
  d.setDate(d.getDate() + (wk - 1) * 7);
  return d;
}
function weekEndDate(wk: number): Date {
  const d = weekStartDate(wk);
  d.setDate(d.getDate() + 6);
  return d;
}
function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

Deno.serve(async () => {
  const wk = currentWeekNum();
  const weekStart = toDateString(weekStartDate(wk));
  const weekEnd   = toDateString(weekEndDate(wk));

  // Get all active users with auth email
  const { data: users } = await supabase
    .from('profiles')
    .select('id, name, is_active')
    .eq('is_active', true);

  if (!users?.length) return new Response('No users', { status: 200 });

  // Get all logs for this week across all users in one query
  const { data: allLogs } = await supabase
    .from('habit_logs')
    .select('user_id, log_date, habits, points')
    .gte('log_date', weekStart)
    .lte('log_date', weekEnd);

  // Get leaderboard for rank calculation
  const { data: leaderboard } = await supabase
    .from('leaderboard_summary')
    .select('id, name, week_pts, total_pts')
    .order('week_pts', { ascending: false });

  for (const user of users) {
    const userLogs = allLogs?.filter(l => l.user_id === user.id) ?? [];
    const weekPts  = userLogs.reduce((a, l) => a + (l.points ?? 0), 0);
    const daysLogged = userLogs.length;
    const rank     = (leaderboard?.findIndex(l => l.id === user.id) ?? 0) + 1;
    const totalUsers = leaderboard?.length ?? 1;

    // Count how many times each habit was completed this week
    const habitCounts: Record<string, number> = {};
    for (const log of userLogs) {
      for (const h of HABITS) {
        if (log.habits?.[h.id]) {
          habitCounts[h.id] = (habitCounts[h.id] ?? 0) + 1;
        }
      }
    }

    // Perfect days
    const perfectDays = userLogs.filter(l => (l.points ?? 0) >= MAX_DAILY).length;

    // Best habit (most consistent)
    const bestHabit = HABITS
      .map(h => ({ ...h, count: habitCounts[h.id] ?? 0 }))
      .sort((a, b) => b.count - a.count)[0];

    // Missed habit (least consistent, only ones they missed at least once)
    const missedHabit = HABITS
      .map(h => ({ ...h, count: habitCounts[h.id] ?? 0 }))
      .filter(h => h.count < daysLogged)
      .sort((a, b) => a.count - b.count)[0];

    // Get user email from auth
    const { data: authUser } = await supabase.auth.admin.getUserById(user.id);
    const email = authUser?.user?.email;
    if (!email) continue;

    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '💪';
    const motivationalLine = weekPts >= 100
      ? "You're crushing it. Top of the board energy."
      : weekPts >= 60
      ? "Solid week. One more push and you're podium material."
      : daysLogged === 0
      ? "You missed this week. Every week is a fresh start — Wednesday is right around the corner."
      : "Every point counts. Keep showing up.";

    const habitRows = HABITS.map(h => {
      const count = habitCounts[h.id] ?? 0;
      const pct = daysLogged > 0 ? Math.round((count / daysLogged) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      return `
        <tr>
          <td style="padding:6px 0;color:#F7F7F7;font-size:13px">${h.name}</td>
          <td style="padding:6px 0;color:#7A7A7A;font-family:monospace;font-size:12px">${bar}</td>
          <td style="padding:6px 0;color:#DE3341;font-size:13px;font-weight:700;text-align:right">${count}/${daysLogged}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <div style="background:#111111;padding:0;font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto">

        <!-- Header -->
        <div style="background:#DE3341;padding:32px;text-align:center">
          <div style="font-size:36px;margin-bottom:4px">☀️</div>
          <div style="font-size:24px;font-weight:900;color:#ffffff;letter-spacing:4px;text-transform:uppercase">
            SUMMER SHRED
          </div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:4px;text-transform:uppercase;margin-top:4px">
            Week ${wk} Recap
          </div>
        </div>

        <!-- Greeting -->
        <div style="padding:32px 32px 0">
          <p style="color:#F7F7F7;font-size:18px;font-weight:700;margin:0 0 4px">
            Hey ${user.name} ${rankEmoji}
          </p>
          <p style="color:#7A7A7A;font-size:14px;margin:0 0 24px">
            Here's how Week ${wk} went.
          </p>
        </div>

        <!-- Big stats -->
        <div style="padding:0 32px">
          <div style="display:flex;gap:12px;margin-bottom:24px">
            <div style="flex:1;background:#1A1A1A;border-radius:10px;padding:16px;text-align:center;border:1px solid #2E2E2E">
              <div style="font-size:32px;font-weight:900;color:#DE3341">${weekPts}</div>
              <div style="font-size:11px;color:#7A7A7A;text-transform:uppercase;letter-spacing:2px;margin-top:2px">Points</div>
            </div>
            <div style="flex:1;background:#1A1A1A;border-radius:10px;padding:16px;text-align:center;border:1px solid #2E2E2E">
              <div style="font-size:32px;font-weight:900;color:#DE3341">#${rank}</div>
              <div style="font-size:11px;color:#7A7A7A;text-transform:uppercase;letter-spacing:2px;margin-top:2px">of ${totalUsers}</div>
            </div>
            <div style="flex:1;background:#1A1A1A;border-radius:10px;padding:16px;text-align:center;border:1px solid #2E2E2E">
              <div style="font-size:32px;font-weight:900;color:#DE3341">${daysLogged}/7</div>
              <div style="font-size:11px;color:#7A7A7A;text-transform:uppercase;letter-spacing:2px;margin-top:2px">Days</div>
            </div>
            ${perfectDays > 0 ? `
            <div style="flex:1;background:#1A1A1A;border-radius:10px;padding:16px;text-align:center;border:1px solid #2E2E2E">
              <div style="font-size:32px;font-weight:900;color:#DE3341">${perfectDays}</div>
              <div style="font-size:11px;color:#7A7A7A;text-transform:uppercase;letter-spacing:2px;margin-top:2px">Perfect</div>
            </div>` : ''}
          </div>
        </div>

        <!-- Habit breakdown -->
        <div style="padding:0 32px 24px">
          <div style="font-size:11px;font-weight:700;color:#7A7A7A;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px">
            Habit Breakdown
          </div>
          <table style="width:100%;border-collapse:collapse">
            ${habitRows}
          </table>
        </div>

        <!-- Highlights -->
        ${bestHabit ? `
        <div style="padding:0 32px 24px">
          <div style="background:#1A1A1A;border-radius:10px;padding:16px;border-left:3px solid #3DAA6C">
            <div style="font-size:11px;font-weight:700;color:#3DAA6C;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Most Consistent</div>
            <div style="color:#F7F7F7;font-size:14px;font-weight:600">${bestHabit.name} — ${habitCounts[bestHabit.id] ?? 0} out of ${daysLogged} days</div>
          </div>
        </div>` : ''}

        ${missedHabit ? `
        <div style="padding:0 32px 24px">
          <div style="background:#1A1A1A;border-radius:10px;padding:16px;border-left:3px solid #DE3341">
            <div style="font-size:11px;font-weight:700;color:#DE3341;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Opportunity Next Week</div>
            <div style="color:#F7F7F7;font-size:14px;font-weight:600">${missedHabit.name} — only ${habitCounts[missedHabit.id] ?? 0} out of ${daysLogged} days</div>
          </div>
        </div>` : ''}

        <!-- Motivational line -->
        <div style="padding:0 32px 32px">
          <div style="background:#1A1A1A;border-radius:10px;padding:20px;border:1px solid #2E2E2E;text-align:center">
            <div style="color:#F7F7F7;font-size:15px;font-style:italic;font-weight:600">
              "${motivationalLine}"
            </div>
          </div>
        </div>

        <!-- CTA -->
        <div style="padding:0 32px 32px;text-align:center">
          <a href="${Deno.env.get('APP_URL') ?? 'https://yourapp.vercel.app'}/dashboard"
             style="display:inline-block;background:#DE3341;color:#ffffff;padding:14px 32px;border-radius:8px;font-weight:800;font-size:13px;letter-spacing:2px;text-transform:uppercase;text-decoration:none">
            OPEN SUMMER SHRED →
          </a>
          <p style="color:#3E3E3E;font-size:12px;margin-top:16px">
            Week ${wk + 1 <= 8 ? wk + 1 + ' starts Wednesday.' : 'Final week. Finish strong.'}
          </p>
        </div>

      </div>
    `;

    await resend.emails.send({
      from: 'Summer Shred <shred@yourdomain.com>',
      to: email,
      subject: `Week ${wk} recap — you scored ${weekPts} pts ${rankEmoji}`,
      html,
    });
  }

  return new Response(`Sent to ${users.length} users`, { status: 200 });
});
```

### 4b — Schedule the Cron Job

In `supabase/functions/weekly-summary/config.toml` (create if it doesn't exist):
```toml
[functions.weekly-summary]
schedule = "0 21 * * 2"
```

`0 21 * * 2` = 9pm UTC every Tuesday. Adjust UTC offset for your timezone.
If your gym is US Eastern: use `0 2 * * 3` (2am Wednesday UTC = 9pm Tuesday EST)
If your gym is US Pacific: use `0 5 * * 3` (5am Wednesday UTC = 9pm Tuesday PST)

### 4c — Environment Variables

Add to Supabase Edge Function secrets (Dashboard → Edge Functions → Secrets):
```
RESEND_API_KEY=your_resend_api_key
APP_URL=https://your-actual-vercel-url.vercel.app
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
by Supabase into all Edge Functions — do not add them manually.

### 4d — Deploy the Function

```bash
supabase functions deploy weekly-summary
```

### 4e — Test It Manually

Trigger it once to verify emails send correctly before waiting for Tuesday:
```bash
supabase functions invoke weekly-summary
```

---

## FEATURE 5 — Onboarding Flow

New users land cold on the dashboard and have no idea how points work or how
to add the app to their home screen. A 3-screen swipeable intro shown exactly
once fixes this.

### 5a — Onboarding Screens Content

**Screen 1 — Welcome**
- Large ☀️ sun animation (reuse the existing sunPulse CSS)
- "SUMMER SHRED" headline
- "8 weeks. 10 daily habits. One leaderboard."
- Subtext: "Earn up to 20 points a day. The person at the top wins."

**Screen 2 — How Points Work**
- Show all 10 habits as a visual list with their point values
- Highlight the 5-point habits (No Alcohol, No Bread, No Sugar) as "Big 3"
- "Max 20 pts/day. Max 140 pts/week. Max 1,120 over 8 weeks."

**Screen 3 — Add to Home Screen**
- Headline: "Get the full app experience"
- iPhone instruction with share icon: "Tap ↑ then 'Add to Home Screen'"
- Android instruction: "Tap ⋮ then 'Add to Home Screen'"
- Skip link at bottom: "I'll do this later"
- "Let's Go" button that dismisses onboarding

### 5b — Implementation

**Create `src/components/onboarding/OnboardingFlow.tsx`:**

- Full-screen overlay, `position: fixed`, `z-index: 9999`, background `#111111`
- Swipeable between 3 screens — use CSS `transform: translateX` with touch events,
  or install `swiper` if already in the project
- Dot indicators at bottom showing current screen
- "Next →" button advances screens, "Skip" dismisses from any screen
- On last screen: "LET'S GO 🔥" button dismisses
- Dismiss sets `localStorage.setItem('shred_onboarding_done', 'true')`
- Never show again after dismiss

**Create `src/hooks/useOnboarding.ts`:**
```typescript
export function useOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem('shred_onboarding_done');
    if (!done) setShow(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem('shred_onboarding_done', 'true');
    setShow(false);
  };

  return { show, dismiss };
}
```

**Wire into dashboard layout:**
```typescript
const { show, dismiss } = useOnboarding();
return (
  <>
    {show && <OnboardingFlow onDismiss={dismiss} />}
    {/* existing layout */}
  </>
);
```

**Detect platform for Screen 3:**
```typescript
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isAndroid = /Android/.test(navigator.userAgent);
// Show relevant instructions, or show both if neither
```

**Style:** Match existing design system exactly — `#DE3341` for CTAs,
`#1A1A1A` for cards, DM Sans 800 for headlines, dot indicators in red.
Swipe transition should be smooth: `transition: transform 0.3s ease`.

### 5c — Reset Helper (for testing)

Add a hidden reset in the admin panel or browser console:
```typescript
// In browser console to re-trigger onboarding:
localStorage.removeItem('shred_onboarding_done');
```

---

## BUILD ORDER

Execute in this exact order. Each feature is independent — complete and verify
each one before starting the next.

1. **Safe area inset** — viewport meta tag + bottom nav CSS. Test on real iPhone.
2. **Haptic feedback** — one line in habit toggle, one line on shred button.
3. **Session expiry** — output instructions for Supabase dashboard, verify
   `onAuthStateChange` is wired in existing code. No new code if SSR middleware
   handles it.
4. **Onboarding flow** — component + hook + wire into dashboard layout.
5. **Weekly summary email** — Edge Function + cron + deploy + test invoke.

---

## CRITICAL RULES

- Read the existing codebase before starting. Find where habit toggle,
  dashboard layout, and auth listener currently live.
- Do not change any existing working functionality.
- All new UI must use existing design tokens exactly.
- The weekly email Edge Function uses Deno runtime (not Node) —
  import from `https://esm.sh/` not `npm:`.
- Test the Edge Function with `supabase functions invoke weekly-summary`
  before relying on the cron schedule.
- The onboarding flow must not block the app if localStorage is unavailable
  (private browsing) — wrap in try/catch.
- Safe area CSS requires `viewport-fit=cover` in the meta tag or it has no effect.
