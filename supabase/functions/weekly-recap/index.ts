// Sunday morning per-user weekly recap email.
// Runs Sunday 8 AM EDT (12:00 UTC). Recaps the Sun-Sat week that just ended (yesterday).
// Cron: 0 12 * * 0  (note: subtract 1 hour during EST winter — see config.toml)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  HABITS, MAX_DAILY,
  loadProgramConfig, priorWeekNum, weekStartDate, weekEndDate, dayOffset,
  computeWeekStats, resolveEmails, sendEmail, brandHtmlWrap, rankEmoji,
} from '../_shared/helpers.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  const cfg = await loadProgramConfig(supabase);
  const wk = priorWeekNum(cfg.programStart, cfg.programWeeks);
  if (wk < 1) return new Response('Pre-program — nothing to recap yet', { status: 200 });
  const weekStart = weekStartDate(wk, cfg.programStart);
  const weekEnd = weekEndDate(wk, cfg.programStart);
  const focus = cfg.weeklyFocus[String(wk)] || '';

  // Active members
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('is_active', true);

  if (!profiles?.length) return new Response('No active users', { status: 200 });

  const userIds = profiles.map(p => p.id);
  const stats = await computeWeekStats(supabase, userIds, weekStart, weekEnd, wk);
  const emails = await resolveEmails(supabase, userIds);

  // Pull per-day logs once so we can render which specific days each habit was hit.
  // Map keyed by user_id + log_date for O(1) lookup in the email loop.
  const { data: weekLogs } = await supabase
    .from('habit_logs')
    .select('user_id, log_date, habits')
    .gte('log_date', weekStart)
    .lte('log_date', weekEnd);
  const dayLogIdx: Record<string, Record<string, Record<string, boolean>>> = {};
  for (const l of (weekLogs as any[]) || []) {
    if (!dayLogIdx[l.user_id]) dayLogIdx[l.user_id] = {};
    dayLogIdx[l.user_id][l.log_date] = l.habits || {};
  }

  // Pre-compute the 7 day-keys of the week, in order Sun...Sat with single-letter labels
  const dayKeys: string[] = [];
  for (let d = 0; d < 7; d++) dayKeys.push(dayOffset(weekStart, d));
  const dayLabels = ['S','M','T','W','T','F','S'];

  // Compute leaderboard for ranks (sort by week pts desc)
  const ranked = profiles
    .map(p => ({ ...p, weekPts: stats[p.id]?.weekPts ?? 0 }))
    .sort((a, b) => b.weekPts - a.weekPts);

  // Test-mode: when TEST_EMAIL is set, only send to that one address (skip everyone else).
  // Set + unset via Supabase dashboard → Edge Functions → Secrets.
  const testEmail = Deno.env.get('TEST_EMAIL')?.trim().toLowerCase() || null;
  if (testEmail) console.log('TEST_EMAIL active — restricting send to', testEmail);

  let sent = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const email = emails[profile.id];
    if (!email) { skipped++; continue; }
    if (testEmail && email.toLowerCase() !== testEmail) { skipped++; continue; }

    const s = stats[profile.id];
    const rank = ranked.findIndex(r => r.id === profile.id) + 1;
    const emoji = rankEmoji(rank);
    const firstName = (profile.name || email.split('@')[0]).split(' ')[0];

    // Habit breakdown rows: each habit gets 7 cells, one per day Sun-Sat. Green when
    // that specific day's habit was logged, gray when missed. Counts column on the right.
    const userDayLogs = dayLogIdx[profile.id] || {};
    const habitRows = HABITS.map(h => {
      const cellsHtml = dayKeys.map((dk, i) => {
        const hit = !!userDayLogs[dk]?.[h.id];
        const bg = hit ? '#2E9C5C' : '#E5E5E5';
        const fg = hit ? '#FFFFFF' : '#B0B0B0';
        return `<td style="background:${bg};color:${fg};font-size:9px;font-weight:800;text-align:center;padding:5px 0;border-radius:3px;width:14%;letter-spacing:0.5px;">${dayLabels[i]}</td>`;
      }).join('<td style="width:3px;"></td>');
      const count = s.habitCounts[h.id] ?? 0;
      return `
        <tr>
          <td style="padding:6px 10px 6px 0;color:#111111;font-size:13px;font-weight:600;width:42%;white-space:nowrap;">${h.emoji} ${h.name}</td>
          <td style="padding:6px 0;width:46%;">
            <table style="width:100%;border-collapse:separate;border-spacing:0;"><tr>${cellsHtml}</tr></table>
          </td>
          <td style="padding:6px 0 6px 10px;color:#DE3341;font-size:13px;font-weight:800;text-align:right;white-space:nowrap;width:12%;">${count}/7</td>
        </tr>`;
    }).join('');

    // Most consistent + opportunity habits (only when there's data)
    const sortedHabits = HABITS
      .map(h => ({ ...h, count: s.habitCounts[h.id] ?? 0 }))
      .sort((a, b) => b.count - a.count);
    const bestHabit = s.daysLogged > 0 ? sortedHabits[0] : null;
    const oppHabit = s.daysLogged > 0
      ? sortedHabits.filter(h => h.count < s.daysLogged).sort((a, b) => a.count - b.count)[0]
      : null;

    // Motivational close (3 bands, never shaming)
    const close =
      s.daysLogged === 0
        ? "You missed this one — every week is a fresh start. Sunday is your reset."
        : s.weekPts >= 100
          ? "You're crushing it. Top of the board energy."
          : s.weekPts >= 60
            ? "Solid week. One more push and you're podium material."
            : "Every point counts. Keep showing up.";

    const overrideTag = s.hasOverride
      ? `<span style="display:inline-block;background:rgba(255,140,66,0.15);color:#FF8C42;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:1px;margin-left:6px;vertical-align:middle;">MANUAL</span>`
      : '';

    const inner = `
      <!-- Greeting -->
      <div style="padding:24px 28px 4px;">
        <p style="color:#111111;font-size:18px;font-weight:800;margin:0 0 4px;">Hey ${firstName} ${emoji}</p>
        <p style="color:#6A6A6A;font-size:14px;margin:0;">Here's how your Week ${wk} went${focus ? ` — focus was <strong>${focus}</strong>` : ''}.</p>
      </div>

      <!-- Big stats -->
      <div style="padding:18px 28px 8px;">
        <table style="width:100%;border-collapse:separate;border-spacing:8px 0;">
          <tr>
            <td style="background:#F7F7F7;border:1px solid #E1E1E1;border-radius:10px;padding:14px;text-align:center;width:33%;">
              <div style="font-size:28px;font-weight:900;color:#DE3341;line-height:1;">${s.weekPts}${overrideTag}</div>
              <div style="font-size:10px;color:#6A6A6A;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px;">Points</div>
            </td>
            <td style="background:#F7F7F7;border:1px solid #E1E1E1;border-radius:10px;padding:14px;text-align:center;width:33%;">
              <div style="font-size:28px;font-weight:900;color:#DE3341;line-height:1;">#${rank}</div>
              <div style="font-size:10px;color:#6A6A6A;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px;">of ${profiles.length}</div>
            </td>
            <td style="background:#F7F7F7;border:1px solid #E1E1E1;border-radius:10px;padding:14px;text-align:center;width:33%;">
              <div style="font-size:28px;font-weight:900;color:#DE3341;line-height:1;">${s.daysLogged}/7</div>
              <div style="font-size:10px;color:#6A6A6A;text-transform:uppercase;letter-spacing:1.5px;margin-top:6px;">Days</div>
            </td>
          </tr>
        </table>
        ${s.perfectDays > 0 ? `
          <div style="margin-top:8px;text-align:center;color:#2E9C5C;font-size:13px;font-weight:700;">
            🔥 ${s.perfectDays} perfect day${s.perfectDays === 1 ? '' : 's'} (${MAX_DAILY}/${MAX_DAILY})
          </div>
        ` : ''}
      </div>

      <!-- Habit breakdown -->
      <div style="padding:18px 28px 4px;">
        <div style="font-size:11px;font-weight:800;color:#6A6A6A;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Habit Breakdown</div>
        <table style="width:100%;border-collapse:collapse;">
          ${habitRows}
        </table>
      </div>

      <!-- Highlights -->
      ${bestHabit ? `
      <div style="padding:14px 28px 4px;">
        <div style="background:rgba(46,156,92,0.08);border-left:3px solid #2E9C5C;border-radius:8px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:800;color:#2E9C5C;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Most Consistent</div>
          <div style="color:#111111;font-size:14px;font-weight:700;">${bestHabit.emoji} ${bestHabit.name} — ${bestHabit.count} of ${s.daysLogged} days</div>
        </div>
      </div>` : ''}

      ${oppHabit ? `
      <div style="padding:6px 28px 4px;">
        <div style="background:rgba(255,140,66,0.08);border-left:3px solid #FF8C42;border-radius:8px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:800;color:#FF8C42;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Easy Win This Week</div>
          <div style="color:#111111;font-size:14px;font-weight:700;">${oppHabit.emoji} ${oppHabit.name} — ${oppHabit.count} of ${s.daysLogged} days</div>
        </div>
      </div>` : ''}

      <!-- Edit reminder -->
      <div style="padding:14px 28px 4px;">
        <div style="background:#F7F7F7;border:1px dashed #E1E1E1;border-radius:8px;padding:14px;">
          <div style="font-size:11px;font-weight:800;color:#6A6A6A;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">⏰ Reminder</div>
          <div style="color:#111111;font-size:13px;line-height:1.5;">
            Forgot a day? Tap the <strong>Weekly</strong> tab, expand any past day, and fill in what you missed.
            You can also <strong>Edit weekly total</strong> directly. Tina locks in points on Wednesday.
          </div>
        </div>
      </div>

      <!-- Motivational close -->
      <div style="padding:14px 28px 24px;text-align:center;">
        <div style="color:#111111;font-size:14px;font-style:italic;font-weight:600;">"${close}"</div>
      </div>
    `;

    const subject = `Week ${wk} recap — ${s.weekPts} pts ${emoji}`;
    const html = brandHtmlWrap(inner, `Week ${wk} Recap`, cfg.appUrl);

    const ok = await sendEmail({ to: email, subject, html });
    if (ok) sent++; else skipped++;
  }

  return new Response(`Sent to ${sent} users (skipped ${skipped})`, { status: 200 });
});
