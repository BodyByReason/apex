# APEX — Complete Feature Inventory

**Purpose:** Full pre-audit map of every screen, flow, feature, state, trigger, dependency, and hidden interaction across **WW Free**, **WW Upgrade**, and **Apex**.
**Discovery scope:** 37 screens, 23 components, 5 navigators, 30+ Supabase tables, 15+ edge functions, 16 achievements, 4 AI models, 3 tiers.
**Confidence labels:** `Confirmed` (read in code), `Likely` (referenced/stubbed/wired but not fully verified end-to-end), `Implied` (mentioned in notes or strongly suggested by adjacent flow but no implementation found).
**This is inventory only. Not prioritization. Not a remediation plan.**

---

## 0. Architectural Frame (read me first)

**Three product editions, two physical navigator stacks.**

| Stage | Navigator stack | Tabs | Trigger to enter | Trigger to leave |
|---|---|---|---|---|
| **WW Free** | `WalkWaterNavigator` → `BaseWWNavigator` | 5 (Home, Walk, Water, Community, Coach) | `isWalkWaterModeEnabled() === true` AND `isWWUpgraded() === false` | Quiz complete + `purchaseChallengeFinisher` success → `WALK_WATER_UPGRADE_EVENT` |
| **WW Upgrade** | `WalkWaterNavigator` → `ApexWWNavigator` | 6 (Home, Walk, Train, Fuel, Community, Coach) | `WALK_WATER_UPGRADE_EVENT` swap (in place — Water tab replaced by Train + Fuel) | Admin toggle off; or hard switch to MainNavigator |
| **Apex** | `MainNavigator` → `MainTabNavigator` | 6 (Dashboard, Train, Fuel, Tribe, Coach, Plans) | Default for any signed-in user when `walkWaterMode === false` | Admin Walk-Water toggle on |

**Critical:** WW Upgrade and Apex are **two parallel implementations of similar features** (Train, Fuel, Community/Tribe, Coach). They are not the same code paths. This is the single biggest source of duplication risk in the codebase (see §3).

**Auth gating cascade (App.tsx → RootNavigator):**
1. `initializing || (session && !profileBootstrapped)` → BootSplash
2. `passwordResetMode` → ResetPasswordScreen (replaces nav tree)
3. `session && !profileReady && !walkWaterMode` → GoalSetupScreen (blocks app)
4. `session && walkWaterMode` → WalkWaterNavigator
5. `session && !walkWaterMode` → MainNavigator
6. `!session` → AuthNavigator
7. Always overlaid: `AchievementCelebration`

**Persona gates:**
- `profile.isCoach === true` → public coach badge in Tribe + bio surfacing.
- `isAdminEnabled() === true` (9 taps on logo OR coach password) → unlocks `CoachModeScreen` + Pro preview + dev tools.
- `hasProEntitlement()` (RevenueCat) → unlocks Pro features.
- `isProTrialActive()` (3-day trial window from GoalSetup) → suppresses paywall during trial.

---

# Part 1 — Full Feature Inventory

## 1A. Cross-cutting features (apply to all three stages)

These are not stage-specific but appear in every stage with state differences. Listed once here to avoid triplicating below.

### Authentication

| Feature | Type | File | Purpose | Trigger | User action | System response | Data | Monetization | Coach | Edge cases | Conf. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Email signup | Confirmed | `SignUpScreen.tsx` | Create account | "Create account" CTA | Email + password | `supabase.auth.signUp` | `auth.users` + `profiles` | Trial window starts in GoalSetup | n/a | Email already in use; weak password; verification email; no offline | Confirmed |
| Email login | Confirmed | `LoginScreen.tsx` | Auth existing user | "Sign in" CTA | Email + password | `supabase.auth.signInWithPassword` | `auth.users` | Restores entitlements | Coach unlock by password later | Wrong password; rate limited; locked account | Confirmed |
| Forgot password | Confirmed | `LoginScreen.tsx` link → email link → `ResetPasswordScreen.tsx` | Reset auth | "Forgot password" tap | Email entry + new password from deep link | Supabase magic link → `passwordResetMode` flag | n/a | n/a | n/a | Deep link broken; wrong email; expired link | Confirmed |
| Email verification banner | Confirmed | `VerifyEmailBanner.tsx` | Push user to verify | `!isEmailVerified` | Tap "Resend" | Resends OTP | `auth.users` | n/a | n/a | Already verified after refresh; banner stuck; resend rate limit | Confirmed |
| Sign-in via OAuth (Apple / Google) | Implied | not found | Frictionless social auth | n/a | n/a | n/a | n/a | n/a | n/a | App store rejection if Sign in with Apple missing on iOS — risk | Implied |
| Magic-link / passwordless | Implied | not found | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Implied |
| Account deletion | Confirmed | `ProfileScreen` Danger Zone → edge fn `delete-account` | GDPR | Tap "Delete account" | Confirm + reason multi-select | Cascades through auth.users + user data | All user tables | n/a | Cuts coach link if any | Failed cascade leaves orphans; reason text not stored anywhere visible to coach | Confirmed |

### Profile / Identity / Settings

| Feature | File / location | Confidence |
|---|---|---|
| Display name + username + avatar | `ProfileScreen.tsx`, synced via `profileSync.ts` | Confirmed |
| Theme selector (7 accents: green / blue / purple / red / orange / rose / pink + gold variant) | `ThemeContext.tsx`, persisted at `apex.theme` | Confirmed |
| Language selector (en, es) | `LanguageContext.tsx`, i18next, key `LANGUAGE_STORAGE_KEY` | Confirmed |
| Goal selector (Lose / Build / Recomp / Performance) | GoalSetup + ProfileScreen | Confirmed |
| Reason-why multi-select (10 presets + freetext) | GoalSetup step 2 + Profile editor | Confirmed |
| Body stats (weight, height, age, goal weight) | GoalSetup step 3 + Profile | Confirmed |
| Daily rhythm (wake, sleep, workout window, workout time, meals/day, weigh frequency) | GoalSetup step 4 + Profile | Confirmed |
| Health conditions (7 categories, 30+ items: metabolic, cardiovascular, hormonal, digestive, renal, musculoskeletal, other) | GoalSetup step 5 + Profile | Confirmed |
| Medications, surgeries, GLP-1 status | Profile | Confirmed |
| Equipment available (multi-select) | Profile | Confirmed |
| Food preferences (10 checkboxes) + avoidances (freetext) | Profile | Confirmed |
| Activity level (sedentary → very active) | Profile | Confirmed |
| Privacy settings (who can DM / friend-request: everyone / friends / nobody) | Profile | Confirmed |
| ZIP code (for grocery pricing) | Profile | Confirmed |
| Notification toggles (morning, midday, evening, weekly tip) | Profile | Confirmed |
| Macro targets (auto-computed: BMR + TDEE + goal-specific deficit) | `getOrComputeMacroTargets(profile)` | Confirmed |
| Pro trial (3-day window auto-created at GoalSetup completion) | `proTrial.ts` keys `proTrialStartedAt` / `proTrialEndsAt` | Confirmed |
| Coach voice selection (Marcus, Serena, custom personas) | `coachVoice.ts` + Profile | Confirmed |
| Coach access password unlock | Profile → `verifyCoachAccessPassword()` → sets `profile.isCoach` | Confirmed |
| Coach bio editor + Claude auto-generation | Profile | Confirmed |
| Coach title selector (Strength / Performance / Personal Trainer / Nutrition / Recovery) | Profile → `profiles.selected_title` | Confirmed |
| Calendar integration UI (Google Calendar API key + ID + Sync) | Profile section | **Likely** — UI exists, backend integration unclear |
| Wearables waitlist (WHOOP, Garmin "Notify me") | Profile section | **Likely** — UI only, no real integration |
| Progress photos (front, side, rear) | Profile + Supabase storage | Confirmed |
| Goal preview AI image | edge fn `goal-preview` | Likely — generation path exists; uncertain if image truly renders |
| Achievements grid + share to Tribe / social | Profile + `AchievementShareCard.tsx` | Confirmed |
| Titles (gamification labels) | Profile → `selected_title` | Confirmed |
| Admin tools (toggle admin mode, Pro preview, coach unlock, feature waitlist inspect) | Profile (gated by 9-tap unlock) | Confirmed |
| Danger zone: delete account + reason capture | Profile | Confirmed |

### Theme, language, accessibility

- 7 themes with `accent`, `accentSoft 5%`, `accentBorder 15%`, `accentStrongBorder 22%`. **Confirmed.**
- 2 languages (en, es) via i18next. **Confirmed.**
- **Implied missing:** `AccessibilityLabel` on interactive components, font scaling, reduce-motion respect, high-contrast variant. Several screens use animated gradients and continuous pulses (e.g., onboarding spotlight) without a reduce-motion path.

### Gamification

| Feature | File | Confidence |
|---|---|---|
| XP system (per-action awards) | `GamificationContext.tsx` + `apex.gamification.xp` AsyncStorage | Confirmed |
| Levels (`floor(xp/100)+1`) | derived | Confirmed |
| 16 achievements across walking, workouts, nutrition, levels, academy | `achievements.ts` | Confirmed |
| Streak tracking | per-feature (workouts, nutrition, WW challenge) | Confirmed |
| `AchievementCelebration` modal (always-mounted overlay) | `App.tsx` + component | Confirmed |
| `ConfettiCelebration` (emoji burst) | component | Confirmed |
| App-rating prompt at XP milestones (300, 1000, 3000) | `useAppRating` hook | Confirmed |
| Cloud-sync of XP | not found | **Implied missing** — XP is local-only; reinstall wipes it |

### Push notifications

| Type | Schedule | Channel | Confidence |
|---|---|---|---|
| Morning motivation | 7:00 AM (clamped 6–10 AM, adaptive to wake time) | `apex-coach` HIGH | Confirmed |
| Midday check-in | 12:30 PM (adaptive to workout window + meal frequency) | `apex-coach` HIGH | Confirmed |
| Evening reminder | 19:00 (clamped 5–9 PM, sleep − 2h) | `apex-coach` HIGH | Confirmed |
| Weekly tip | Monday 09:00 | `apex-coach` HIGH | Confirmed |
| Coach message (immediate, foreground only via local notif) | trigger | `apex-coach-messages` MAX | Confirmed |
| Coach business event (booking, session completed, churn risk) | event-driven | via `coach_notification_events` table | Confirmed |
| Coach session reminder (~30 min before session) | scheduled | local | Confirmed |
| Coach check-in reminder | scheduled per coach | local | Confirmed |
| Pro-trial expiry reminder | n/a | not found | **Implied missing** |
| Streak-loss / "you missed a day" push | n/a | not found | **Implied missing** |
| Challenge re-engagement ("Don't Stop Now") push | n/a | not found | **Implied missing** — note explicitly mentions this banner |
| Variety: 7 messages per goal × 4 goals × 3 times/day; modulo recycle weekly | confirmed | n/a | Confirmed (with recycle issue — same content reappears every 7 days) |

### Realtime channels

| Channel | Streams | Conf. |
|---|---|---|
| `tribe-feed-realtime` (postgres_changes) | Posts, comments, reactions | Confirmed |
| Tribe live LiveKit room | Audio/video + participants | Confirmed |
| Coach DM channel | `coach_messages` inserts | Confirmed (via foreground listener) |
| `WALK_WATER_MODE_EVENT` (DeviceEventEmitter) | Admin toggle | Confirmed |
| `WALK_WATER_UPGRADE_EVENT` | Tab swap on purchase | Confirmed |
| `apex.walkWaterQuizDone` event | Quiz completion broadcast | Confirmed |

### Error / empty / loading / permission states

| State | Implementation | Conf. |
|---|---|---|
| BootSplash on app start | `App.tsx` `BootSplash()` | Confirmed |
| `SkeletonCard.tsx` skeleton primitive | exists as component | Confirmed |
| Per-screen skeletons (Tribe feed, leaderboard, coach calendar) | not implemented | **Implied missing** |
| ActivityIndicator fallback (RN native spinner) | scattered | Confirmed |
| React Error Boundary wrapper | not found | **Implied missing — high risk** |
| Sentry capture (production only, 10% trace sample, PII redacted) | `lib/sentry.ts` | Confirmed |
| PostHog analytics events catalogue | `lib/analytics.ts` | Confirmed |
| Permission: camera | `expo-camera` ask in FormReview, FoodScan, GoLiveTribe | Confirmed |
| Permission: microphone | TribeScreen voice memo + TrainScreen realtime coach | Confirmed |
| Permission: photo library | Tribe media + WeightLog + FoodScan | Confirmed |
| Permission: push notifications | App boot via `registerForPushNotificationsAsync` | Confirmed |
| Permission: HealthKit / Google Fit | implicit references; not strictly gated | **Likely partial** |
| Permission: location | not gated (steps via HealthKit, no GPS) | n/a |
| Permission: contacts (for invites) | not found | **Implied missing** |
| Permission: calendar (for syncing schedule) | UI mentions but request flow not found | **Likely partial** |

### Logging / telemetry

| Event family | Examples | File |
|---|---|---|
| Onboarding | `onboarding_started`, `onboarding_completed`, `sign_up_completed` | `analytics.ts` |
| Workouts | `workout_started`, `workout_completed`, `exercise_logged`, `pr_set` | same |
| Nutrition | `food_logged`, `water_logged` | same |
| Coach | `coach_message_sent`, `coach_quick_chip_used` | same |
| Community | `post_created`, `challenge_joined` | same |
| Subscriptions | `paywall_viewed`, `subscription_started`, `subscription_cancelled` | same |
| Identity | `identify`, `reset` | same |

---

## 1B. WW Free (BaseWWNavigator — 5 tabs)

**Persona:** Anonymous quiz-taker → first-time signup → 3/7/14/21-day challenge participant.
**Pricing:** Free quiz; paywall before plan starts ($4.99/wk or $14.99/mo). Challenge finisher upsell ($7.99) at completion.
**Tabs:** Home / Walk / Water / Community / Coach.

### B1. Onboarding (WW Free)

| Feature | Confidence | Trigger | Action | System | Data | Edge cases |
|---|---|---|---|---|---|---|
| Pre-auth quiz reachable without signup | Confirmed | App fresh-launch + `walkWaterMode === true` + no plan | Tap into quiz | Routes to `WalkWaterQuizScreen` | local AsyncStorage | None — works headless |
| Quiz brand intro / hook copy | Confirmed | First quiz screen | n/a | Renders headline | n/a | Copy may need ratings + counters for trust |
| Account creation deferred until step 8 | Confirmed | After plan reveal | Email + password | `supabase.auth.signUp` | profiles + AsyncStorage | If signup fails mid-flow, plan answers are kept locally — good UX |
| First-launch onboarding tutorial overlay (5-step spotlight) | Confirmed (but Apex-side) | First MainNavigator render only | Tap Next | Animates spotlight | `apex_onboarding_done_v3` | **Implied missing for WW**: WW does not show this same onboarding tour for the WW tabs, only for Apex tabs |

### B2. Quiz (WW Free) — `WalkWaterQuizScreen.tsx`, 8 steps

| Step | Question | Options | Branching | Conf. |
|---|---|---|---|---|
| 1 Steps | Daily step baseline | <2k / 2-5k / 5-8k / 8k+ | none | Confirmed |
| 2 Water | Daily water | <4 / 4-6 / 6-8 / 8+ glasses | none | Confirmed |
| 3 Goal | Primary goal | Lean / Energy / Confidence / Feel better | none | Confirmed |
| 4 Gender | Demographic | Woman / Man / Prefer not to say | **Skipped if `hasCompletedChallenge === true`** (returning upgraded user) | Confirmed |
| 5 Time | Best walk time | Morning / Lunch / Afternoon / Evening | none | Confirmed |
| 6 Days | Challenge duration | 3 / 7 / 14 / 21 | **7/14/21 locked unless `hasCompletedChallenge === true`** | Confirmed |
| 7 Plan | Personalized reveal | step goal + water goal + days | computed from prior answers | Confirmed |
| 8 Auth | Email/password | name (signup only) | login or signup | Confirmed |

**Note from product brief:** "Create new quiz for upgraded users with unlocked duration times and no gender" → **Confirmed implemented** as conditional logic at lines ~146 and ~341 of WalkWaterQuizScreen. Returning challenge-completers automatically skip gender + see all durations unlocked.

### B3. Paywall / purchase (WW Free)

| Surface | What it does | RevenueCat link | Conf. |
|---|---|---|---|
| In-quiz paywall card (step 7→8 transition) | Toggle weekly $4.99 vs monthly $14.99 (-70%); "Free trial included. Cancel anytime." features list (AI coach, dashboard, reminders, leaderboard, weekly goals); CTA = `purchasePackageByType(selectedPlan)` | offering `default` | Confirmed |
| Test-purchase failure path | "This offer is temporarily unavailable…" copy currently appears in `purchaseChallengeFinisher()` (challenge_finisher path), and product notes say to fix it for the WW path too | RevenueCat hard dependency | **Likely** — confirmed message string in challenge-finisher path; WW-quiz paywall handling not separately verified |
| Sandbox / Expo Go fallback | Returns `{ success: false }` silently; does not show paywall | n/a | Confirmed |
| Cancellation handling (`e?.userCancelled`) | Returns `{ success: false }` no error | n/a | Confirmed |
| Restore purchases | Implied via RevenueCat default UI; not explicitly surfaced | n/a | **Likely** |

### B4. Messaging / DM (WW Free) — `WalkWaterCoachScreen.tsx` + `CoachDMScreen.tsx`

| Feature | Conf. |
|---|---|
| WW-specific AI coach chat (steps + hydration + consistency + energy system prompt) | Confirmed |
| "DM Coach Josh" CTA in WW Coach tab → opens CoachDMScreen with `brand: 'ww'` param | Confirmed |
| 11-stage AI DM state machine: greeting → awaiting_diet → social_proof → awaiting_challenge → day_selection → time_selection → phone_collection → booked → awaiting_resources → reschedule_slot_selection → rescheduled | Confirmed |
| Typing-delay constants (1800ms / 2800ms / 1200ms image) for natural pacing | Confirmed |
| Maria 15-second testimonial video asset | Confirmed |
| Rose & Josh transformation images | Confirmed |
| StrongHER Fuel + Strength PDF resource delivery | Confirmed |
| AsyncStorage persistence (`@apex.coach_dm.v1`) + `resetDMFlowForTesting()` helper | Confirmed |
| Morning reminder + silence follow-up scheduling | Confirmed |
| Real coach inbox reply (CoachInboxScreen) wired to `coach_messages` table | Confirmed |
| **"Point At It" feature** — note explicitly mentions font/size needs to match DM Coach font/size | **Implied — NOT FOUND in codebase.** Either not built or named something else. Flag for confirmation. |
| Voice notes / audio messages in DM | not found in WW DM | **Implied missing** |
| Image attachments from user side | Implied via DM message kind === 'image' but user-input path not clear | **Likely partial** |

### B5. Challenge flow (WW Free)

| Feature | File | Conf. |
|---|---|---|
| Daily plan: step goal + water goal + day count | `getWalkWaterPlan()` AsyncStorage | Confirmed |
| Streak counter | `getWalkWaterStreak()` | Confirmed |
| Daily step display (HealthKit / Google Fit) | WalkTrackerScreen + Home tab | Likely partial — no explicit health permission flow surfaced |
| Daily water log (`apex.ww.water.{iso-date}`) | `WaterLogScreen.tsx` | Confirmed |
| Group workout day-3 finale (livestream OR on-demand video) | `WalkWaterFinaleScreen.tsx` with `devPhase` param ('pre' / 'live' / 'post') | Confirmed |
| `apex.ww.groupWorkoutDone` daily reset flag | Confirmed |
| ChallengeCompleteScreen (post `streak >= challengeDays`) | Confirmed |
| 48-hour challenge-finisher offer countdown (`apex.ww.challengeOfferExpiry`) | Confirmed |
| **24-hour countdown banner** (note mentions 24h timer inside "You Finished") | **Implied — NOT FOUND** |
| **"You Finished" persistent banner at top** (note mentions it should be authentic) | **Implied — NOT FOUND** as a discrete persistent banner |
| **"Don't Stop Now" banner** (3-day post-completion if no purchase) | **Implied — NOT FOUND** |
| **"3 Day Post Missed It" banner** (re-engagement after missed days) | **Implied — NOT FOUND** |
| Missed-day flow: did the user break their streak? grace day? restart? | not found | **Implied missing** — challenge state machine has no explicit "missed" branch |
| Daily reset / midnight rollover logic | Implied via per-day storage keys | **Likely** but not explicitly tested |

### B6. Banners and timers (WW Free)

| Banner / Timer | Trigger | Confidence |
|---|---|---|
| `VerifyEmailBanner` — top of screen if email unverified | post-signup | Confirmed |
| `TribeLiveBanner` — coach goes live in tribe | realtime sub | Confirmed |
| `ActiveWorkoutPanel` — floating panel during active workout | workout in progress | Confirmed |
| In-app notification banners (`lib/inAppNotifications.ts`) | various app events | Confirmed |
| 48h challenge-finisher countdown | streak completion | Confirmed |
| 24h secondary countdown | per product note | **Implied missing** |
| Don't Stop Now banner | post 48h offer expiry | **Implied missing** |
| 3 Day Post Missed It banner | missed challenge day(s) | **Implied missing** |
| Mid-challenge banners (e.g., "halfway there" / "final stretch") | streak/days remaining | **Implied — likely missing** |

### B7. Leaderboard (WW Free)

| Feature | File | Conf. | Trust |
|---|---|---|---|
| Today's WW leaderboard (8 entries: 7 seed + user) | `WalkWaterCommunityScreen.tsx` `LEADERBOARD_SEED` | Confirmed | **🔴 Hardcoded fake names: Maria G., James T., Aisha K., Chris R., Priya S., et al.** |
| Score formula: `steps + water*500 + streak*200` | Confirmed | n/a |
| Rank badges 🥇🥈🥉 | Confirmed | n/a |
| Self entry highlighted ("You" with ⭐ initials) | Confirmed | n/a |
| Real-data leaderboard (Supabase-backed, real users) | not found in WW | **Implied — note: "Make Leaderboard authentic"** |
| Filtering (today / week / all-time) | not found in WW | **Implied missing** |
| Friends-only leaderboard | not found | **Implied missing** |

### B8. Group chat / community (WW Free) — `WalkWaterCommunityScreen.tsx`

| Feature | Conf. | Trust |
|---|---|---|
| Community chat thread persisted at `apex.ww.community.chat` | Confirmed | n/a |
| **Seeded chat messages from Maria G., Aisha K., Chris R., James T., Priya S.** | Confirmed | **🔴 Mocked content shown as real members** |
| User can post in community thread | Confirmed | n/a |
| Members count badge ("`LEADERBOARD_SEED.length + 1` members") | Confirmed | **🔴 Member count is fake** |
| Reactions / likes on community messages | not found | Implied missing |
| Comments / threading | not found | Implied missing |
| Image / video attach in community | Implied — not verified |
| Reporting / blocking | not found | Implied missing |
| Link to external Facebook group | Likely — referenced in product notes | Likely |

### B9. Coach tools (WW Free — viewing user side, not coach side)

| Feature | Conf. |
|---|---|
| WW Coach tab shows AI Coach chat tailored to walk/water habits | Confirmed |
| "Work with Coach Josh" testimonial card with Maria video | Confirmed |
| "DM Coach Josh" CTA → CoachDMScreen | Confirmed |
| Hidden dev tools (admin-only): visible after 9 taps unlock; includes `fakeStart` date manipulation for challenge testing | Confirmed |
| Notification-cadence / reminder scheduling | Confirmed via `notifications.ts` |

### B10. Profile / settings (WW Free)

WW Free profile is a **subset** of the Apex profile. Specifically:
- Display name, theme, language, notifications: **Confirmed**
- Goal, why, body stats, daily rhythm: **Confirmed** (collected during quiz, not full GoalSetup)
- Health conditions, medications, food prefs: **Implied — not confirmed surfaced in WW UI**
- Achievements grid: **Likely** — gamification context is global
- Coach unlock + admin tools: **Confirmed** (admin gesture is global)
- Privacy controls (DM/friend-request who-can): **Implied — likely shared but UI may differ**
- **Open question:** Does WW Free user have access to the full Profile screen, or a stripped-down version? Code shows the same `ProfileScreen.tsx` is reachable from both navigators. **Likely the same screen.**

### B11. Live coaching / go live (WW Free)

| Feature | Conf. |
|---|---|
| **"Go Live for Group Workout natively inside app for coach"** (product note) — coach-driven group live for WW Free finale | **Implied** — `WalkWaterFinaleScreen.tsx` exists with `devPhase` ('pre' / 'live' / 'post') flag; suggests three states but native live infrastructure for WW is unclear vs. Tribe live (Apex) which uses LiveKit |
| User-side viewing of finale livestream | Confirmed via TribeLiveViewerScreen route | Confirmed |
| Coach broadcast trigger in WW context | not separately found from `GoLiveTribeScreen` | **Implied — uses same surface as Apex** or needs separate WW path |
| Recording / replay of finale | Implied via tribe-live-egress edge fn | Likely |
| Reminders before finale starts | not found | Implied missing |

### B12. Tutorials / education (WW Free)

| Feature | Conf. |
|---|---|
| Quiz itself acts as the onboarding "tutorial" | Confirmed |
| Per-tab spotlight onboarding | **Implied missing** — `OnboardingTutorial.tsx` exists but is wired only for Apex MainTabNavigator |
| Educational tips during challenge (e.g., why protein matters, how steps add up) | not found | Implied missing |
| Help / FAQ section | not found | Implied missing |

### B13. Food scanner / meal flow (WW Free)

| Feature | Conf. |
|---|---|
| WW Free does **not** expose Train or Fuel tabs — replaced by Walk + Water | Confirmed by tab structure |
| Meal logging is therefore **not available in WW Free** | Implied by absence |
| Water log is the only nutrition-adjacent tracking in WW Free | Confirmed |
| Suggested foods / recipes for hydration support | not found | Implied missing |

### B14. Workout cards / content (WW Free)

| Feature | Conf. |
|---|---|
| WalkTracker tab shows step count + goal vs progress | Confirmed |
| Walk recommendations / route ideas | not found | Implied missing |
| Day-3 group workout video | Confirmed (via finale screen) |
| Pre-workout warm-up content | not found in WW context | Implied missing |

### B15. Post-completion / re-engagement (WW Free)

| Feature | Conf. |
|---|---|
| ChallengeCompleteScreen with hero + stats card + 48h offer | Confirmed |
| ApexUnlockScreen post-purchase celebration | Confirmed |
| StrongHER PDF delivery on completion via DM | Confirmed |
| **"Don't Stop Now" prompt at 48h+ if no purchase** | **Implied — NOT FOUND** |
| **Re-quiz with unlocked durations after 48h+ if no purchase (per product note)** | Confirmed in WalkWaterQuizScreen — locked-duration unlock logic exists; what's unclear is the surfacing trigger after 48h | **Likely partial** — unlock logic confirmed, surfacing path not |
| Push: "you missed a day" | not found | Implied missing |
| Push: "you finished — claim Apex" | not separately found from generic notif pool | Implied missing |
| Win-back paywall (different price, different framing) for declined-then-returned users | not found | Implied missing |

### B16. Dashboard / data states (WW Free)

| Feature | Conf. |
|---|---|
| `WalkWaterDashboardScreen.tsx` — daily summary, streak, goals, progress rings | Confirmed |
| Empty state when no plan yet | Implied — handled by initial route logic redirecting to Quiz | Confirmed (via initial route) |
| Loading state while fetching steps | Implied via ActivityIndicator | Likely |
| Error state if HealthKit/GoogleFit denied | not found | **Implied missing** |
| "Today vs yesterday" comparison | not found | Implied missing |

### B17. Error / empty / edge cases (WW Free)

| Edge case | Handled? |
|---|---|
| User opens app on day 0 of plan | Confirmed via initial route to dashboard |
| User opens app on day after `challengeDays` | Confirmed → ChallengeCompleteScreen |
| User opens app several days late (missed days) | **Implied missing** — no missed-day branch |
| User completes challenge but doesn't buy → comes back day 4 | **Implied missing** — no specific re-engagement state |
| User has no HealthKit data for today | **Implied — likely shows zeros silently**, no permission prompt loop |
| User installs on new device after challenge complete | Plan and streak tied to AsyncStorage — **WW data is local-only**, so reinstall = lost state. Major risk. |
| User has WW plan AND Apex tabs (mode toggled by admin) | Edge state — likely buggy, no documented behavior |
| Network offline during quiz | Quiz steps are local; signup will fail at step 8 — **graceful?** Implied — needs verification |

---

## 1C. WW Upgrade (ApexWWNavigator — 6 tabs)

**Persona:** Returning user who completed WW Free + bought challenge-finisher OR full upgrade.
**Pricing:** Already paid; may still be on Pro trial or full Pro entitlement.
**Tabs:** Home / Walk / Train / Fuel / Community / Coach. (Water is replaced by Train + Fuel.)

WW Upgrade is **not a separate code stack** — it's the same `WalkWaterNavigator` swapping `BaseWWNavigator` for `ApexWWNavigator` via `WALK_WATER_UPGRADE_EVENT`. This means most cross-cutting features (auth, profile, gamification, theme, language, notifications) are identical to WW Free.

The list below highlights only what's **different** in WW Upgrade vs WW Free.

### C1. Onboarding (WW Upgrade)

| Delta | Conf. |
|---|---|
| ApexUnlockScreen plays celebration immediately after purchase | Confirmed |
| New tabs (Train, Fuel) replace Water tab in place — no logout required | Confirmed |
| **Implied missing:** orientation / coach mark for the two new tabs ("Welcome to Train and Fuel — here's how to use them") |

### C2. Quiz (WW Upgrade)

| Delta | Conf. |
|---|---|
| **New quiz with no gender + unlocked durations** — confirmed implemented as conditional in `WalkWaterQuizScreen` | Confirmed |
| Trigger to re-take quiz (e.g., after 48h, after challenge complete) | **Likely partial** — logic exists; surfacing needs verification |
| Re-quiz CTA placement (banner? settings? auto-prompt?) | not found | **Implied missing** |

### C3. Paywall / purchase (WW Upgrade)

| Delta | Conf. |
|---|---|
| User has `pro` entitlement OR challenge-finisher one-time → most paywalls suppressed | Confirmed (via `usePro()` hook) |
| Upsell from challenge-finisher → full Pro (annual) | not found | **Implied missing** |
| Renewal reminder before Pro trial ends | not found | **Implied missing** |
| Cancellation flow / pause subscription | RevenueCat default UI — not custom | **Likely** |

### C4. Messaging / DM (WW Upgrade)

| Delta | Conf. |
|---|---|
| Same CoachDMScreen + CoachInbox; post-purchase users now also get coach-DM responses (real human) routed through `coach_messages` table | Confirmed |
| **"Fix DM flow"** (note) — both WW Free and WW Upgrade share the same DM file; whatever is broken affects both | applies to all DM use |
| **"Fix Point At It font and size to match DM Coach font and size"** (note) — Point At It feature still **not found in code** | **Implied missing** |

### C5. Challenge flow (WW Upgrade)

| Delta | Conf. |
|---|---|
| Streak continues / resets / extends? Behavior unclear post-upgrade | **Likely partial** — `getWalkWaterStreak` doesn't appear to have post-upgrade branching |
| Challenge can be re-taken with longer duration (7/14/21) | Confirmed via unlocked-duration logic |
| Day-3 group workout finale still applicable? | **Implied** — same screen exists; unclear if post-upgrade users see it again |

### C6. Banners and timers (WW Upgrade)

| Delta | Conf. |
|---|---|
| **"Fix 48h timer inside You Finished banner to be authentic"** (note) — currently 48h timer is in ChallengeCompleteScreen as a one-shot upsell. Whether it persists as a "banner" through other tabs is **not found** | **Implied** — confirmed timer exists in screen; banner persistence unclear |
| **"Fix 24h timer inside You Finished banner to be authentic"** (note) — second-stage 24h timer | **Implied missing** |
| **"3 Day Post Missed It"** banner | **Implied missing** (same as WW Free) |
| Verified email + tribe live banners shared | Confirmed |

### C7. Leaderboard (WW Upgrade)

| Delta | Conf. |
|---|---|
| Same `WalkWaterCommunityScreen` with seeded leaderboard | Confirmed |
| **Trust risk persists** — paying users see same fake names | **🔴 Confirmed** |

### C8. Group chat (WW Upgrade)

| Delta | Conf. |
|---|---|
| Same WalkWater Community chat with seeded messages | Confirmed |
| **Trust risk persists** | **🔴 Confirmed** |
| WW Upgrade users are not auto-routed to Apex Tribe — they stay in WW Community | Confirmed by tab structure — likely a missed cross-sell |

### C9. Coach tools (WW Upgrade)

| Delta | Conf. |
|---|---|
| Coach DM + Inbox: same | Confirmed |
| Live coaching booking via `LiveCoachScreen.tsx` — accessible? | **Likely** — LiveCoachScreen is in MainNavigator stack, not WalkWaterNavigator. **Cross-edition discoverability is unclear.** |
| Form review feature: **available in WW Upgrade?** | **Likely partial** — FormReviewScreen is wired in MainNavigator only. WW Upgrade users in WalkWaterNavigator may not have access route. |

### C10. Profile / settings (WW Upgrade)

| Delta | Conf. |
|---|---|
| Same ProfileScreen | Confirmed |
| Now has access to lab upload? (Pro-gated) | **Likely** — LabUploadScreen exists in MainNavigator only. Discoverability for WW Upgrade users unclear. |
| Pro status badge shows "active" | Confirmed |

### C11. Live coaching / go live (WW Upgrade)

| Delta | Conf. |
|---|---|
| "Group workout finale" via WalkWaterFinaleScreen | Confirmed |
| Discovery of native live-coaching session purchase (1-on-1 Zoom) | **Likely missing** — `LiveCoachScreen` only in MainNavigator stack |

### C12. Tutorials / education (WW Upgrade)

| Delta | Conf. |
|---|---|
| Onboarding tutorial wired for MainNavigator only — **WW Upgrade tabs do not get the spotlight tour** | **Implied missing** |
| Page tutorials (`PageTutorial.tsx`) — generic component, partially wired | **Likely partial** |

### C13. Food scanner / meal flow (WW Upgrade)

| Feature | File | Conf. |
|---|---|---|
| `WalkWaterFuelScreen.tsx` — WW-specific fuel/meal logging | Confirmed |
| Food scan modes: photo / upload / barcode / manual | Likely shares `FoodScanModal.tsx` with Apex | Likely |
| **"Fix Meal Cards to match ingredients"** (note) | **Implied — meal-card UI mismatch** with ingredient lists |
| Meal templates / coach-curated meals | Likely via `buildMealTemplates` | Likely |
| Grocery list generation (per `ProWelcomeModal` 7-day plan flow) | Confirmed in Apex; uncertain in WW | **Likely partial** |
| **Cal AI-style suggestion UI for food scanner** (note for Apex; relevance to WW Upgrade unclear) | **Implied missing** |

### C14. Workout cards / content (WW Upgrade)

| Feature | Conf. |
|---|---|
| `WalkWaterTrainScreen.tsx` — simpler than full Apex Train | Confirmed |
| Exercise library (156+ entries with YouTube IDs) | Confirmed (shared with Apex) |
| **"Film custom workout videos for Workout Cards"** (note) — currently most content uses YouTube IDs; demo studio generates AI demos for some | **Likely partial** — youtube fallback in place, custom production missing |
| Form review during WW Upgrade workouts | **Likely partial — see C9** |
| Live audio coach during workout | **Likely partial — see C9** |
| Rest timers (30/60/90/120s + custom) | Likely shared with Apex Train | Likely |
| Workout completion milestones (5/10/25/50 → app review trigger) | Confirmed | n/a |

### C15. Post-completion / re-engagement (WW Upgrade)

| Feature | Conf. |
|---|---|
| Pro Welcome Modal (one-time, generates AI program + 7-day meals + grocery list) | Confirmed (key `apex.pro.welcome.seen`) |
| Streak after upgrade — does it carry, reset, extend? | **Implied — unverified branch** |
| Win-back if user disengages post-upgrade | not found | Implied missing |

### C16. Dashboard / data states (WW Upgrade)

| Feature | Conf. |
|---|---|
| `WalkWaterDashboardScreen.tsx` continues to render — **does it now show Train/Fuel summary?** | **Likely partial** — dashboard may not have been updated to surface new data sources |
| Cross-sell to Apex Tribe / full MainNavigator features | not found | **Implied missing** |

### C17. Error / empty / edge cases (WW Upgrade)

| Edge case | Handled? |
|---|---|
| Refunded purchase → entitlement revoked → tabs should swap back? | **Implied — likely buggy**, no observed handler |
| Upgrade event fires during active workout | **Likely benign**, but UI swap mid-session not tested |
| Pro trial expires while in WW Upgrade tabs | **Likely partial** — paywall reappears via `maybeShowPaywall` |
| Network offline during upgrade purchase | RevenueCat handles retry; client-side rollback if `setWWUpgraded` set before entitlement confirm? | **Implied — needs verification** |

---

## 1D. Apex (MainNavigator — 6 tabs + 14 modal screens)

**Persona:** Pro subscriber (or trial). Full feature set. Includes coach persona toggle.
**Pricing:** Monthly / annual via RevenueCat `default` offering. Optional add-ons (live coaching packages).
**Tabs:** Dashboard / Train / Fuel / Tribe / Coach / Plans.

### D1. Onboarding (Apex)

| Feature | File | Conf. |
|---|---|---|
| `OnboardingScreen.tsx` brand intro | Confirmed |
| `SignUpScreen.tsx` / `LoginScreen.tsx` | Confirmed |
| `GoalSetupScreen.tsx` 6-step wizard (Identity, Goal, Why, Body Stats, Daily Rhythm, Health & Prefs) | Confirmed (1000+ lines) |
| `GoalSetupWrapper.tsx` (modal-mode wrapper) | Confirmed |
| `OnboardingTutorial.tsx` 5-step spotlight (Train, Fuel, Tribe, Coach, Plans) | Confirmed; XP rewards: 10 per step + 25 bonus; key `apex_onboarding_done_v3` |
| `PageTutorial.tsx` per-page coach marks | **Likely partial** — component exists, usage scattered |
| `StartHereCard.tsx` first-action prompt | Confirmed (component exists; usage to verify) |
| Voice-coach selection during goal setup | Confirmed |
| Theme selection during goal setup | Confirmed |
| **"Add Cal AI-style UI and suggestions to the food scanner"** (note) — relates to fuel onboarding/UX | **Implied missing** |
| **"Fix interactive tutorial so it covers the basics"** (note) | **Implied** — tutorial exists but coverage gaps suspected (e.g., no WW-tab tour) |

### D2. Quiz (Apex)

Apex doesn't have a separate quiz; GoalSetup is the equivalent. See D1.

### D3. Paywall / purchase (Apex)

| Surface | Trigger | Conf. |
|---|---|---|
| `UpgradeScreen.tsx` — RevenueCat paywall UI | Tap "Unlock Pro" | Confirmed |
| `maybeShowPaywall(userId)` called on app boot, profile sync, feature gate | Confirmed |
| LabUpload paywall gate | `!isPro && !proLoading` | Confirmed |
| FormReview paywall gate | same | Confirmed |
| Coach unlimited messages paywall (after 5 free) | `apex.coach.freeMessageCount.${userId}` | Confirmed |
| Train premium features paywall | per-feature | Likely |
| Fuel photo/barcode scan paywall (`!isWW && (photo||upload) && !isPro`) | Confirmed |
| Live coaching package purchase (separate offering) | weekly / 3-month / 12-month tiers, `LiveCoachScreen` | Confirmed |
| Challenge finisher (post-WW completion) | offering `challenge_finisher` | Confirmed |
| Pro Welcome Modal (one-time activation flow) | First Pro purchase | Confirmed |
| Restore purchases | Implied via RevenueCat default | **Likely** |
| Subscription management surface (cancel/change plan inside app) | not found | **Implied missing** — likely defers to App Store / Play Store |

### D4. Messaging / DM (Apex)

| Feature | Conf. |
|---|---|
| `CoachScreen.tsx` AI chat with quick-chips + workout / program / meal-plan generation tags `[[WORKOUT:…]]` `[[PROGRAM:…]]` | Confirmed |
| 5 free messages → paywall | Confirmed |
| `CoachDMScreen.tsx` AI Josh DM funnel with calendar booking | Confirmed |
| `CoachInboxScreen.tsx` real-coach inbox (admin-only access) | Confirmed |
| Coach message push notifs via `apex-coach-messages` channel | Confirmed |
| ElevenLabs voice coach conversation in CoachScreen | Confirmed |
| Voice memos in coach DM | not separately found in DM | Implied missing |
| Image attachment to coach DM | not separately found | Implied missing |
| Coach reply-all / broadcast | not found | **Implied missing** |
| Segmenting / templating for coach replies | not found | **Implied missing** |

### D5. Challenge flow (Apex)

| Feature | Conf. |
|---|---|
| Apex doesn't have the WW step/water challenge — has Tribe Challenges (per-tribe group challenges) instead | Confirmed |
| Tribe Challenge screen with joined challenges + group messaging | Confirmed (TribeScreen tab "Challenges") |
| Group chat per challenge (storage: `apex.challenge.group.{challengeId}`) | Confirmed |
| Multi-media in challenge chat (image / video / audio) | Confirmed |
| Tribe-wide PR celebration challenges | Confirmed via achievement post-types |
| Challenge join request workflow | Implied via tribe schema | Likely |
| Challenge moderation (kick / mute) | not found | **Implied missing** |

### D6. Banners and timers (Apex)

| Banner / Timer | Trigger | Conf. |
|---|---|---|
| `VerifyEmailBanner` | unverified email | Confirmed |
| `TribeLiveBanner` | tribe member goes live | Confirmed |
| `ActiveWorkoutPanel` | active workout in progress | Confirmed |
| In-app notification banners | various | Confirmed |
| Rest timers (30/60/90/120s + custom) | between sets | Confirmed |
| Cooldown timer | post-workout | Confirmed |
| Pro trial expiry countdown | not found | **Implied missing** |
| Lab upload result-ready banner | not found | **Implied missing** |
| Live coaching session join window banner | not found | **Implied missing** |
| Tribe challenge time remaining banner | not found | **Implied missing** |

### D7. Leaderboard (Apex)

| Feature | File | Conf. |
|---|---|---|
| Tribe screen → Leaderboard tab — `LeaderboardScope` = 'week' / 'month' / 'allTime' | `TribeScreen.tsx` | Confirmed (scope defined) |
| Leaderboard data source — Supabase profile_leaderboard / leaderboards | **Likely** — tables referenced in schema |
| Per-tribe vs global leaderboards | **Likely partial** — not fully visible |
| Friends-only filter | not found | **Implied missing** |
| Leaderboard-driven achievements (top-10, top-100) | not found | **Implied missing** |
| Real vs seeded data in Apex leaderboard | **Likely real** but not 100% confirmed |

### D8. Group chat / Tribe (Apex)

| Feature | File | Conf. |
|---|---|---|
| Tribe Feed tab (text + video posts, achievements, badges 'PR' / 'Tip' / 'Q' / 'Win') | `TribeScreen.tsx` | Confirmed |
| Real-time post & comment updates via `tribe-feed-realtime` channel | Confirmed |
| Like / react (🔥) | Confirmed |
| Comments with `tribe_comments` table | Confirmed |
| Author profile modal (`UserProfileModal.tsx` with bio, coach badge, title) | Confirmed |
| Achievement card share to social or Tribe feed (9:16 ratio) | Confirmed |
| Tribe Challenges tab (joined challenges, group messaging) | Confirmed |
| Tribe Academy tab (modules, quizzes, personalized actions) | Confirmed |
| Tribe Live (LiveKit broadcast + comments + join requests + egress recording) | Confirmed |
| Coach posts in tribe feed (badge, `author_is_coach=true`) | Confirmed |
| Post moderation (Claude Haiku auto-flag) | Confirmed |
| Block / report user | **Likely partial** |
| Mute thread | **Implied missing** |
| Pinned posts | **Implied missing** |

### D9. Coach tools (Apex — coach side)

| Feature | File | Conf. |
|---|---|---|
| `CoachModeScreen.tsx` (~2100 lines) — admin dashboard | Confirmed |
| Client list with metrics (active/linked/cancelled, next session, totals, bonus, attendance) | Confirmed |
| Invite codes (7-day expiration, redeemable) | Confirmed |
| Fit call calendar via Calendly / Acuity | `lib/calendarIntegration.ts` | Confirmed |
| Live coaching Zoom integration via `zoom-session` edge fn | Confirmed |
| Gift fulfillment tracker (foam roller, water bottle, etc.) | Confirmed |
| Demo asset management (videos, FAL.ai generation) | `DemoStudio.tsx` | Confirmed |
| Walk-Water mode toggle (admin) | Confirmed |
| Demo client seeding (`@apex_coach_demo_clients`) | Confirmed |
| `CoachInboxScreen.tsx` real coach DM inbox | Confirmed |
| Coach analytics dashboard (KPIs, retention, churn) | not implemented | **Implied missing** |
| Coach message templates / canned replies | not found | **Implied missing** |
| Bulk client message | not found | **Implied missing** |
| Coach onboarding tour ("how to use Coach Mode") | not found | **Implied missing** |
| Background-check / certification verification flow | not found | **Implied missing — probably out of scope** |
| Coach availability editor in-app (vs only via Calendly) | not found | **Implied missing** |
| Coach revenue dashboard | not found | **Implied missing** |

### D10. Profile / settings (Apex)

Already inventoried in §1A. Apex has the full set. Notable Apex-specific items:

| Apex-only Profile element | Conf. |
|---|---|
| Pro Welcome Modal triggered on first Pro entitlement | Confirmed |
| Lab Upload card / status (blood/health uploads) | Confirmed |
| Coach selector (Marcus / Serena + custom) with audio preview | Confirmed |
| Coach bio editor + Claude generation | Confirmed |
| Coach title selector | Confirmed |
| Achievements grid with share | Confirmed |
| Goal preview AI image | **Likely partial** |
| **"Fix Profile section because it is too cluttered"** (note) | n/a — design feedback, not a feature gap |
| **"Add tappable tabs where possible"** (note) | n/a — design feedback |
| **"Consolidate most important tabs to the top and least important tabs to the bottom"** (note) | n/a — design feedback |

### D11. Live coaching / go live (Apex)

| Feature | File | Conf. |
|---|---|---|
| `LiveCoachScreen.tsx` (~3500 lines) — 1-on-1 video coaching purchase + scheduling + history | Confirmed |
| Package tiers: 1x/wk, 2x/wk, 3x/wk, group drop-in × weekly / 3-mo / 12-mo | Confirmed |
| Bonus / gift tier on purchase | Confirmed |
| Calendly slot picker | Confirmed |
| `live_coaching_sessions` table + `complete_live_coaching_session()` RPC | Confirmed |
| Achievements `live_1`, `live_5`, `live_10`, `live_25` | Confirmed |
| Session history with duration | Confirmed |
| Bonus tracker visible to client | Confirmed |
| In-call client chat (uses coach_messages filtered) | Confirmed |
| Pre-session reminder push (~30 min) | Confirmed |
| Post-session feedback / rating | not found | **Implied missing** |
| Cancel / reschedule client-side | **Likely partial** |
| `GoLiveTribeScreen.tsx` — coach broadcast to Tribe via LiveKit | Confirmed |
| `TribeLiveViewerScreen.tsx` — client viewer | Confirmed |
| Tribe live join request approval (coach-side) | Confirmed |
| Tribe live comments (real-time, `author_is_coach` flag) | Confirmed |
| Tribe live recording / replay via `tribe-live-egress` | Confirmed |
| **"Fix Live Coaching Session natively inside app"** (note) — Zoom is currently the carrier; full in-app video is the goal | **Implied** — Zoom integration is "complete" per LIVE_COACHING_DEPLOY.md; "natively inside app" likely means replacing Zoom with LiveKit-style flow |
| **"Fix Go Live inside Tribe for coach natively inside app"** (note) — already on LiveKit per code | **Confirmed implemented** — likely just bug-fix work, not net-new |
| Audience visualization during live (count, hands-up) | **Likely partial** |
| Live schedule announcement to Tribe feed | **Likely** via post-recap flow |

### D12. Tutorials / education (Apex)

| Feature | File | Conf. |
|---|---|---|
| `OnboardingTutorial.tsx` 5-step spotlight | Confirmed |
| `PageTutorial.tsx` reusable per-page tour | **Likely partial** |
| Tribe Academy modules (id, title, summary, bullets, action, quiz) | Confirmed |
| Academy quiz (1 question, 4 options, 1 correct) | Confirmed |
| Academy XP rewards | Confirmed |
| Academy share-snippet for social | Confirmed |
| Personalized action items (AI per module per user) | Likely |
| Quiz results persisted (`apex.academy.quizResults.v1`) | Confirmed |
| Help / FAQ in-app | not found | **Implied missing** |
| Glossary | not found | **Implied missing** |
| Video tutorials embedded in screens | **Likely partial** via VideoPlayerModal |

### D13. Food scanner / meal flow (Apex)

| Feature | File | Conf. |
|---|---|---|
| `FuelScreen.tsx` main fuel hub | Confirmed |
| `FoodScanModal.tsx` 4-mode scanner: photo (Claude Sonnet 4.6 vision), upload, barcode (Open Food Facts), manual (Claude Haiku) | Confirmed |
| Macro context sent to AI (calories / protein / carbs / fat remaining + goal) | Confirmed |
| AI returns name + macros + recommendation | Confirmed |
| Log to food diary / nutrition_entries | Confirmed |
| Camera permission gate | Confirmed |
| Pro paywall on photo + upload (non-WW) | Confirmed |
| Meal templates / coach-curated meals | Likely |
| Grocery list generation (in Pro Welcome Modal) | Confirmed |
| `MealShareCard.tsx` shareable meal card | Confirmed |
| **"Add Cal AI-style UI and suggestions to the food scanner"** (note) — visual + recommendation UX upgrade implied | **Implied missing** as a polished UX layer |
| Recipe library | not found explicitly | **Likely partial** |
| Restaurant / on-the-go meal finder | mentioned in onboarding tutorial copy ("On-the-Go to find healthy meals near you") | **Implied — likely partial** |
| Water log (Apex) | Confirmed (shared) |
| Weight log (`WeightLogModal.tsx`) — manual / camera-scale photo / library / Apple Health placeholder | Confirmed |

### D14. Workout cards / content (Apex)

| Feature | File | Conf. |
|---|---|---|
| `TrainScreen.tsx` (~1000+ lines) workout execution hub | Confirmed |
| `PlansScreen.tsx` program browser (Power Build / HIIT Burn / Body Recomp Pro / Elite Performance / AI Generated) | Confirmed |
| 7-day program structure | Confirmed |
| Day status (done / today / upcoming / rest) | Confirmed |
| 156+ exercise library with YouTube IDs | Confirmed |
| `VideoPlayerModal.tsx` for demos | Confirmed |
| Coach-recorded demo cache (per coach + exercise) | Confirmed |
| `RepCounter.tsx` rep counting component | Confirmed |
| `TempoAssistCard.tsx` tempo guidance | Confirmed |
| `VisionIndicator.tsx` form-vision status | Confirmed |
| Workout progress per-user per-date (`apex.train.progress.${userId}.${date}.${name}`) | Confirmed |
| Workout completion (`apex.train.complete.${userId}.${date}.${name}`) | Confirmed |
| Completion milestones at 5 / 10 / 25 / 50 → app review trigger | Confirmed |
| Real-time AI voice coaching during workout (OpenAI realtime / ElevenLabs fallback) | Confirmed |
| Voice command parsing: "30 lbs for 8", "rest 90 sec", "swap for pull-ups" | Confirmed |
| Warm-up step ("walk 5 minutes") | Confirmed |
| `FormReviewScreen.tsx` Claude vision form review | Confirmed |
| `SerenaProtoScreen.tsx` voice + camera + form review combined | Confirmed |
| `FormReviewTempoOverlay.tsx` real-time camera overlay | Confirmed |
| RepFSM (idle ↔ descending → bottom_reached → ascending → idle) | Confirmed |
| **Form Review explicitly replaces older Form Check** — note "Remove Form Review / Keep Send 15 Second Form Review To Coach" — clarification: SERENA_FORM_REVIEW_HANDOFF.md indicates the new Claude-based form review IS the replacement; old form check is the deprecated one | **Confirmed via handoff doc** |
| **"Film custom workout videos for Workout Cards"** (note) — most exercises currently use YouTube IDs, not Apex-branded video | **Implied — production gap** |
| Skill / progression tracking | **Likely partial** |
| Personal records (PR) tracking + share | Confirmed via `pr_set` event + tribe post type |
| Workout history calendar | **Likely partial** |

### D15. Post-completion / re-engagement (Apex)

| Feature | Conf. |
|---|---|
| Pro Welcome Modal flow | Confirmed |
| Achievement celebration overlay | Confirmed |
| App-rating prompt at workout 5 / 10 / 25 / 50 | Confirmed |
| Daily / weekly recap / digest | not found | **Implied missing** |
| Win-back campaign for lapsed users | not found | **Implied missing** |
| Coach business notification ("client missed 3 days" → coach alert) | Confirmed |
| Streak protection / freeze | not found | **Implied missing** |
| Anniversary push ("you've been with Apex 1 year") | not found | **Implied missing** |

### D16. Dashboard / admin / data states (Apex)

| Feature | Conf. |
|---|---|
| `DashboardScreen.tsx` daily summary, PRs, achievements, leaderboard, streaks | Confirmed |
| `SuggestionsScreen.tsx` AI-personalized next-action suggestions | Confirmed |
| Lab Upload status / results (with AI analysis) | Confirmed |
| Coach Mode admin dashboard | Confirmed |
| Walk-Water mode toggle in admin | Confirmed |
| Pro preview toggle for testing | Confirmed |
| Feature waitlist viewer | Confirmed |
| Sentry crash reporting | Confirmed |
| PostHog event analytics | Confirmed |
| Internal debug screen | not found explicitly | **Likely partial** |
| Account-level analytics for end-user (e.g., "your year in review") | not found | **Implied missing** |

### D17. Error / empty / edge cases (Apex)

| Edge case | Handled? |
|---|---|
| Pro entitlement revoked mid-session | **Likely partial** — `usePro` updates on focus |
| Trial expires while on a Pro screen | **Likely partial** |
| Coach DM session interrupted (network drop) | **Likely partial** — message persistence depends on Supabase |
| Vision analysis fails repeatedly | falls back from Claude → Gemini → "unable_to_assess" silently | Confirmed (silent degradation = trust risk) |
| Voice agent disconnects (ElevenLabs token expires) | not separately found | **Implied missing** explicit recovery |
| Tribe live stream egress fails | not separately found | **Implied missing** |
| Live coaching Zoom meeting fails to start | **Likely partial** |
| User belongs to multiple tribes | **Likely partial** |
| User has Pro on iOS but logs in on Android (entitlement sync) | RevenueCat handles | Likely |
| User restores purchase after reinstall | RevenueCat default | Likely |
| Form review without lockout (bench press, deadlift) | Handled in Claude system prompt rules | Confirmed |
| Camera blocked by case / poor lighting | Handled via `framingIssue` enum | Confirmed |
| User cancels subscription via App Store directly | Webhook → entitlement update; app-side reflection | **Likely partial** |

---

# Part 2 — Missing or Unclear Areas

These are flows, states, or components that the product notes or surrounding code imply exist but that we could not fully verify in the codebase. **Each needs founder/product confirmation.**

## 2.1 Authenticity claims that can't yet be backed by data

| Claim | Where |
|---|---|
| "You Finished" banner — authentic to user data | not found as a discrete persistent banner |
| 48h timer in "You Finished" banner — authentic | timer exists in ChallengeCompleteScreen; banner persistence across tabs unverified |
| 24h timer follow-up in "You Finished" banner | not found |
| 3 Day Post Missed It banner — authentic | not found |
| Group Chat (WW Free + Upgrade) — authentic | currently seeded with hardcoded names (Maria G., Aisha K., Chris R., James T., Priya S.) |
| Leaderboard (WW Free + Upgrade) — authentic | currently seeded with `LEADERBOARD_SEED` |
| Apex Tribe Leaderboard — authentic | scope defined; data source partly visible — needs end-to-end verification on real users |

## 2.2 Features named in notes that are not visible in code

| Item | Note source |
|---|---|
| "Point At It" feature with font/size matching DM Coach | WW Upgrade note |
| "Don't Stop Now" banner | Note + UpgradeScreen alluded |
| "Fix test purchase" — clear separation of sandbox vs prod purchase paths | WW Free note |
| "Fix Coach Dashboard" — what specifically about CoachModeScreen needs fixing | Apex note |
| "Fix Talk To Coach feature" — same as DM, or a distinct surface | Apex note |
| Cal AI-style food scanner UI + suggestions | Apex note |
| Custom workout videos for Workout Cards (vs current YouTube IDs) | WW Upgrade note |
| Live Coaching Session "natively inside app" (vs current Zoom) | Apex note |
| Re-engagement quiz surfacing trigger ("48h timer expired → show new quiz") | WW Upgrade note |
| Coach demos (fully filled vs partial demo asset library) | Apex note |
| "Fix interactive tutorial so it covers the basics" — what basics are uncovered | Apex note |
| Profile decluttering / tab consolidation | Apex note (UX, not feature gap) |

## 2.3 Likely-missing flows that any well-rounded fitness/wellness app has

| Flow | Why it matters |
|---|---|
| Streak protection / freeze (1 free skip per N days) | Retention; avoids "all or nothing" emotional loss |
| Streak loss recovery push (immediate "you missed a day" + streak rebuild) | Retention |
| Daily / weekly / monthly recap digest | Retention + sharing |
| "Year in review" annual recap | Retention + virality |
| In-app help / FAQ | Support cost reduction |
| Glossary / dictionary | New-user accessibility |
| Subscription management screen (cancel / pause / change plan inside app) | Apple / Google may require it for App Store / Play Store policies |
| Restore purchases UI (explicit, not just RevenueCat default) | iOS Family Sharing edge cases |
| Refund request affordance | Customer-service friction reduction |
| Account export / data download (GDPR Right to Data Portability) | Compliance |
| Privacy policy / terms acceptance flow | Apple App Store reqs |
| Cookie / tracking opt-in (ATT prompt on iOS) | iOS 14.5+ requirement |
| In-app reporting / abuse flow with moderation queue | Trust & safety |
| Block / mute user with persistence | Trust & safety |
| Coach quality rating / review | Coach marketplace integrity |
| Live coaching session feedback / star rating | Quality signal |
| Wearable integration (HealthKit, Google Fit, WHOOP, Garmin, Apple Watch) | Currently only WHOOP/Garmin waitlist UI exists |
| Calendar sync (Google / Apple Calendar two-way) | Currently only API-key UI |
| Widgets / live activities (iOS 16+) | Engagement |
| App Clips / Instant Apps | Onboarding without download |
| Deep linking (universal / app links) for share-to-app | Currently only password reset deep link confirmed |
| Referral program | Growth |
| Promo / gift codes | Growth |
| Family / pair plan | Growth |
| Multi-language beyond en/es | Growth (especially pt-BR, fr, de) |
| Offline mode / sync when reconnected | Resilience |
| Conflict resolution if same data edited on two devices | Resilience |

## 2.4 Stage-level state not fully resolved

| Question | Status |
|---|---|
| What happens to WW streak when user upgrades mid-challenge? | Not documented |
| What happens to WW streak when user upgrades after challenge complete? | Not documented |
| If WW user upgrades, do they automatically join Apex Tribe, or stay in WW Community? | They stay in WW Community per current navigation — likely a missed cross-sell |
| If admin toggles `walkWaterMode` while a workout is in progress, what happens? | Not handled explicitly |
| Can a coach also be a regular WW Free user? | Yes per code — but the UX of seeing both perspectives at once is not clear |
| When `is_coach=true`, does the coach still have a Pro entitlement requirement, or are coaches comp'd? | Not clear from code |
| What gates "real coach" vs "any user with the password"? Currently only the unlock password — not robust | Not clear |

---

# Part 3 — Duplicate or Overlapping Features

## 3.1 The big one: WW Upgrade vs Apex parallelism

**WW Upgrade tabs (`ApexWWNavigator`)** and **Apex tabs (`MainTabNavigator`)** implement the **same core ideas with separate code paths**:

| Concept | WW Upgrade screen | Apex screen | Risk |
|---|---|---|---|
| Home / Dashboard | `WalkWaterDashboardScreen.tsx` | `DashboardScreen.tsx` | Two dashboards diverge over time |
| Train | `WalkWaterTrainScreen.tsx` (simpler) | `TrainScreen.tsx` (full) | Feature drift; bug fixes need to land twice |
| Fuel | `WalkWaterFuelScreen.tsx` | `FuelScreen.tsx` | Same |
| Community / Tribe | `WalkWaterCommunityScreen.tsx` (seeded data) | `TribeScreen.tsx` (real data) | **WW Upgrade users on a paid tier still see fake leaderboard** |
| Coach | `WalkWaterCoachScreen.tsx` | `CoachScreen.tsx` | Distinct system prompts; risk of inconsistent answers across tabs |

**Implication:** Anything fixed in Apex (e.g., DM flow, font sizes, scanner UX) must be re-verified in WW Upgrade. Three-tier consistency review is unavoidable.

## 3.2 Two distinct quizzes with overlapping data

| Quiz | Where | Captures |
|---|---|---|
| `WalkWaterQuizScreen` (8 steps) | WW only | steps baseline, water baseline, goal, gender (conditional), time, days, plan |
| `GoalSetupScreen` (6 steps) | Apex only — entered after auth | identity, goal, why, body stats, daily rhythm, health & prefs |

Goal field is captured **twice** for users who do WW first then upgrade. WW captures `goal` as one of {Lean / Energy / Confidence / Feel better}; Apex captures it as one of {Lose / Build / Recomp / Performance}. **Likely a value-mapping bug or lost data** at the boundary.

## 3.3 Duplicate / similar coach surfaces

| Surface | Purpose | Overlap |
|---|---|---|
| `CoachScreen.tsx` | AI chat (5 free + Pro unlimited) | Overlaps in personality with `CoachDMScreen` |
| `CoachDMScreen.tsx` | AI Josh DM funnel for booking fit calls | Same persona as CoachScreen, different stage machine |
| `CoachInboxScreen.tsx` | Real coach reads + replies | Receives messages from both above? |
| `WalkWaterCoachScreen.tsx` | WW-specific AI chat | Yet another instance of the persona |
| `LiveCoachScreen.tsx` | 1-on-1 live coaching purchase + scheduling | Different surface entirely, but coach-themed |
| `SerenaProtoScreen.tsx` | Voice + camera + form review combined | "Serena" coach persona |

**Risk:** "Coach" means at least 6 different things in the app. A user (or a coach) is likely confused about which surface to use for what.

## 3.4 Form-related surfaces

- `FormReviewScreen.tsx` — full-screen form review with overlay
- `FormReviewTempoOverlay.tsx` — overlay component
- `SerenaProtoScreen.tsx` — Serena voice + form
- `TempoAssistCard.tsx` — tempo guidance card
- `RepCounter.tsx` — rep counting
- `VisionIndicator.tsx` — vision status

**The handoff doc clarifies:** Form Review (Claude, 1s, 5-rep) replaces older Form Check (Gemini); Normal Set (Gemini, 400ms, unlimited) is a different mode. Both modes are still wired.

The note says **"Remove Form Review / Keep Send 15 Second Form Review To Coach"** — based on the handoff, the new Claude-based system IS the "15-second form review to coach" replacement. The note is likely about deprecating the old Gemini "Form Check" path. Needs founder confirmation.

## 3.5 Two tribe live broadcast paths

- `GoLiveTribeScreen.tsx` (Apex) — coach broadcast via LiveKit
- `WalkWaterFinaleScreen.tsx` (WW) — day-3 group workout livestream

These should likely share the underlying LiveKit infrastructure but currently appear to be separate screens. Verification needed.

## 3.6 Two food / fuel paths

- `FuelScreen.tsx` (Apex)
- `WalkWaterFuelScreen.tsx` (WW Upgrade)

Same `FoodScanModal.tsx` shared, but the surrounding hub UI is different. Same drift risk as 3.1.

## 3.7 Two leaderboard implementations

- `WalkWaterCommunityScreen.tsx` + `WalkWaterTribeScreen.tsx` — seeded
- `TribeScreen.tsx` Leaderboard tab — Supabase-backed (likely)

Two leaderboard implementations is one too many. The seeded one will keep producing trust issues until removed.

## 3.8 Two tribe / community surfaces

- `WalkWaterCommunityScreen.tsx` (WW Free + Upgrade)
- `WalkWaterTribeScreen.tsx` (WW)
- `TribeScreen.tsx` (Apex)

WW has both Community and Tribe screens — relationship between them not clear. Needs check.

---

# Part 4 — Hidden Risk Areas

These are the surfaces most likely to create **trust, conversion, retention, or product-quality issues** if shipped incomplete. Ranked roughly by severity.

## 🔴 Tier-1 risks

1. **Seeded leaderboard data shown to real users (WW Free + WW Upgrade).** `LEADERBOARD_SEED` in `WalkWaterCommunityScreen.tsx` and `WalkWaterTribeScreen.tsx` displays Maria G., James T., Aisha K., Chris R., Priya S. as if they're real members. Member count badge says "8 members" when 7 are fake. **A paying customer who realizes this loses trust permanently.**
2. **Seeded community chat messages (WW Free + WW Upgrade).** Same five fake names appear posting motivational messages. Same trust risk.
3. **No React Error Boundary at app root.** Any unhandled exception in a screen takes down the entire app (white screen / crash). On a fitness app where a workout-mid-crash means lost data, this is a retention killer.
4. **"This offer is temporarily unavailable" appearing instead of test/sandbox purchase paths.** Confirmed copy in `purchaseChallengeFinisher`. Listed as fix item in WW Free notes. If this fires for a real user instead of a test user, conversion is lost.
5. **WW data is local-only (AsyncStorage).** Reinstall = lost streak, plan, water log, water goal. A user who churns and returns has zero continuity. This silently undermines the WW funnel.
6. **Notification content recycle every 7 days.** With only 7 messages per goal × 4 goals × 3 times/day, users see the same morning push every Monday. After ~2 weeks, users perceive the "AI coach" as repetitive — a brand-personality risk.
7. **Vision degradation is silent.** When Claude returns `unable_to_assess`, nothing surfaces in the form review UI — the user thinks the coach is lazy when really the AI couldn't see them. Trust risk on the marquee feature.
8. **Live coaching uses Zoom (not native).** Switching apps mid-coaching session is friction. Apple/Google may also flag it as "third-party redirect" depending on context. Listed as fix item.
9. **Pro trial expiry has no warning push or banner.** Users hit a paywall with no notice; perceived as bait-and-switch.
10. **Profile "danger zone" delete-account reasons are captured but with no clear surfacing path to coach/product.** Reasons are likely written to Supabase but no admin / dashboard / Slack alert for them. Lost feedback on churn.

## 🟠 Tier-2 risks

11. **WW Upgrade users see WW Community (seeded) instead of being moved to Apex Tribe (real data).** Missed cross-sell + ongoing exposure to fake content even after paying.
12. **Coach-DM "Point At It" feature missing.** Surfaced in product note. If this is a UX prompt that helps users describe pains/symptoms, missing it bottlenecks the booking funnel.
13. **No streak-loss / missed-day push or banner.** A user who skips a day has no nudge to come back; the next time they open the app they may not even realize the streak broke. Retention-killer.
14. **Goal field captured twice in two formats** (WW {Lean/Energy/Confidence/Feel better} vs Apex {Lose/Build/Recomp/Performance}). Cross-edition signal is lost or mistranslated.
15. **No subscription-management surface inside app.** App Store / Play Store rules increasingly require this. Risk of rejection or re-review.
16. **No restore-purchase explicit UI.** Family Sharing on iOS will produce confused users.
17. **No Sign-in-with-Apple.** Required by App Store policy if any third-party login exists; even though the app uses email-only currently, adding any social login later mandates SiwA. Plan for it.
18. **"Demo client" seeding in Coach Mode + admin Walk-Water toggle.** Useful for the founder, but if shipped to a non-founder coach with admin enabled, they could see fake data alongside real clients without realizing it.
19. **Two coach-message listeners** (`useCoachMessageListener`) one for AI DM and one for real coach inbox — collision risk where a real coach message gets simulated-typed, or an AI message gets replied to as if it's the user.
20. **Custom workout videos missing.** YouTube IDs as exercise demos means users see ads + recommended videos for OTHER fitness apps inside Apex. Conversion leak.

## 🟡 Tier-3 risks

21. **No `AccessibilityLabel` on most interactive components.** App Store review may flag, and a meaningful audience is excluded.
22. **No reduce-motion respect.** Onboarding spotlight pulses indefinitely; vestibular-sensitive users will struggle.
23. **Languages limited to en/es.** Global addressable market constrained.
24. **AI cost exposure.** Claude vision @ 1s cadence × 5 reps × N users = real $$. No rate limit / budget alarm visible.
25. **Sentry trace sample rate 10%.** Low for early-stage app; more captures help debug but also cost more.
26. **`is_coach=true` is a checkbox effectively unlocked by a single password.** Anyone with that password becomes a "coach" with all the badge / public bio / Tribe-tagged-coach-post trust signaling.
27. **Demo asset approval / archival in CoachMode is admin-only — no audit trail of who approved what.**
28. **Tribe live join request approval has no rate limit — coach could be DDoS'd by spammed join requests.**
29. **No "user reported" content moderation queue surfaced anywhere — even though Claude Haiku auto-moderates, edge-cases need human review.**
30. **Healthcare-adjacent data (medications, surgeries, GLP-1 status, lab uploads) collected without HIPAA-style explicit consent flow / privacy policy reference.**

---

# Part 5 — Coverage Gaps

These are areas where the source notes don't yet provide enough detail for a complete audit. Each item below is a question that, when answered, would close the gap.

## 5.1 Per-feature questions

### Onboarding
- What is the exact entry path that determines whether a brand-new user lands in WW or Apex? Is `walkWaterMode` defaulted on for new installs or off?
- What's the rationale for two quizzes (WW + GoalSetup)? Is there a plan to merge?

### Quiz
- Confirm that the "no gender + unlocked durations" branch is actually being shown to upgraded users — what triggers it?
- For day 7/14/21 unlock logic: is the gate `hasCompletedChallenge >= 1` or `hasCompletedChallenge >= 3 days`?
- What happens if a user completes 3 days, doesn't buy, comes back 60 days later — does the unlock persist?

### Paywall
- Does iOS App Store require Sign-in-with-Apple if email-only social proof is added?
- What's the offering structure intended for App Store Connect / Google Play? (`monthly`, `annual`, `weekly`, `challenge_finisher` confirmed; unclear if `lifetime` is set up)
- Is family-sharing intended on iOS?

### DM
- "Point At It" — UI element? Educational tooltip? Quick-reply chip? File for confirmation.
- Does the user-side DM in WW route to the same `coach_messages` table as Apex, or a different one?
- Does the coach see WW + Apex DMs in one inbox or two?

### Challenge flow
- Does "missed a day" reset streak to 0 immediately, or after N days grace?
- If user has a 14-day plan and completes day 14, does streak rollover into a new cycle, or does ChallengeCompleteScreen take over?
- What's the day-3 finale's relationship to the rest of the challenge — bonus event, milestone, or default?

### Banners and timers
- Are 48h and 24h timers two distinct windows, or one followed by the other?
- Where does each banner persist (top of every screen? only on Home?)
- Is "You Finished" banner the same as ChallengeCompleteScreen, or a smaller banner that appears above other content?

### Leaderboard
- Will WW leaderboard be replaced with real data, augmented with real + seeded, or kept seeded with a "Sample community" label?
- For Apex leaderboard, what's the score? Workouts? Streak? PRs? XP?
- Is there a per-tribe leaderboard separate from global?

### Group chat / Tribe
- For WW Community, will the seeded chat be replaced or kept as priming content?
- For Tribe Challenges, is there a max member size? Discoverability — how do users find new tribes?
- Tribe creator owner vs admin permissions — is there a hierarchy?

### Coach tools
- "Fix Coach Dashboard" — which specific section is broken? (client list, calendar, gifts, demo studio, all?)
- Is the coach side of the app the same APK/IPA as the user side, or a separate build?
- Coach analytics — what KPIs matter (response time, completion rate, NPS, churn)?

### Profile / settings
- Profile decluttering — does Joshua have a target structure / wireframe in mind?
- Tab consolidation — which tabs go to top?
- "Tappable tabs" — what does this mean structurally (collapsible? scroll-snap?)

### Live coaching / go live
- "Live Coaching natively inside app" — replacing Zoom with LiveKit-style? In-app picture-in-picture?
- "Go Live inside Tribe natively" — is this distinct from existing GoLiveTribe flow, or a polish item?
- Pre-call lobby / waiting room?
- Post-call session notes that the coach can review?

### Tutorials / education
- Which "basics" should the interactive tutorial cover that it currently doesn't? Specific: is it WW tabs that lack a tour?
- Are Academy modules planned by Joshua, or AI-generated?

### Food scanner / meal flow
- Cal AI–style — what's the reference for the "style" Joshua wants? (food image w/ macros + suggestion overlay? AR labeling?)
- "Meal cards to match ingredients" — is the bug that ingredients aren't loaded, or that they're loaded but don't display?
- On-the-Go meal finder — backend?

### Workout cards / content
- Custom workout videos — production schedule? talent? equipment owned vs rented?
- Demo studio current state — how many demos generated, archived, in-flight?
- Will custom videos replace YouTube IDs or augment them?

### Post-completion / re-engagement
- Win-back campaign cadence for non-purchasers
- Annual / quarterly recap formats
- Streak protection design (free skips? earnable freezes?)

### Dashboard / admin / data states
- Is there an internal dashboard (web?) for the founder to see app metrics, or only PostHog?
- Coach revenue accounting — built or out-of-app?

### Error / empty / edge cases
- Network-offline behavior expectations: optimistic UI? hard fail? cached read-only?
- Conflict resolution if same data edited on two devices

## 5.2 Architectural / cross-cutting questions

- **Is WW Upgrade going to remain a separate code path forever, or is the goal to converge with Apex MainNavigator?** Critical strategic question.
- **Is there a coach-only build of the app planned?** Currently coaches use the user app with extra unlocks.
- **Is web companion app on roadmap?** Form review benefits hugely from a desktop perspective.
- **Is on-call / customer-support process defined?** No in-app support ticket flow visible.
- **Is there a moderation team for Tribe?** Auto-mod is in place but no human-review surface.
- **What's the data retention policy?** Health conditions, lab uploads, voice recordings — all collected, no documented deletion schedule.
- **Are RLS policies tested** — what happens if a user's `user_id` is forged?
- **Is there a CI / staging environment** — no `.env.staging` visible in repo.
- **Is App Store Connect / Play Console set up** — `eas.json` is staged but app config not fully verified.

## 5.3 Operational gaps

- No documented support email / help URL surface in the app.
- No documented privacy policy / terms screens (likely needs in-app links to web pages).
- No documented incident-response runbook.
- No documented test-purchase / sandbox flow doc for QA team.
- No documented coach-onboarding playbook (how a new coach gets unlocked, what training they get).
- No documented brand-voice guide for AI coach personas.

---

# Appendix A — File Index

**Navigators (5):**
`AuthNavigator.tsx`, `MainNavigator.tsx`, `MainTabNavigator.tsx`, `WalkWaterNavigator.tsx`, `WalkWaterTabNavigator.tsx`

**Screens (37):**

*Auth:* OnboardingScreen, SignUpScreen, LoginScreen, ResetPasswordScreen
*Goal Setup:* GoalSetupScreen, GoalSetupWrapper
*Apex Tabs:* DashboardScreen, TrainScreen, FuelScreen, TribeScreen, CoachScreen, PlansScreen
*Apex Modals:* SerenaProtoScreen, FormReviewScreen, CoachDMScreen, CoachModeScreen, CoachInboxScreen, LiveCoachScreen, LabUploadScreen, ProfileScreen, UpgradeScreen, SuggestionsScreen, GoLiveTribeScreen, TribeLiveViewerScreen, PDFViewerScreen
*Shared:* WalkTrackerScreen
*WW:* WalkWaterQuizScreen, WalkWaterDashboardScreen, WalkWaterTrainScreen, WalkWaterFuelScreen, WalkWaterCommunityScreen, WalkWaterCoachScreen, WalkWaterTribeScreen, WaterLogScreen, ChallengeCompleteScreen, ApexUnlockScreen, WalkWaterFinaleScreen

**Components (23):**
AchievementCelebration, AchievementShareCard, ActiveWorkoutPanel, AppHeader, ConfettiCelebration, DemoStudio, FoodScanModal, FormReviewTempoOverlay, MealShareCard, OnboardingTutorial, PageTutorial, ProWelcomeModal, RepCounter, ScreenTemplate, SkeletonCard, StartHereCard, TempoAssistCard, TribeLiveBanner, UserProfileModal, VerifyEmailBanner, VideoPlayerModal, VisionIndicator, WeightLogModal

**Lib / services (sample, not exhaustive):**
revenuecat.ts, notifications.ts, walkWaterMode.ts, profileSync.ts, coachDM.ts, coachInvites.ts, tribeLive.ts, tribeFeed.ts, liveCoaching.ts, liveCoachingSessions.ts, demoAssets.ts, falVideoGen.ts, calendarIntegration.ts, sentry.ts, analytics.ts, achievements.ts, GamificationContext.tsx, ThemeContext.tsx, LanguageContext.tsx, AuthContext.tsx, useFormReviewVisionLoop.ts, useCoachMessageListener.ts, usePro.ts, useAppRating.ts, adminMode.ts, coachVoice.ts, proTrial.ts

**Edge functions (15+):**
anthropic, claude-vision, gemini-vision, openai-realtime-session, elevenlabs-agent-token, book-fit-call, get-coach-availability, zoom-session, tribe-live-token, tribe-live-egress, delete-account, demo-reference-studio, workout-demo, goal-preview, coach-dispatch

**Supabase tables (sample):**
profiles, workouts, workout_exercise_logs, nutrition_entries, tribes, tribe_memberships, tribe_posts, tribe_comments, tribe_live_sessions, tribe_live_comments, tribe_live_join_requests, coach_messages, coach_invites, coach_client_links, coach_notification_events, live_coaching_sessions, zoom_connections, plans, suggestions, suggestion_votes, feature_waitlist, coach_session_schedule, coaching_fit_calls, demo_assets

---

# Appendix B — Glossary

- **WW** — Walk & Water (challenge product line, lower-priced funnel into Apex)
- **Apex** — Full premium fitness/wellness platform
- **Pro** — RevenueCat entitlement that unlocks Apex paid features
- **Coach** — User with `is_coach=true` flag, has access to bio + tribe coach badge; admin-unlocked Coach Mode
- **Admin / Joshua-only** — Single-user god-mode unlocked via 9-tap-on-logo + password
- **Serena** — One of the AI coach personas; also the brand of the form-review live coaching mode
- **RepFSM** — Rep finite state machine driving the form review counter
- **LiveKit** — Realtime video infrastructure for Tribe live broadcasts
- **Zoom** — Realtime video for 1-on-1 live coaching sessions (via Zoom OAuth + Server-to-Server API)
- **`maybeShowPaywall`** — Function that decides whether to present RevenueCat paywall based on entitlement + trial status
- **Challenge finisher** — One-time $7.99 purchase offered post-WW-completion (separate RevenueCat offering)
- **`WALK_WATER_UPGRADE_EVENT`** — DeviceEventEmitter event that swaps WW tabs from Base (5) to ApexWW (6) in place
- **`isCoach`** — Boolean column on `profiles` table; gate for coach badge + bio + Tribe coach styling
- **`isAdminEnabled`** — Local function for god-mode features (Coach Mode, dev tools, mode toggle, Pro preview)

---

*End of inventory. This is a discovery document, not an audit. Prioritization, sequencing, and remediation should be a separate exercise.*
