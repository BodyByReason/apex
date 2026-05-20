import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const SHAKE_AMOUNT_CENTS = 8449;
const SHAKE_CURRENCY = 'usd';

type CreateShakePaymentIntentBody = {
  email?: string;
  flavor: 'vanilla' | 'chocolate';
  fullName: string;
  phone?: string;
  shippingCity: string;
  shippingCountry?: string;
  shippingLine1: string;
  shippingLine2?: string;
  shippingPostalCode: string;
  shippingState: string;
};

function toStripeBody(input: Record<string, string>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== '') {
      params.append(key, value);
    }
  });
  return params.toString();
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Supabase auth env is not configured.' }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY is not configured.' }), {
      headers: corsHeaders,
      status: 500,
    });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: request.headers.get('Authorization') ?? '',
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Authentication required.' }), {
      headers: corsHeaders,
      status: 401,
    });
  }

  let body: CreateShakePaymentIntentBody;
  try {
    body = (await request.json()) as CreateShakePaymentIntentBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  if (
    !body.fullName?.trim() ||
    !body.flavor ||
    !body.shippingLine1?.trim() ||
    !body.shippingCity?.trim() ||
    !body.shippingState?.trim() ||
    !body.shippingPostalCode?.trim()
  ) {
    return new Response(JSON.stringify({ error: 'Missing required checkout details.' }), {
      headers: corsHeaders,
      status: 400,
    });
  }

  const stripeResponse = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: toStripeBody({
      amount: String(SHAKE_AMOUNT_CENTS),
      currency: SHAKE_CURRENCY,
      'automatic_payment_methods[enabled]': 'true',
      description: `Nutrilite Organics All-in-One Shakes (${body.flavor})`,
      receipt_email: body.email?.trim() || '',
      'metadata[user_id]': user.id,
      'metadata[flavor]': body.flavor,
      'metadata[full_name]': body.fullName.trim(),
      'metadata[shipping_city]': body.shippingCity.trim(),
      'metadata[shipping_line1]': body.shippingLine1.trim(),
      'metadata[shipping_line2]': body.shippingLine2?.trim() || '',
      'metadata[shipping_state]': body.shippingState.trim(),
      'metadata[shipping_postal_code]': body.shippingPostalCode.trim(),
      'metadata[shipping_country]': (body.shippingCountry?.trim() || 'US').toUpperCase(),
    }),
  });

  const stripeData = await stripeResponse.json();
  if (!stripeResponse.ok) {
    return new Response(JSON.stringify({ error: stripeData?.error?.message ?? 'Could not create payment intent.' }), {
      headers: corsHeaders,
      status: stripeResponse.status,
    });
  }

  return new Response(
    JSON.stringify({
      amount: SHAKE_AMOUNT_CENTS,
      clientSecret: stripeData.client_secret,
      currency: SHAKE_CURRENCY,
      paymentIntentId: stripeData.id,
    }),
    {
      headers: corsHeaders,
      status: 200,
    },
  );
});
