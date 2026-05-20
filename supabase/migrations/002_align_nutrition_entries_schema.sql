do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'protein_grams'
  ) then
    alter table public.nutrition_entries
      add column protein_grams numeric(8,2) not null default 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'carbs_grams'
  ) then
    alter table public.nutrition_entries
      add column carbs_grams numeric(8,2) not null default 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'fat_grams'
  ) then
    alter table public.nutrition_entries
      add column fat_grams numeric(8,2) not null default 0;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'consumed_at'
  ) then
    alter table public.nutrition_entries
      add column consumed_at timestamptz not null default timezone('utc', now());
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'protein'
  ) then
    execute '
      update public.nutrition_entries
      set protein_grams = coalesce(protein_grams, protein, 0)
      where protein_grams = 0
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'carbs'
  ) then
    execute '
      update public.nutrition_entries
      set carbs_grams = coalesce(carbs_grams, carbs, 0)
      where carbs_grams = 0
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nutrition_entries'
      and column_name = 'fat'
  ) then
    execute '
      update public.nutrition_entries
      set fat_grams = coalesce(fat_grams, fat, 0)
      where fat_grams = 0
    ';
  end if;
end
$$;
