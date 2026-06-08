-- Competitor ad swipe file.
-- Raw ads scraped from the Meta Ad Library for the reference advertisers we
-- model (Justin Saunders, Dr. Matt Shiver, John Whiting). Feeds creative
-- modeling for BMR paid + organic. Extends the Phase 14 Market Intelligence
-- engine (competitor_profiles, market_hooks) with the underlying ad records
-- and their performance/scaling signals.

CREATE TABLE IF NOT EXISTS competitor_ads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid REFERENCES competitor_profiles(id) ON DELETE SET NULL,
  ad_archive_id text UNIQUE,                 -- Meta Ad Library ID (dedupe key)
  advertiser text NOT NULL,                  -- normalized name we track
  page_name text,                            -- name as shown in the library
  page_id text,

  -- creative
  platforms text[],                          -- facebook, instagram, messenger, ...
  ad_format text,                            -- image | video | carousel | dco
  cta_text text,
  cta_type text,
  headline text,
  primary_text text,                         -- ad copy / body
  link_url text,
  funnel_destination text,                   -- chatbot | messenger | optin | call | website | unknown

  -- performance / scaling signals
  first_seen date,
  last_seen date,
  days_active integer,                       -- longevity = winner signal
  is_active boolean NOT NULL DEFAULT true,
  variation_count integer NOT NULL DEFAULT 1, -- # creative variants = scaling signal

  -- analysis (filled by us / AI)
  hook text,
  angle text,
  emotional_trigger text,
  comment_trigger text,                      -- e.g. "Drop ADS below"
  dm_trigger text,
  estimated_performance_score integer
    CHECK (estimated_performance_score IS NULL
           OR estimated_performance_score BETWEEN 0 AND 100),
  notes text,

  raw jsonb,                                 -- full scraped record
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_ads_advertiser ON competitor_ads(advertiser);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_active ON competitor_ads(is_active);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_days_active ON competitor_ads(days_active DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_ads_profile ON competitor_ads(profile_id);

ALTER TABLE competitor_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON competitor_ads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
