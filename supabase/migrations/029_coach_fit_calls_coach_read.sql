-- Allow the coach (any user with is_coach = true in profiles) to read ALL fit call
-- bookings. The existing policy only lets each user see their own row, making Sharon's
-- (and every other client's) booking invisible to Josh in CoachModeScreen.

CREATE POLICY "Coach can read all fit calls"
  ON coaching_fit_calls FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND is_coach = true
    )
  );
