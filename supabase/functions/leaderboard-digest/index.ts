// Tuesday night group leaderboard digest.
// Runs Tuesday 9 PM EDT (01:00 UTC Wednesday). Recaps the same prior Sun-Sat week
// as the Sunday recap, framed as "last call before Tina locks in points tomorrow".
// Cron: 0 1 * * 3  (note: subtract 1 hour during EST winter — see config.toml)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  HABITS, MAX_DAILY,
  loadProgramConfig, priorWeekNum, weekStartDate, weekEndDate,
  computeWeekStats, resolveEmails, sendEmail, brandHtmlWrap,
} from '../_shared/helpers.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  const cfg = await loadProgramConfig(supabase);
  const wk = priorWeekNum(cfg.programStart, cfg.programWeeks);
  if (wk < 1) return new Response('Pre-program — nothing to digest yet', { status: 200 });

  const weekStart = weekStartDate(wk, cfg.programStart);
  const weekEnd = weekEndDate(wk, cfg.programStart);

  // Active members
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('is_active', true);
  if (!profiles?.length) return new Response('No active users', { status: 200 });

  const userIds = profiles.map(p => p.id);
  const stats = await computeWeekStats(supabase, userIds, weekStart, weekEnd, wk);

  // For "most-improved" callout: pull prior week stats (week wk-1) if it exists
  let lastWeekStats: Record<string, { weekPts: number }> = {};
  if (wk > 1) {
    const prevStart = weekStartDate(wk - 1, cfg.programStart);
    const prevEnd = weekEndDate(wk - 1, cfg.programStart);
    const prev = await computeWeekStats(supabase, userIds, prevStart, prevEnd, wk - 1);
    for (const id of Object.keys(prev)) lastWeekStats[id] = { weekPts: prev[id].weekPts };
  }

  const emails = await resolveEmails(supabase, userIds);

  // Sort leaderboard by week pts desc
  const board = profiles
    .map(p => ({
      id: p.id,
      name: (p.name || emails[p.id]?.split('@')[0] || 'Member').split(' ')[0],
      s: stats[p.id],
    }))
    .sort((a, b) => b.s.weekPts - a.s.weekPts);

  // Achievement highlights — positive callouts only, never points fingers
  const top = board[0];
  const perfectDayPeople = board.filter(b => b.s.perfectDays > 0);
  // Most-improved: largest week-over-week pts gain (only consider gains)
  const improvements = board
    .map(b => ({ ...b, gain: b.s.weekPts - (lastWeekStats[b.id]?.weekPts ?? 0) }))
    .filter(b => b.gain > 0 && wk > 1)
    .sort((a, b) => b.gain - a.gain);
  const mostImproved = improvements[0];
  // Anyone who hit any single habit 7 days in a row (Locked In territory)
  const lockedIn = board.filter(b => Object.values(b.s.habitCounts).some(c => c >= 7));

  // Group totals
  const totalGroupPts = board.reduce((a, b) => a + b.s.weekPts, 0);
  const totalDaysLogged = board.reduce((a, b) => a + b.s.daysLogged, 0);
  const totalPerfectDays = board.reduce((a, b) => a + b.s.perfectDays, 0);
  const avgPts = board.length ? Math.round(totalGroupPts / board.length) : 0;

  const focus = cfg.weeklyFocus[String(wk)] || '';

  // Test-mode: when TEST_EMAIL is set, only send to that one address (skip everyone else).
  // Set + unset via Supabase dashboard → Edge Functions → Secrets.
  const testEmail = Deno.env.get('TEST_EMAIL')?.trim().toLowerCase() || null;
  if (testEmail) console.log('TEST_EMAIL active — restricting send to', testEmail);

  let sent = 0;
  let skipped = 0;

  for (const recipient of board) {
    const email = emails[recipient.id];
    if (!email) { skipped++; continue; }
    if (testEmail && email.toLowerCase() !== testEmail) { skipped++; continue; }
    const firstName = recipient.name;

    // Build leaderboard table (highlight recipient)
    const lbRows = board.map((b, i) => {
      const isMe = b.id === recipient.id;
      const rankBadge = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const overrideTag = b.s.hasOverride
        ? `<span style="display:inline-block;background:rgba(255,140,66,0.15);color:#FF8C42;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:1px;margin-left:4px;vertical-align:middle;">M</span>`
        : '';
      return `
        <tr style="${isMe ? 'background:rgba(222,51,65,0.06);' : ''}">
          <td style="padding:8px 10px;font-size:13px;font-weight:800;color:${i < 3 ? '#DE3341' : '#6A6A6A'};text-align:center;width:36px;">${rankBadge}</td>
          <td style="padding:8px 10px;font-size:13px;font-weight:${isMe ? '800' : '600'};color:#111111;">
            ${b.name}${isMe ? ' <span style="color:#DE3341;font-size:11px;font-weight:700;">(you)</span>' : ''}
          </td>
          <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#DE3341;text-align:right;white-space:nowrap;">${b.s.weekPts}${overrideTag}</td>
        </tr>`;
    }).join('');

    // Highlights HTML — only render rows that have data
    const highlights: string[] = [];
    if (top && top.s.weekPts > 0) {
      highlights.push(`<div style="margin-bottom:6px;"><strong>${top.name}</strong> led the board with <strong>${top.s.weekPts} pts</strong> 🏆</div>`);
    }
    if (perfectDayPeople.length) {
      const names = perfectDayPeople.map(p => `<strong>${p.name}</strong>`).join(', ');
      const total = perfectDayPeople.reduce((a, p) => a + p.s.perfectDays, 0);
      highlights.push(`<div style="margin-bottom:6px;">${names} hit <strong>${total} perfect day${total === 1 ? '' : 's'}</strong> (${MAX_DAILY}/${MAX_DAILY}) 💯</div>`);
    }
    if (mostImproved && mostImproved.gain >= 10) {
      highlights.push(`<div style="margin-bottom:6px;"><strong>${mostImproved.name}</strong> jumped <strong>+${mostImproved.gain} pts</strong> over last week 📈</div>`);
    }
    if (lockedIn.length) {
      const names = lockedIn.slice(0, 3).map(p => `<strong>${p.name}</strong>`).join(', ');
      highlights.push(`<div style="margin-bottom:6px;">${names} hit a 7-day single-habit streak 🎯</div>`);
    }
    const highlightsHtml = highlights.length
      ? highlights.join('')
      : '<div style="color:#6A6A6A;">Quiet week. Plenty of room to take the top spot next week.</div>';

    const inner = `
      <!-- Greeting -->
      <div style="padding:24px 28px 4px;">
        <p style="color:#111111;font-size:18px;font-weight:800;margin:0 0 4px;">Hey ${firstName} 👋</p>
        <p style="color:#6A6A6A;font-size:14px;margin:0;">
          Here's how the group did in Week ${wk}${focus ? ` (focus was <strong>${focus}</strong>)` : ''}.
        </p>
      </div>

      <!-- Group stats banner -->
      <div style="padding:18px 28px 8px;">
        <div style="background:#F7F7F7;border:1px solid #E1E1E1;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:13px;font-weight:700;color:#6A6A6A;">Group pulse</div>
          <div style="margin-top:6px;font-size:13px;color:#111111;">
            <strong>${totalGroupPts}</strong> total pts · <strong>${avgPts}</strong> avg per member · <strong>${totalDaysLogged}</strong> days logged${totalPerfectDays > 0 ? ` · <strong>${totalPerfectDays}</strong> perfect days` : ''}
          </div>
        </div>
      </div>

      <!-- Leaderboard table -->
      <div style="padding:18px 28px 4px;">
        <div style="font-size:14px;font-weight:700;color:#111111;margin-bottom:10px;">Leaderboard · Week ${wk}</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #E1E1E1;border-radius:8px;overflow:hidden;">
          ${lbRows}
        </table>
      </div>

      <!-- Highlights -->
      <div style="padding:18px 28px 4px;">
        <div style="font-size:14px;font-weight:700;color:#111111;margin-bottom:10px;">🌟 Highlights</div>
        <div style="background:#F7F7F7;border:1px solid #E1E1E1;border-radius:10px;padding:14px;color:#111111;font-size:13px;line-height:1.5;">
          ${highlightsHtml}
        </div>
      </div>

      <!-- Last call CTA -->
      <div style="padding:18px 28px 4px;">
        <div style="background:rgba(222,51,65,0.08);border-left:3px solid #DE3341;border-radius:8px;padding:14px 16px;">
          <div style="font-size:12px;font-weight:700;color:#DE3341;margin-bottom:6px;">⏰ Last call</div>
          <div style="color:#111111;font-size:14px;line-height:1.55;">
            Tap the <strong>Weekly</strong> tab, expand any day, and fill in what you missed before <strong>Tina locks in points tomorrow</strong>.
          </div>
        </div>
      </div>

      <!-- Encouragement close -->
      <div style="padding:14px 28px 24px;text-align:center;">
        <div style="color:#111111;font-size:14px;font-weight:600;">Every rep counts. Show up for Week ${wk + 1 <= cfg.programWeeks ? wk + 1 : 'the finish'}.</div>
      </div>
    `;

    const subject = `Week ${wk} pulse — last call before Wed lock-in`;
    const html = brandHtmlWrap(inner, `Week ${wk} Group Pulse`, cfg.appUrl);

    const ok = await sendEmail({ to: email, subject, html });
    if (ok) sent++; else skipped++;
  }

  return new Response(`Sent to ${sent} users (skipped ${skipped})`, { status: 200 });
});
