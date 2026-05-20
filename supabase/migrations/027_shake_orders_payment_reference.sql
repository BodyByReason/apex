alter table public.shake_orders
  add column if not exists payment_reference text;

create index if not exists shake_orders_payment_reference_idx
  on public.shake_orders (payment_reference);
