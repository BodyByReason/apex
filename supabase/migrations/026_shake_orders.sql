create table if not exists public.shake_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  coach_user_id uuid references auth.users (id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  flavor text not null check (flavor in ('vanilla', 'chocolate')),
  amount_total numeric(10, 2) not null default 84.49,
  currency text not null default 'USD',
  shipping_line1 text not null,
  shipping_line2 text,
  shipping_city text not null,
  shipping_state text not null,
  shipping_postal_code text not null,
  shipping_country text not null default 'US',
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded', 'cancelled')),
  fulfillment_status text not null default 'pending' check (fulfillment_status in ('pending', 'ordered', 'shipped', 'completed', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists shake_orders_user_id_idx
  on public.shake_orders (user_id);

create index if not exists shake_orders_created_at_idx
  on public.shake_orders (created_at desc);

create index if not exists shake_orders_fulfillment_status_idx
  on public.shake_orders (fulfillment_status);

drop trigger if exists set_shake_orders_updated_at on public.shake_orders;
create trigger set_shake_orders_updated_at
before update on public.shake_orders
for each row execute procedure public.set_updated_at();

alter table public.shake_orders enable row level security;

drop policy if exists "Users can read own shake orders" on public.shake_orders;
create policy "Users can read own shake orders"
  on public.shake_orders for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own shake orders" on public.shake_orders;
create policy "Users can insert own shake orders"
  on public.shake_orders for insert
  with check (auth.uid() = user_id);

drop policy if exists "Coach can read shake orders" on public.shake_orders;
create policy "Coach can read shake orders"
  on public.shake_orders for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.is_coach, false) = true
    )
  );

drop policy if exists "Coach can update shake orders" on public.shake_orders;
create policy "Coach can update shake orders"
  on public.shake_orders for update
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.is_coach, false) = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and coalesce(p.is_coach, false) = true
    )
  );
