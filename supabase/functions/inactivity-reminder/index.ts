// Thursday-evening nudge for members who haven't logged in 3+ days.
// Runs Thursday 7 PM EDT (Friday 03:00 UTC during EDT).
// Hybrid tone: brief one-line acknowledgment, then pivots to "your week so far"
// stat with days-left framing. Never shaming — just a friendly check-in.
// Cron: 0 23 * * 4  (note: add 1 hour during EST winter — see config.toml)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  MAX_DAILY,
  loadProgramConfig, currentWeekNum, weekStartDate, weekEndDate,
  pointsForLog, resolveEmails, sendEmail, brandHtmlWrap,
} from '../_shared/helpers.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  const cfg = await loadProgramConfig(supabase);
  const today = new Date();

  // Bail if we're outside the program window — no point nudging people about a program
  // that hasn't started or has already ended.
  const programEnd = new Date(cfg.programStart);
  programEnd.setUTCDate(programEnd.getUTCDate() + cfg.programWeeks * 7 - 1);
  if (today < cfg.programStart || today > programEnd) {
    return new Response('Outside program window — no reminders sent', { status: 200 });
  }

  const wk = currentWeekNum(cfg.programStart, cfg.programWeeks);
  const weekStart = weekStartDate(wk, cfg.programStart);
  const weekEnd = weekEndDate(wk, cfg.programStart);

  // Active members who haven't opted out of the reminder.
  // email_reminder_enabled defaults to true; null/missing = enabled.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email_reminder_enabled')
    .eq('is_active', true);
  if (!profiles?.length) return new Response('No active users', { status: 200 });

  const userIds = profiles.map(p => p.id);
  const emails = await resolveEmails(supabase, userIds);

  // Pull last 7 days of logs to compute (a) most-recent log per user, (b) week-to-date pts.
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysAgoKey = sevenDaysAgo.toISOString().split('T')[0];

  const { data: logs } = await supabase
    .from('habit_logs')
    .select('user_id, log_date, habits')
    .gte('log_date', sevenDaysAgoKey);

  const lastLogByUser: Record<string, string> = {};
  const weekPtsByUser: Record<string, number> = {};
  for (const l of (logs as any[]) || []) {
    if (!lastLogByUser[l.user_id] || l.log_date > lastLogByUser[l.user_id]) {
      lastLogByUser[l.user_id] = l.log_date;
    }
    if (l.log_date >= weekStart && l.log_date <= weekEnd) {
      weekPtsByUser[l.user_id] = (weekPtsByUser[l.user_id] || 0) + pointsForLog(l.habits);
    }
  }

  // Threshold: last log >= 3 days ago, OR no log in the last 7 days at all.
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 3);
  const cutoffKey = cutoff.toISOString().split('T')[0];

  // Days remaining in the week (today through Saturday inclusive)
  const todayKey = today.toISOString().split('T')[0];
  const daysLeft = Math.max(1, Math.floor((new Date(weekEnd + 'T23:59:59Z').getTime() - today.getTime()) / 86400000) + 1);

  // Test-mode: when TEST_EMAIL is set, only send to that one address.
  const testEmail = Deno.env.get('TEST_EMAIL')?.trim().toLowerCase() || null;
  if (testEmail) console.log('TEST_EMAIL active — restricting send to', testEmail);

  const wkMax = MAX_DAILY * 7;
  let sent = 0, skipped = 0, eligible = 0;

  for (const profile of profiles) {
    const email = emails[profile.id];
    if (!email) { skipped++; continue; }
    if (testEmail && email.toLowerCase() !== testEmail) { skipped++; continue; }
    if (profile.email_reminder_enabled === false) { skipped++; continue; }

    const lastLog = lastLogByUser[profile.id];
    // Skip members who have logged within the threshold (they're active, no nudge needed)
    if (lastLog && lastLog >= cutoffKey) { skipped++; continue; }

    eligible++;
    const firstName = (profile.name || email.split('@')[0]).split(' ')[0];
    const wkPts = weekPtsByUser[profile.id] || 0;

    const inner = `
      <!-- Greeting + brief acknowledgment + pivot to encouragement -->
      <div style="padding:24px 28px 4px;">
        <p style="color:#111111;font-size:18px;font-weight:800;margin:0 0 6px;">Hey ${firstName} 👋</p>
        <p style="color:#6A6A6A;font-size:14px;line-height:1.55;margin:0;">
          Quick check-in — haven't seen you log this week. Good news: the week's not over and every day still counts.
        </p>
      </div>

      <!-- Week-to-date stat tile -->
      <div style="padding:18px 28px 8px;">
        <div style="background:#F7F7F7;border:1px solid #E1E1E1;border-radius:10px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:900;color:#DE3341;line-height:1;">${wkPts}<span style="color:#B0B0B0;font-size:18px;font-weight:700;"> / ${wkMax}</span></div>
          <div style="font-size:12px;color:#6A6A6A;font-weight:600;margin-top:6px;text-transform:uppercase;letter-spacing:0.5px;">Week ${wk} points</div>
          <div style="font-size:13px;color:#111111;font-weight:600;margin-top:10px;">${daysLeft} day${daysLeft === 1 ? '' : 's'} left to put some on the board</div>
        </div>
      </div>

      <!-- Encouragement close -->
      <div style="padding:14px 28px 24px;text-align:center;">
        <p style="color:#111111;font-size:14px;font-weight:600;margin:0;">Tap any habit you hit today and you're back in.</p>
      </div>

      <!-- Opt-out hint -->
      <div style="padding:0 28px 18px;text-align:center;">
        <p style="color:#B0B0B0;font-size:11px;margin:0;">Don't want these check-ins? Tap your avatar in the app → Settings.</p>
      </div>
    `;

    const subject = `Quick check-in — Week ${wk} still has time`;
    const html = brandHtmlWrap(inner, `Week ${wk} check-in`, cfg.appUrl);

    const ok = await sendEmail({ to: email, subject, html });
    if (ok) sent++; else skipped++;
  }

  return new Response(`Sent to ${sent} users (${eligible} eligible, ${skipped} skipped)`, { status: 200 });
});
