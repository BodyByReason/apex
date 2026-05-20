CREATE TABLE IF NOT EXISTS coaching_fit_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  challenge TEXT,
  session_date DATE NOT NULL,
  session_time TIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | cancelled | completed
  cal_event_uid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coaching_fit_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fit call bookings"
  ON coaching_fit_calls FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fit call bookings"
  ON coaching_fit_calls FOR INSERT
  WITH CHECK (auth.uid() = user_id);
