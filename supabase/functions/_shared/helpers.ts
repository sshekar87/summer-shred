// Shared helpers for Live B.I.G 365 weekly email Edge Functions.
// Mirrors the app's HABITS array, point computation, and Sun-Sat week math.
// Brand styling matches the live app's light theme (off-white #F7F7F7, red #DE3341).

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface Habit {
  id: string;
  emoji: string;
  name: string;
  pts: number;
}

export const HABITS: Habit[] = [
  { id: 'train',    emoji: '🏋️', name: 'Train',          pts: 1 },
  { id: 'mobility', emoji: '🧘', name: 'Flexy & Sexy',   pts: 1 },
  { id: 'sleep',    emoji: '😴', name: 'Sleep',          pts: 1 },
  { id: 'fasting',  emoji: '⏱️', name: 'Fasting',        pts: 1 },
  { id: 'veggies',  emoji: '🥦', name: 'Veggies & Fruit',pts: 1 },
  { id: 'water',    emoji: '💧', name: 'Hydration',      pts: 1 },
  { id: 'alcohol',  emoji: '🚫', name: 'No Alcohol',     pts: 5 },
  { id: 'bread',    emoji: '🍞', name: 'No Bread',       pts: 5 },
  { id: 'sugar',    emoji: '🍬', name: 'No Added Sugar', pts: 5 },
  { id: 'extra',    emoji: '⭐', name: 'Extra Credit',   pts: 5 },
];

export const MAX_DAILY = HABITS.reduce((a, h) => a + h.pts, 0); // 26

// Sum points for a single day's habit log (habits is JSONB { habitId: bool })
export function pointsForLog(habits: Record<string, boolean> | null | undefined): number {
  if (!habits) return 0;
  return HABITS.reduce((a, h) => a + (habits[h.id] ? h.pts : 0), 0);
}

export interface ProgramConfig {
  programStart: Date;       // local-naïve, parsed as UTC midnight from program_config.program_start (a date)
  programWeeks: number;
  weeklyFocus: Record<string, string>;
  appUrl: string;
}

export async function loadProgramConfig(supabase: SupabaseClient): Promise<ProgramConfig> {
  const { data } = await supabase
    .from('program_config')
    .select('program_start, program_weeks, weekly_focus')
    .eq('id', 1)
    .single();

  // Default to live values if missing for any reason
  const startStr = (data?.program_start as string) || '2026-04-12';
  return {
    programStart: new Date(startStr + 'T00:00:00Z'),
    programWeeks: (data?.program_weeks as number) || 8,
    weeklyFocus: (data?.weekly_focus as Record<string, string>) || {},
    appUrl: Deno.env.get('APP_URL') || 'https://livebig365.fit',
  };
}

// Days are stored as YYYY-MM-DD strings. All math is UTC-relative since program_config.program_start
// is a DATE (no timezone) — we treat everything as midnight UTC for consistency across runs.
export function dayOffset(key: string, n: number): string {
  const d = new Date(key + 'T12:00:00Z'); // noon UTC anchor — robust against DST/timezone drift
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

export function weekStartDate(wk: number, programStart: Date): string {
  const d = new Date(programStart);
  d.setUTCDate(d.getUTCDate() + (wk - 1) * 7);
  return d.toISOString().split('T')[0];
}

export function weekEndDate(wk: number, programStart: Date): string {
  return dayOffset(weekStartDate(wk, programStart), 6);
}

export function currentWeekNum(programStart: Date, programWeeks: number): number {
  const diff = Math.floor((Date.now() - programStart.getTime()) / (7 * 86400000));
  return Math.max(1, Math.min(programWeeks, diff + 1));
}

// "Prior week" = the most recently completed Sun-Sat week. For email recaps that close out a week.
export function priorWeekNum(programStart: Date, programWeeks: number): number {
  const cw = currentWeekNum(programStart, programWeeks);
  return Math.max(1, cw - 1);
}

export function rankEmoji(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '💪';
}

// Brand HTML wrapper — light theme matching the live app exactly.
// inner is the body content (sections/cards). subject is shown in the small header band.
export function brandHtmlWrap(inner: string, subject: string, appUrl: string): string {
  return `
    <div style="background:#F7F7F7;padding:24px 0;font-family:'DM Sans',Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E1E1E1;">

        <!-- Header band -->
        <div style="background:#FFFFFF;padding:24px 28px 16px;border-bottom:1px solid #E1E1E1;">
          <div style="font-size:18px;font-weight:900;letter-spacing:1.5px;color:#111111;text-transform:uppercase;">
            LIVE <span style="color:#DE3341;font-style:italic;">B.I.G</span> 365
          </div>
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#6A6A6A;text-transform:uppercase;margin-top:4px;">
            ${subject}
          </div>
        </div>

        ${inner}

        <!-- Footer -->
        <div style="padding:18px 28px;border-top:1px solid #E1E1E1;text-align:center;">
          <a href="${appUrl}" style="display:inline-block;background:#DE3341;color:#FFFFFF;padding:12px 28px;border-radius:8px;font-weight:800;font-size:13px;letter-spacing:1.2px;text-decoration:none;">
            OPEN LIVE B.I.G 365 →
          </a>
          <p style="color:#B0B0B0;font-size:11px;margin:14px 0 0;">livebig365.fit</p>
        </div>

      </div>
    </div>`;
}

// Compute per-user week stats: pts (with override fallback), days logged, perfect days, habit counts.
export interface UserWeekStats {
  userId: string;
  weekPts: number;          // override-aware
  dailyPts: number;         // sum of daily logs only
  daysLogged: number;
  perfectDays: number;
  habitCounts: Record<string, number>;
  hasOverride: boolean;
}

export async function computeWeekStats(
  supabase: SupabaseClient,
  userIds: string[],
  weekStart: string,
  weekEnd: string,
  weekNum: number
): Promise<Record<string, UserWeekStats>> {
  const out: Record<string, UserWeekStats> = {};
  // Init defaults
  for (const id of userIds) {
    out[id] = { userId: id, weekPts: 0, dailyPts: 0, daysLogged: 0, perfectDays: 0, habitCounts: {}, hasOverride: false };
  }

  const { data: logs } = await supabase
    .from('habit_logs')
    .select('user_id, log_date, habits')
    .gte('log_date', weekStart)
    .lte('log_date', weekEnd);

  for (const log of (logs as any[]) || []) {
    const stats = out[log.user_id];
    if (!stats) continue;
    const pts = pointsForLog(log.habits);
    stats.dailyPts += pts;
    stats.daysLogged += 1;
    if (pts >= MAX_DAILY) stats.perfectDays += 1;
    for (const h of HABITS) {
      if (log.habits?.[h.id]) {
        stats.habitCounts[h.id] = (stats.habitCounts[h.id] ?? 0) + 1;
      }
    }
  }

  const { data: overrides } = await supabase
    .from('week_overrides')
    .select('user_id, total_pts')
    .eq('week_num', weekNum);

  for (const ov of (overrides as any[]) || []) {
    if (out[ov.user_id]) {
      out[ov.user_id].weekPts = ov.total_pts;
      out[ov.user_id].hasOverride = true;
    }
  }
  // For non-overridden users, week pts = sum of daily
  for (const id of userIds) {
    if (!out[id].hasOverride) out[id].weekPts = out[id].dailyPts;
  }

  return out;
}

// Resolve auth emails for a list of profile ids. Uses listUsers (paginated up to 1000).
export async function resolveEmails(
  supabase: SupabaseClient,
  profileIds: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of (data?.users as any[]) || []) {
    if (profileIds.includes(u.id) && u.email) out[u.id] = u.email;
  }
  return out;
}

// Send via Resend. Returns true on success.
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error('RESEND_API_KEY not set');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Live B.I.G 365 <noreply@livebig365.fit>',
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, txt.slice(0, 300));
    return false;
  }
  return true;
}
