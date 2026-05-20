import { supabase } from '@/lib/supabase';

export const SHAKE_DELIVERED_PRICE = 84.49;
export const SHAKE_CURRENCY = 'USD';

export type ShakeFlavor = 'vanilla' | 'chocolate';
export type ShakeOrderPaymentStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';
export type ShakeOrderFulfillmentStatus = 'pending' | 'ordered' | 'shipped' | 'completed' | 'cancelled';

export type ShakeOrder = {
  amountTotal: number;
  coachUserId: string | null;
  createdAt: string;
  currency: string;
  email: string | null;
  flavor: ShakeFlavor;
  fullName: string;
  fulfillmentStatus: ShakeOrderFulfillmentStatus;
  id: string;
  paymentStatus: ShakeOrderPaymentStatus;
  paymentReference: string | null;
  phone: string | null;
  shippingCity: string;
  shippingCountry: string;
  shippingLine1: string;
  shippingLine2: string | null;
  shippingPostalCode: string;
  shippingState: string;
  userId: string;
};

function mapOrder(row: any): ShakeOrder {
  return {
    amountTotal: Number(row.amount_total ?? SHAKE_DELIVERED_PRICE),
    coachUserId: row.coach_user_id ?? null,
    createdAt: row.created_at,
    currency: row.currency ?? SHAKE_CURRENCY,
    email: row.email ?? null,
    flavor: row.flavor,
    fullName: row.full_name,
    fulfillmentStatus: row.fulfillment_status,
    id: row.id,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference ?? null,
    phone: row.phone ?? null,
    shippingCity: row.shipping_city,
    shippingCountry: row.shipping_country,
    shippingLine1: row.shipping_line1,
    shippingLine2: row.shipping_line2 ?? null,
    shippingPostalCode: row.shipping_postal_code,
    shippingState: row.shipping_state,
    userId: row.user_id,
  };
}

export async function createShakeOrder(input: {
  coachUserId?: string | null;
  email?: string | null;
  flavor: ShakeFlavor;
  fullName: string;
  paymentReference?: string | null;
  paymentStatus?: ShakeOrderPaymentStatus;
  phone?: string | null;
  shippingCity: string;
  shippingCountry?: string;
  shippingLine1: string;
  shippingLine2?: string | null;
  shippingPostalCode: string;
  shippingState: string;
  userId: string;
}) {
  const { data, error } = await supabase
    .from('shake_orders')
    .insert({
      amount_total: SHAKE_DELIVERED_PRICE,
      coach_user_id: input.coachUserId ?? null,
      currency: SHAKE_CURRENCY,
      email: input.email?.trim() || null,
      flavor: input.flavor,
      full_name: input.fullName.trim(),
      payment_reference: input.paymentReference?.trim() || null,
      payment_status: input.paymentStatus ?? 'pending',
      phone: input.phone?.trim() || null,
      shipping_city: input.shippingCity.trim(),
      shipping_country: (input.shippingCountry?.trim() || 'US').toUpperCase(),
      shipping_line1: input.shippingLine1.trim(),
      shipping_line2: input.shippingLine2?.trim() || null,
      shipping_postal_code: input.shippingPostalCode.trim(),
      shipping_state: input.shippingState.trim(),
      user_id: input.userId,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapOrder(data);
}

export async function getCoachShakeOrders(): Promise<ShakeOrder[]> {
  const { data, error } = await supabase
    .from('shake_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapOrder);
}

export async function updateShakeOrderFulfillmentStatus(
  orderId: string,
  fulfillmentStatus: ShakeOrderFulfillmentStatus,
) {
  const { data, error } = await supabase
    .from('shake_orders')
    .update({ fulfillment_status: fulfillmentStatus })
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapOrder(data);
}
