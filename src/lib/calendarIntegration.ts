/**
 * calendarIntegration.ts
 *
 * Handles:
 *  1. Google Calendar free/busy checks for 1-on-1 bookings (anti-overbooking)
 *  2. Group session fixed schedule — Wednesday 8:30 pm EST, shown in user's local TZ
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export const CALENDAR_SETTINGS_KEY = 'apex.coach.calendar.v1';

export type CalendarSettings = {
  googleApiKey: string;
  googleCalendarId: string;
};

const DEFAULT: CalendarSettings = { googleApiKey: '', googleCalendarId: '' };

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function getCalendarSettings(): Promise<CalendarSettings> {
  const raw = await AsyncStorage.getItem(CALENDAR_SETTINGS_KEY).catch(() => null);
  if (!raw) return DEFAULT;
  try { return { ...DEFAULT, ...JSON.parse(raw) }; } catch { return DEFAULT; }
}

export async function saveCalendarSettings(s: CalendarSettings): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_SETTINGS_KEY, JSON.stringify(s));
}

// ─── Google Calendar free/busy ────────────────────────────────────────────────

export type BusyPeriod = { start: string; end: string };

/**
 * Returns busy periods for a given date via Google Calendar Free/Busy API.
 * Requires the calendar to be shared as "See free/busy information (no details)".
 */
export async function fetchBusyTimes(
  date: string, // YYYY-MM-DD in local time
  apiKey: string,
  calendarId: string,
): Promise<BusyPeriod[]> {
  if (!apiKey || !calendarId) return [];
  const dayStart = new Date(`${date}T00:00:00`).toISOString();
  const dayEnd   = new Date(`${date}T23:59:59`).toISOString();
  try {
    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/freeBusy?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: dayStart,
          timeMax: dayEnd,
          items: [{ id: calendarId }],
        }),
      },
    );
    const data = await resp.json() as { calendars?: Record<string, { busy?: BusyPeriod[] }> };
    return data.calendars?.[calendarId]?.busy ?? [];
  } catch {
    return [];
  }
}

/**
 * Returns true when a 1-hour time slot does NOT overlap any busy period.
 * @param timeStr – "HH:MM" in the user's LOCAL timezone
 */
export function isSlotAvailable(
  timeStr: string,
  date: string,
  busyPeriods: BusyPeriod[],
): boolean {
  if (!busyPeriods.length) return true;
  const [h, m] = timeStr.split(':').map(Number);
  const slotStart = new Date(`${date}T00:00:00`);
  slotStart.setHours(h, m, 0, 0);
  const slotEnd = new Date(slotStart.getTime() + 60 * 60_000);
  return !busyPeriods.some((b) => {
    const bs = new Date(b.start);
    const be = new Date(b.end);
    return slotStart < be && slotEnd > bs;
  });
}

// ─── Group session helpers ────────────────────────────────────────────────────

/** Group sessions are fixed: Wednesday at 8:30 pm EST (America/New_York). */
export const GROUP_SESSION_DAY = 3;         // 0=Sun … 6=Sat
export const GROUP_SESSION_IANA_TZ = 'America/New_York';
export const GROUP_SESSION_DISPLAY_EST = '8:30 PM ET';

/**
 * Convert Wednesday 8:30 pm ET to the user's local time string.
 * Falls back to "8:30 PM ET" on any parse error.
 */
export function groupSessionLocalTimeStr(): string {
  try {
    // Build a concrete date: next Wednesday (arbitrary but in the right DST zone)
    const ref = new Date();
    const daysToWed = (3 - ref.getDay() + 7) % 7 || 7;
    ref.setDate(ref.getDate() + daysToWed);
    const dateStr = ref.toISOString().slice(0, 10); // YYYY-MM-DD

    // Parse "YYYY-MM-DD 20:30" as if it is ET using Intl to figure out the UTC offset
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: GROUP_SESSION_IANA_TZ,
      hour: 'numeric', minute: '2-digit', hour12: false,
    });
    // We want: what UTC instant corresponds to 20:30 ET on that date?
    // Approximate: build a UTC Date, then adjust by comparing what ET gives us
    const utcGuess = new Date(`${dateStr}T20:30:00Z`);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: GROUP_SESSION_IANA_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(utcGuess).map((p) => [p.type, p.value]),
    );
    // Compute offset: difference between UTC guess hour and ET result hour
    const etHour = parseInt(parts.hour ?? '24', 10);
    const utcHour = utcGuess.getUTCHours();
    const offsetH = utcHour - (etHour === 24 ? 0 : etHour);

    // Now build the correct UTC instant for 20:30 ET
    const exact = new Date(`${dateStr}T20:30:00Z`);
    exact.setUTCHours(20 + offsetH, 30, 0, 0);

    return exact.toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZoneName: 'short',
    });
  } catch {
    return GROUP_SESSION_DISPLAY_EST;
  }
}

/** Returns true when dateStr (YYYY-MM-DD) falls on a Wednesday. */
export function isWednesdayDate(dateStr: string): boolean {
  return new Date(`${dateStr}T12:00:00`).getDay() === GROUP_SESSION_DAY;
}

/**
 * Returns the "HH:MM" string (24-h, local TZ) for 8:30 pm ET.
 * Used to auto-fill the time slot for group bookings.
 */
export function groupSessionLocalTime24(): string {
  try {
    const ref = new Date();
    const daysToWed = (3 - ref.getDay() + 7) % 7 || 7;
    ref.setDate(ref.getDate() + daysToWed);
    const dateStr = ref.toISOString().slice(0, 10);

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: GROUP_SESSION_IANA_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(`${dateStr}T20:30:00Z`)).map((p) => [p.type, p.value]),
    );
    const etHour = parseInt(parts.hour ?? '24', 10);
    const utcHour = new Date(`${dateStr}T20:30:00Z`).getUTCHours();
    const offsetH = utcHour - (etHour === 24 ? 0 : etHour);
    const exact = new Date(`${dateStr}T20:30:00Z`);
    exact.setUTCHours(20 + offsetH, 30, 0, 0);
    return `${String(exact.getHours()).padStart(2, '0')}:${String(exact.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '20:30';
  }
}

// ─── Fit Call availability & booking ─────────────────────────────────────────

export type FitCallSlotsResult = {
  slots: string[];
  /** Non-null when CalDAV check failed and all slots are shown as fallback. */
  caldavError: string | null;
};

/**
 * Fetches available 15-min call slots for a given date from the coach's
 * iCloud calendar via the `get-coach-availability` Supabase edge function.
 * Returns slots array plus a caldavError flag (non-null = fallback mode).
 */
export async function fetchFitCallSlots(
  date: string, // YYYY-MM-DD
  supabaseUrl: string,
  supabaseAnonKey: string,
  userTimezone?: string,
): Promise<FitCallSlotsResult> {
  const tz = userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/get-coach-availability`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ date, userTimezone: tz }),
      },
    );
    if (!resp.ok) {
      return { slots: [], caldavError: `Server error ${resp.status}` };
    }
    const data = await resp.json() as { slots?: string[]; caldavError?: string | null };
    return {
      slots: Array.isArray(data.slots) ? data.slots : [],
      caldavError: data.caldavError ?? null,
    };
  } catch (err) {
    return {
      slots: [],
      caldavError: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Books a 15-minute fit call via the `book-fit-call` Supabase edge function.
 */
export async function bookFitCall(input: {
  userId: string;
  clientName: string;
  clientPhone: string;
  challenge: string;
  date: string;
  time: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  userTimezone?: string;
  goal?: string;
  dietHabits?: string;
}): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  const tz = input.userTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const resp = await fetch(
      `${input.supabaseUrl}/functions/v1/book-fit-call`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': input.supabaseAnonKey,
          'Authorization': `Bearer ${input.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          userId: input.userId,
          clientName: input.clientName,
          clientPhone: input.clientPhone,
          challenge: input.challenge,
          date: input.date,
          time: input.time,
          userTimezone: tz,
          ...(input.goal       ? { goal: input.goal }             : {}),
          ...(input.dietHabits ? { dietHabits: input.dietHabits } : {}),
        }),
      },
    );
    const data = await resp.json() as { ok?: boolean; bookingId?: string; error?: string };
    if (!resp.ok || !data.ok) return { ok: false, error: data.error ?? 'Booking failed' };
    return { ok: true, bookingId: data.bookingId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
