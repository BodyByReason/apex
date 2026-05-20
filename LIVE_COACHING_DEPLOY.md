# Live Coaching Deploy

## Done from Codex

- Hosted Supabase migration pushed:
  - `019_live_coaching.sql`
- Hosted Edge Function deployed:
  - `zoom-session`
- Hosted Zoom meeting creation verified with a real meeting
- Repo updated to persist purchased live sessions into `public.live_coaching_sessions`
- Oracle APEX package scripts added:
  - `apex/plsql/zoom_pkg.sql`
  - `apex/plsql/live_coaching_pkg.sql`
- App-side booking flow updated to pass an explicit Zoom host user

## Still required

### 1. Confirm Zoom / Supabase secrets

Required hosted project secrets:

- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_HOST_USER_ID`
- Optional: `ZOOM_JOIN_URL`

Example:

```bash
cd /Users/joshuasaunders/Documents/apex
source .env >/dev/null 2>&1
npx supabase@latest secrets set \
  ZOOM_ACCOUNT_ID=... \
  ZOOM_CLIENT_ID=... \
  ZOOM_CLIENT_SECRET=... \
  ZOOM_HOST_USER_ID=... \
  --project-ref "$SUPABASE_PROJECT_REF"
```

Recommended app env:

- `EXPO_PUBLIC_ZOOM_HOST_USER_ID=joshua.saunders575@icloud.com`

### 2. Install Oracle APEX packages

Run:

- `apex/plsql/zoom_pkg.sql`
- `apex/plsql/live_coaching_pkg.sql`

Create APEX application settings:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_S2S_ACCOUNT_ID` if using Server-to-Server OAuth

Note:

- Codex cannot install these two PL/SQL packages without direct access to your Oracle APEX workspace or database session.
- As soon as they are run in the Oracle environment, the APEX page processes below can call them immediately.

### 3. Hook up APEX pages

On both `Coach Access` and `Live Coach` create:

- `P_CLIENT_USER_ID`
- `P_CLIENT_DISPLAY_NAME`
- `P_SESSION_ID`
- `P_SHOW_CELEBRATION`
- `P_ACTIVE_TAB`

On `Live Coach` also create:

- `P_NEXT_DATE`
- `P_NEXT_TIME`
- `P_CURRENT_EXERCISE_NAME`

Add submit processes for:

- `START_LIVE`
- `END_SESSION`
- `SCHEDULE_NEXT_WEEK`
- `SCHEDULE_CUSTOM`
- `DISMISS_CELEBRATION`

Add branch after each submit back to the `Live Coaching` tab.

Important UI note:

- The current implementation creates and launches real Zoom meetings.
- Native in-page video mute/camera controls inside your custom APEX UI would require Zoom Meeting SDK or Video SDK work beyond this REST-based implementation.

## Smoke test

### Mobile / Supabase

1. Book a live coaching package in the app.
2. Confirm rows are inserted into:
   - `coach_client_links`
   - `live_coaching_sessions`
3. Confirm each session row has:
   - `zoom_meeting_id`
   - `zoom_join_url`
   - `zoom_start_url`
4. In Coach Mode, press `LIVE` and confirm the coach launch link opens.
5. Confirm the new meeting is owned by the configured Zoom host user.

### Session completion

1. Call RPC `complete_live_coaching_session`.
2. Confirm:
   - session `status = 'completed'`
   - `duration_minutes` populated
   - `coach_client_links.live_coaching_count` incremented
   - `coach_client_links.last_live_session_at` updated
   - `user_achievements` gets `live_1`, `live_5`, `live_10`, `live_25` only once

## Notes

- The `zoom-session` function now uses the correct Server-to-Server host flow: `/users/{hostUserId}/meetings`.
- A real Zoom meeting was successfully created during verification.
- The Oracle APEX package install and page wiring still must be done in the APEX environment manually unless you provide direct APEX workspace or DB access.
