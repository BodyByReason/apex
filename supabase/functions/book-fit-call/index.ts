import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type BookingRequest = {
  userId: string;
  clientName: string;
  clientPhone: string;
  challenge: string;
  date: string;          // YYYY-MM-DD
  time: string;          // HH:MM (24h) in userTimezone
  userTimezone?: string; // IANA tz, e.g. "America/Phoenix"
  goal?: string;         // user's fitness goal key (e.g. "lose_weight")
  dietHabits?: string;   // free-text answer to diet & movement question
};

const COACH_TIMEZONE = 'America/Phoenix';

/** Convert a local HH:MM on a given date in tzid to a UTC Date. */
function localTimeToUtc(localIso: string, tzid: string): Date {
  try {
    const naiveUtc = new Date(`${localIso}Z`);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tzid, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(naiveUtc).map((p) => [p.type, p.value]),
    );
    const tzH = parseInt(parts.hour ?? '0', 10) % 24;
    const tzM = parseInt(parts.minute ?? '0', 10);
    const wantedH = naiveUtc.getUTCHours();
    const wantedM = naiveUtc.getUTCMinutes();
    let diffMin = wantedH * 60 + wantedM - (tzH * 60 + tzM);
    if (diffMin > 720) diffMin -= 1440;
    if (diffMin < -720) diffMin += 1440;
    return new Date(naiveUtc.getTime() + diffMin * 60_000);
  } catch {
    return new Date(`${localIso}Z`);
  }
}

/** Convert user-tz HH:MM on date to coach-tz HH:MM string. */
function convertToCoachTime(userHHMM: string, date: string, userTz: string): string {
  try {
    const utc = localTimeToUtc(`${date}T${userHHMM}:00`, userTz);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: COACH_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(utc).map((p) => [p.type, p.value]),
    );
    const h = parseInt(parts.hour ?? '0', 10) % 24;
    const m = parseInt(parts.minute ?? '0', 10);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } catch {
    return userHHMM;
  }
}

// ---------------------------------------------------------------------------
// CalDAV helpers (duplicated — no shared module between edge functions)
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

function extractCalendarHrefs(propfindXml: string): string[] {
  const hrefs: string[] = [];
  const responseBlocks = propfindXml.split(/<\/?(?:[^:>]+:)?response>/i);
  for (const block of responseBlocks) {
    if (/<(?:[^:>]+:)?calendar[>\s/]/i.test(block)) {
      const href = extractTagContent(block, 'href');
      if (href) hrefs.push(href);
    }
  }
  return hrefs;
}

function resolveUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const url = new URL(base);
  return `${url.protocol}//${url.host}${path}`;
}

async function propfind(
  url: string,
  auth: string,
  depth: string,
  body: string,
): Promise<string> {
  const res = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: depth,
    },
    body,
  });
  if (!res.ok && res.status !== 207) {
    throw new Error(
      `PROPFIND ${url} → ${res.status}: ${await res.text().catch(() => '')}`,
    );
  }
  return res.text();
}

/** Discover the primary writable calendar URL. */
async function discoverPrimaryCalendarUrl(
  baseUrl: string,
  auth: string,
): Promise<string> {
  const principalXml = await propfind(
    baseUrl,
    auth,
    '0',
    `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`,
  );
  const principalBlock = extractTagContent(principalXml, 'current-user-principal');
  const principalHref = principalBlock ? extractTagContent(principalBlock, 'href') : null;
  if (!principalHref) throw new Error('Could not find current-user-principal href');
  const principalUrl = resolveUrl(baseUrl, principalHref);

  const homeXml = await propfind(
    principalUrl,
    auth,
    '0',
    `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`,
  );
  const homeBlock = homeXml.match(
    /<(?:[^:>]+:)?calendar-home-set[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?calendar-home-set>/i,
  );
  if (!homeBlock) throw new Error('Could not find calendar-home-set');
  const homeHref = extractTagContent(homeBlock[1], 'href');
  if (!homeHref) throw new Error('Could not find calendar-home-set href');
  const homeUrl = resolveUrl(baseUrl, homeHref);

  const listXml = await propfind(
    homeUrl,
    auth,
    '1',
    `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
  );
  const calendarHrefs = extractCalendarHrefs(listXml);
  if (calendarHrefs.length === 0) throw new Error('No calendars found');
  const calHref = calendarHrefs.find((h) => h !== homeHref) ?? calendarHrefs[0];
  return resolveUrl(baseUrl, calHref);
}

// ---------------------------------------------------------------------------
// iCal event builder
// ---------------------------------------------------------------------------

function formatIcalDateTime(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:MM → 20240115T090000 (no Z — timezone set via TZID)
  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');
  return `${year}${month}${day}T${hour}${minute}00`;
}

function buildVcalendar(params: {
  uid: string;
  dtstart: string;
  dtend: string;
  timezone: string;
  summary: string;
  description: string;
  now: string;
}): string {
  const { uid, dtstart, dtend, timezone, summary, description, now } = params;
  const escapedSummary = summary.replace(/[,;\\]/g, (c) => `\\${c}`);
  const escapedDesc = description
    .replace(/[,;\\]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//APEX Fitness//FitCall//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}Z`,
    `DTSTART;TZID=${timezone}:${dtstart}`,
    `DTEND;TZID=${timezone}:${dtend}`,
    `SUMMARY:${escapedSummary}`,
    `DESCRIPTION:${escapedDesc}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Add 15 minutes to a HH:MM time string. */
function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Resend email
// ---------------------------------------------------------------------------

async function sendNotificationEmail(params: {
  apiKey: string;
  fromEmail: string;
  clientName: string;
  clientPhone: string;
  challenge: string;
  date: string;
  time: string;
}): Promise<void> {
  const { apiKey, fromEmail, clientName, clientPhone, challenge, date, time } = params;
  const toEmail = 'Joshua.saunders575@icloud.com';

  const htmlBody = `
<h2>New Fit Call Booked — ${clientName}</h2>
<table>
  <tr><td><strong>Name:</strong></td><td>${clientName}</td></tr>
  <tr><td><strong>Phone:</strong></td><td>${clientPhone}</td></tr>
  <tr><td><strong>#1 Challenge:</strong></td><td>${challenge}</td></tr>
  <tr><td><strong>Date:</strong></td><td>${date}</td></tr>
  <tr><td><strong>Time:</strong></td><td>${time}</td></tr>
</table>
`.trim();

  const textBody = [
    `New Fit Call Booked — ${clientName}`,
    '',
    `Name: ${clientName}`,
    `Phone: ${clientPhone}`,
    `Challenge: ${challenge}`,
    `Date: ${date}`,
    `Time: ${time}`,
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: `New Fit Call Booked — ${clientName}`,
      html: htmlBody,
      text: textBody,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Resend email failed: ${res.status}: ${errText}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      { headers: corsHeaders, status: 405 },
    );
  }

  // Validate secrets
  const caldavEmail = Deno.env.get('ICLOUD_CALDAV_EMAIL')?.trim();
  const caldavPassword = Deno.env.get('ICLOUD_CALDAV_PASSWORD')?.trim();
  const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL')?.trim();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();

  if (!caldavEmail || !caldavPassword) {
    return new Response(
      JSON.stringify({ error: 'CalDAV credentials are not configured.' }),
      { headers: corsHeaders, status: 500 },
    );
  }
  if (!resendApiKey || !resendFromEmail) {
    return new Response(
      JSON.stringify({ error: 'Resend credentials are not configured.' }),
      { headers: corsHeaders, status: 500 },
    );
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase credentials are not configured.' }),
      { headers: corsHeaders, status: 500 },
    );
  }

  // Parse and validate body
  let body: BookingRequest;
  try {
    body = (await request.json()) as BookingRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { headers: corsHeaders, status: 400 },
    );
  }

  // userId is nullable in the DB — accept valid UUID or treat anything else as null
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validUserId: string | null = body.userId && UUID_RE.test(body.userId) ? body.userId : null;

  const missingFields = (
    ['clientName', 'clientPhone', 'challenge', 'date', 'time'] as const
  ).filter((field) => !body[field]?.trim());

  if (missingFields.length > 0) {
    return new Response(
      JSON.stringify({ error: `Missing required fields: ${missingFields.join(', ')}` }),
      { headers: corsHeaders, status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return new Response(
      JSON.stringify({ error: 'date must be in YYYY-MM-DD format.' }),
      { headers: corsHeaders, status: 400 },
    );
  }
  if (!/^\d{2}:\d{2}$/.test(body.time)) {
    return new Response(
      JSON.stringify({ error: 'time must be in HH:MM format.' }),
      { headers: corsHeaders, status: 400 },
    );
  }

  const uid = crypto.randomUUID();

  // Resolve times: user sends their local time + timezone; we convert to
  // coach time for DB storage, and use user's timezone in the ICS so both
  // calendars show the correct local time.
  const userTz = body.userTimezone ?? COACH_TIMEZONE;
  const coachTime = userTz !== COACH_TIMEZONE
    ? convertToCoachTime(body.time, body.date, userTz)
    : body.time;

  // ---------------------------------------------------------------------------
  // 1. Insert into Supabase
  // ---------------------------------------------------------------------------
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: insertData, error: insertError } = await supabase
    .from('coaching_fit_calls')
    .insert({
      user_id: validUserId,
      client_name: body.clientName,
      client_phone: body.clientPhone,
      challenge: body.challenge,
      session_date: body.date,
      session_time: coachTime, // always store in coach's timezone
      status: 'pending',
      cal_event_uid: uid,
      ...(body.goal       ? { goal: body.goal }             : {}),
      ...(body.dietHabits ? { diet_habits: body.dietHabits } : {}),
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[book-fit-call] Supabase insert error:', insertError);
    return new Response(
      JSON.stringify({ error: `Database insert failed: ${insertError.message}` }),
      { headers: corsHeaders, status: 500 },
    );
  }

  const bookingId = (insertData as { id: string } | null)?.id ?? uid;

  // ---------------------------------------------------------------------------
  // 2. Create VEVENT in iCloud CalDAV
  // ---------------------------------------------------------------------------
  const auth = basicAuth(caldavEmail, caldavPassword);
  const baseUrl = 'https://caldav.icloud.com';

  try {
    console.log('[book-fit-call] Discovering calendar URL...');
    const calendarUrl = await discoverPrimaryCalendarUrl(baseUrl, auth);
    console.log('[book-fit-call] Calendar URL:', calendarUrl);

    // ICS uses coach's timezone so the event appears at the right time on
    // the coach's iCloud calendar regardless of the client's timezone.
    const dtstart = formatIcalDateTime(body.date, coachTime);
    const endTime = addMinutes(coachTime, 15);
    const dtend = formatIcalDateTime(body.date, endTime);
    const nowUtc = new Date();
    const now = formatIcalDateTime(
      nowUtc.toISOString().slice(0, 10),
      nowUtc.toISOString().slice(11, 16),
    );

    const icalData = buildVcalendar({
      uid,
      dtstart,
      dtend,
      timezone: COACH_TIMEZONE,
      summary: `APEX: Fit Call — ${body.clientName}`,
      description: `Phone: ${body.clientPhone}\nChallenge: ${body.challenge}`,
      now,
    });

    const eventUrl = calendarUrl.replace(/\/?$/, '/') + `${uid}.ics`;
    console.log('[book-fit-call] PUT event URL:', eventUrl);
    const putRes = await fetch(eventUrl, {
      method: 'PUT',
      headers: {
        Authorization: auth,
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      },
      body: icalData,
    });

    console.log('[book-fit-call] CalDAV PUT status:', putRes.status);
    if (!putRes.ok && putRes.status !== 201 && putRes.status !== 204) {
      const errText = await putRes.text().catch(() => '');
      console.error('[book-fit-call] CalDAV PUT failed:', putRes.status, errText);
    } else {
      console.log('[book-fit-call] CalDAV event created successfully');
    }
  } catch (err) {
    console.error('[book-fit-call] CalDAV error (non-fatal):', err);
  }

  // ---------------------------------------------------------------------------
  // 3. Send email notification via Resend
  // ---------------------------------------------------------------------------
  try {
    await sendNotificationEmail({
      apiKey: resendApiKey,
      fromEmail: resendFromEmail,
      clientName: body.clientName,
      clientPhone: body.clientPhone,
      challenge: body.challenge,
      date: body.date,
      time: body.time,
    });
  } catch (err) {
    console.error('[book-fit-call] Resend email error (non-fatal):', err);
    // Non-fatal: booking is saved even if email fails
  }

  return new Response(
    JSON.stringify({ ok: true, bookingId }),
    { headers: corsHeaders, status: 200 },
  );
});
