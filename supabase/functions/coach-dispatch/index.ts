const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

type DispatchBody = {
  body: string;
  coachEmail?: string | null;
  coachPhone?: string | null;
  emailBody?: string | null;
  smsBody?: string | null;
  title: string;
};

async function sendEmail(input: { coachEmail: string; body: string; title: string }) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL');
  if (!resendApiKey || !resendFromEmail) {
    return { delivered: false, reason: 'Resend not configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFromEmail,
      to: [input.coachEmail],
      subject: input.title,
      text: input.body,
    }),
  });

  if (!response.ok) {
    return { delivered: false, reason: await response.text() };
  }

  return { delivered: true };
}

async function sendSms(input: { coachPhone: string; body: string }) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromPhone = Deno.env.get('TWILIO_FROM_PHONE');
  if (!accountSid || !authToken || !fromPhone) {
    return { delivered: false, reason: 'Twilio not configured' };
  }

  const credentials = btoa(`${accountSid}:${authToken}`);
  const payload = new URLSearchParams({
    Body: input.body,
    From: fromPhone,
    To: input.coachPhone,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  if (!response.ok) {
    return { delivered: false, reason: await response.text() };
  }

  return { delivered: true };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      headers: corsHeaders,
      status: 405,
    });
  }

  let body: DispatchBody;
  try {
    body = (await request.json()) as DispatchBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  if (!body.title?.trim() || !body.body?.trim()) {
    return new Response(JSON.stringify({ error: 'title and body are required.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const coachEmail = body.coachEmail?.trim() || Deno.env.get('COACH_ALERT_EMAIL') || '';
  const coachPhone = body.coachPhone?.trim() || Deno.env.get('COACH_ALERT_PHONE') || '';

  const [email, sms] = await Promise.all([
    coachEmail
      ? sendEmail({ coachEmail, body: body.emailBody?.trim() || body.body.trim(), title: body.title.trim() })
      : Promise.resolve({ delivered: false, reason: 'No coach email provided' }),
    coachPhone
      ? sendSms({ coachPhone, body: body.smsBody?.trim() || body.body.trim() })
      : Promise.resolve({ delivered: false, reason: 'No coach phone provided' }),
  ]);

  return new Response(JSON.stringify({ email, sms, ok: email.delivered || sms.delivered }), {
    headers: corsHeaders,
    status: 200,
  });
});
