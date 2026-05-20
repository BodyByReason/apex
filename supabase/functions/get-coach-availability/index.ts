const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type AvailabilityRequest = {
  date: string;          // YYYY-MM-DD
  userTimezone?: string; // IANA timezone string, e.g. "America/Phoenix"
};

type BusyPeriod = {
  start: Date;
  end: Date;
};

const COACH_TIMEZONE = 'America/Phoenix';

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

function localTimeToUtc(localIso: string, tzid: string): Date {
  try {
    const naiveUtc = new Date(`${localIso}Z`);
    const wantedH = naiveUtc.getUTCHours();
    const wantedM = naiveUtc.getUTCMinutes();
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(naiveUtc).map((p) => [p.type, p.value]),
    );
    const tzH = parseInt(parts.hour ?? '0', 10) % 24;
    const tzM = parseInt(parts.minute ?? '0', 10);
    let diffMin = wantedH * 60 + wantedM - (tzH * 60 + tzM);
    if (diffMin > 720) diffMin -= 1440;
    if (diffMin < -720) diffMin += 1440;
    return new Date(naiveUtc.getTime() + diffMin * 60_000);
  } catch {
    return new Date(`${localIso}Z`);
  }
}

// ---------------------------------------------------------------------------
// CalDAV helpers
// ---------------------------------------------------------------------------

function basicAuth(email: string, password: string): string {
  return 'Basic ' + btoa(`${email}:${password}`);
}

function extractTagContent(xml: string, tag: string): string | null {
  const pattern = new RegExp(
    `<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`,
    'i',
  );
  const match = xml.match(pattern);
  return match ? match[1].trim() : null;
}

function extractCalendarHrefs(xml: string): string[] {
  const hrefs: string[] = [];
  const responseBlocks = xml.split(/<\/?(?:[^:>]+:)?response>/i);
  for (const block of responseBlocks) {
    if (/<(?:[^:>]+:)?calendar[>\s/]/i.test(block)) {
      const href = extractTagContent(block, 'href');
      if (href) hrefs.push(href);
    }
  }
  return hrefs;
}

function extractCalendarDataBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const pattern =
    /<(?:[^:>]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?calendar-data>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Resolve a path against a base URL — but if the response came back from a
 * redirected host (e.g. p11-calendars.icloud.com), use that host instead of
 * the original caldav.icloud.com so auth headers are preserved.
 */
function resolveUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const url = new URL(base);
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * PROPFIND with full debug logging.
 * Returns { text, finalUrl } so callers can track the real server host.
 */
async function propfind(
  url: string,
  auth: string,
  depth: string,
  body: string,
): Promise<{ text: string; finalUrl: string }> {
  console.log(`[CalDAV] PROPFIND → ${url} (Depth: ${depth})`);
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: depth,
    },
    body,
    redirect: 'follow',
  });
  const finalUrl = res.url || url;
  const text = await res.text();
  console.log(`[CalDAV] PROPFIND ← status ${res.status} finalUrl ${finalUrl}`);
  console.log(`[CalDAV] PROPFIND response (first 800 chars): ${text.slice(0, 800)}`);
  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPFIND ${url} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return { text, finalUrl };
}

// ---------------------------------------------------------------------------
// iCal parsing
// ---------------------------------------------------------------------------

function isAllDayLine(dtStartLine: string): boolean {
  return /:\d{8}$/.test(dtStartLine.trim());
}

function parseIcalLine(line: string): Date | null {
  const tzidMatch = line.match(/TZID=([^;:\r\n]+)/);
  const tzid = tzidMatch ? tzidMatch[1].trim() : null;
  const valueMatch = line.match(/:([^\r\n]+)$/);
  if (!valueMatch) return null;
  const value = valueMatch[1].trim();

  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
        `T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
    );
  }
  if (/^\d{8}$/.test(value)) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`,
    );
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const localIso =
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
      `T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
    return localTimeToUtc(localIso, tzid ?? COACH_TIMEZONE);
  }
  return null;
}

function utcToCoachDateStr(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: COACH_TIMEZONE }).format(d);
}

function parseVevents(icalText: string, date: string): BusyPeriod[] {
  const periods: BusyPeriod[] = [];
  const veventBlocks = icalText.split(/BEGIN:VEVENT/i);
  for (const block of veventBlocks.slice(1)) {
    const dtStartLine = block.match(/DTSTART[^\r\n]*/i);
    const dtEndLine = block.match(/DTEND[^\r\n]*/i);
    if (!dtStartLine || !dtEndLine) continue;
    if (isAllDayLine(dtStartLine[0])) continue; // skip all-day events

    const start = parseIcalLine(dtStartLine[0]);
    const end = parseIcalLine(dtEndLine[0]);
    if (!start || !end) continue;

    const startLocal = utcToCoachDateStr(start);
    const endLocal = utcToCoachDateStr(end);
    if (startLocal !== date && endLocal !== date) continue;

    periods.push({ start, end });
  }
  return periods;
}

// ---------------------------------------------------------------------------
// Full CalDAV discovery + REPORT
// ---------------------------------------------------------------------------

async function fetchIcloudBusyPeriods(
  email: string,
  password: string,
  date: string,
): Promise<BusyPeriod[]> {
  const auth = basicAuth(email, password);
  const initialBase = 'https://caldav.icloud.com';

  // Step 1: current-user-principal
  const { text: principalXml, finalUrl: principalBase } = await propfind(
    initialBase,
    auth,
    '0',
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`,
  );
  // Must extract href from INSIDE <current-user-principal>, not the first
  // <href> in the document (which is always the resource path, e.g. "/").
  const principalBlock = extractTagContent(principalXml, 'current-user-principal');
  const principalHref = principalBlock ? extractTagContent(principalBlock, 'href') : null;
  console.log(`[CalDAV] principal block: ${principalBlock}`);
  console.log(`[CalDAV] principal href: ${principalHref}`);
  if (!principalHref) throw new Error(`No current-user-principal href. principalXml(800): ${principalXml.slice(0, 800)}`);
  const principalUrl = resolveUrl(principalBase, principalHref);
  console.log(`[CalDAV] principal URL: ${principalUrl}`);

  // Step 2: calendar-home-set
  const { text: homeXml } = await propfind(
    principalUrl,
    auth,
    '0',
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`,
  );
  const homeBlock = homeXml.match(
    /<(?:[^:>]+:)?calendar-home-set[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?calendar-home-set>/i,
  );
  if (!homeBlock) throw new Error(`No calendar-home-set in response. homeXml(800): ${homeXml.slice(0, 800)}`);
  const homeHref = extractTagContent(homeBlock[1], 'href');
  console.log(`[CalDAV] home-set href: ${homeHref}`);
  if (!homeHref) throw new Error('No calendar-home-set href');
  const homeUrl = resolveUrl(principalUrl, homeHref);
  console.log(`[CalDAV] home-set URL: ${homeUrl}`);

  // Step 3: list calendars
  const { text: listXml } = await propfind(
    homeUrl,
    auth,
    '1',
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`,
  );
  const calendarHrefs = extractCalendarHrefs(listXml);
  console.log(`[CalDAV] found ${calendarHrefs.length} calendar hrefs: ${JSON.stringify(calendarHrefs)}`);
  if (calendarHrefs.length === 0) throw new Error('No calendars found in home-set');

  // Step 4: REPORT each calendar
  const dateNoHyphens = date.replace(/-/g, '');
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateNoHyphens = nextDate.toISOString().slice(0, 10).replace(/-/g, '');

  const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${dateNoHyphens}T000000Z" end="${nextDateNoHyphens}T050000Z"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const busyPeriods: BusyPeriod[] = [];

  for (const href of calendarHrefs) {
    const calUrl = resolveUrl(homeUrl, href);
    console.log(`[CalDAV] REPORT → ${calUrl}`);
    try {
      const res = await fetch(calUrl, {
        method: 'REPORT',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/xml; charset=utf-8',
          Depth: '1',
        },
        body: reportBody,
        redirect: 'follow',
      });
      const reportXml = await res.text();
      console.log(`[CalDAV] REPORT ← status ${res.status} (${calUrl})`);
      console.log(`[CalDAV] REPORT body (first 800 chars): ${reportXml.slice(0, 800)}`);
      if (!res.ok && res.status !== 207) {
        console.log(`[CalDAV] REPORT skipped (non-207): ${res.status}`);
        continue;
      }
      const icalBlocks = extractCalendarDataBlocks(reportXml);
      console.log(`[CalDAV] found ${icalBlocks.length} calendar-data blocks in REPORT`);
      for (const ical of icalBlocks) {
        const periods = parseVevents(ical, date);
        busyPeriods.push(...periods);
      }
    } catch (err) {
      console.log(`[CalDAV] REPORT error for ${calUrl}: ${err}`);
    }
  }

  console.log(`[CalDAV] total busy periods for ${date}: ${busyPeriods.length}`);
  return busyPeriods;
}

// ---------------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------------

const SLOT_START_HOUR = 8;
const SLOT_END_HOUR = 18;
const SLOT_INTERVAL_MINS = 30;
const BLOCK_MINS = 30;

function generateSlotMinutes(): number[] {
  const slots: number[] = [];
  for (let m = SLOT_START_HOUR * 60; m < SLOT_END_HOUR * 60; m += SLOT_INTERVAL_MINS) {
    slots.push(m);
  }
  return slots;
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Convert a coach-timezone HH:MM slot to the user's local timezone HH:MM.
 * Returns null if the slot lands on a different calendar date for the user.
 */
function convertSlotToUserTz(coachHHMM: string, date: string, userTz: string): string | null {
  try {
    const utcDate = localTimeToUtc(`${date}T${coachHHMM}:00`, COACH_TIMEZONE);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: userTz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(utcDate).map((p) => [p.type, p.value]),
    );
    const userDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (userDate !== date) return null; // crossed midnight — skip
    const h = parseInt(parts.hour ?? '0', 10) % 24;
    const m = parseInt(parts.minute ?? '0', 10);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } catch {
    return coachHHMM;
  }
}

function overlapsAny(slotMins: number, date: string, busyPeriods: BusyPeriod[]): boolean {
  const slotStartUtc = localTimeToUtc(`${date}T${minutesToHHMM(slotMins)}:00`, COACH_TIMEZONE);
  const slotEndUtc = new Date(slotStartUtc.getTime() + BLOCK_MINS * 60_000);
  for (const { start, end } of busyPeriods) {
    if (slotStartUtc < end && slotEndUtc > start) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST.' }), { headers: corsHeaders, status: 405 });
  }

  const allSlotMins = generateSlotMinutes();
  const allSlotStrings = allSlotMins.map(minutesToHHMM);

  let body: AvailabilityRequest;
  try {
    body = (await request.json()) as AvailabilityRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { headers: corsHeaders, status: 400 });
  }

  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return new Response(JSON.stringify({ error: 'date must be YYYY-MM-DD.' }), { headers: corsHeaders, status: 400 });
  }

  const userTz = body.userTimezone ?? COACH_TIMEZONE;

  /** Convert an array of coach-tz HH:MM slots to user-tz HH:MM, preserving order. */
  function toUserSlots(coachSlots: string[]): string[] {
    if (userTz === COACH_TIMEZONE) return coachSlots;
    return coachSlots
      .map((s) => convertSlotToUserTz(s, body.date, userTz))
      .filter((s): s is string => s !== null);
  }

  // ── Google Calendar (primary if configured) ──────────────────────────────
  const googleApiKey = Deno.env.get('GOOGLE_CALENDAR_API_KEY')?.trim();
  const googleCalendarIdsRaw = Deno.env.get('GOOGLE_CALENDAR_IDS')?.trim();
  if (googleApiKey && googleCalendarIdsRaw) {
    const calendarIds = googleCalendarIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const dayStart = localTimeToUtc(`${body.date}T00:00:00`, COACH_TIMEZONE);
      const dayEnd = localTimeToUtc(`${body.date}T23:59:59`, COACH_TIMEZONE);
      const resp = await fetch(
        `https://www.googleapis.com/calendar/v3/freeBusy?key=${encodeURIComponent(googleApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), items: calendarIds.map((id) => ({ id })) }),
        },
      );
      if (!resp.ok) throw new Error(`Google API ${resp.status}`);
      const data = await resp.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
      const busyPeriods: BusyPeriod[] = [];
      for (const id of calendarIds) {
        for (const b of data.calendars?.[id]?.busy ?? []) {
          busyPeriods.push({ start: new Date(b.start), end: new Date(b.end) });
        }
      }
      const available = allSlotStrings.filter((_, i) => !overlapsAny(allSlotMins[i], body.date, busyPeriods));
      return new Response(JSON.stringify({ slots: toUserSlots(available), caldavError: null }), { headers: corsHeaders, status: 200 });
    } catch (err) {
      console.error('[get-coach-availability] Google error:', err);
      return new Response(JSON.stringify({ slots: toUserSlots(allSlotStrings), caldavError: `Google error: ${(err as Error).message}` }), { headers: corsHeaders, status: 200 });
    }
  }

  // ── iCloud CalDAV (secondary) ────────────────────────────────────────────
  const caldavEmail = Deno.env.get('ICLOUD_CALDAV_EMAIL')?.trim();
  const caldavPassword = Deno.env.get('ICLOUD_CALDAV_PASSWORD')?.trim();
  if (caldavEmail && caldavPassword) {
    try {
      const busyPeriods = await fetchIcloudBusyPeriods(caldavEmail, caldavPassword, body.date);
      const available = allSlotStrings.filter((_, i) => !overlapsAny(allSlotMins[i], body.date, busyPeriods));
      return new Response(JSON.stringify({ slots: toUserSlots(available), caldavError: null }), { headers: corsHeaders, status: 200 });
    } catch (err) {
      console.error('[get-coach-availability] iCloud error:', err);
      return new Response(JSON.stringify({ slots: toUserSlots(allSlotStrings), caldavError: `iCloud error: ${(err as Error).message}` }), { headers: corsHeaders, status: 200 });
    }
  }

  // ── No credentials — return all slots ───────────────────────────────────
  return new Response(JSON.stringify({ slots: toUserSlots(allSlotStrings), caldavError: 'No calendar credentials configured.' }), { headers: corsHeaders, status: 200 });
});
