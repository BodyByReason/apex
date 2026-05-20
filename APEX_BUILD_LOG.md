# 🚀 APEX APP BUILD LOG — FULL STATUS HANDOFF FOR CLAUDE AI

**Project:** APEX Health App  
**Framework:** React Native + Expo SDK 54  
**Repo:** `/Users/joshuasaunders/Documents/New project`  
**Last updated:** April 2026

---

## ✅ EVERYTHING COMPLETED SO FAR

### STEP 1 — Expo Project Initialized
- Expo SDK 54, React Native 0.81.5
- React Navigation v6 (bottom tabs)
- All dependencies installed: Supabase, RevenueCat, Expo Notifications, Expo Haptics, Expo Camera, AsyncStorage, HealthKit, react-native-svg, PostHog, Sentry
- Fonts: Bebas Neue, DM Sans, Space Mono
- Theme tokens, providers, folder structure all created
- App boots, dark shell renders, fonts load, safe area works

### STEP 2 — Navigation Shell
- 6 bottom tabs: Dashboard, Train, Fuel, Tribe, Coach, Plans
- AuthNavigator + MainTabNavigator built

### STEP 3 — Supabase Backend + AI Edge Function
- Supabase project: `nitruxotcddfkxyaosiy`
- Tables: `profiles`, `workouts`, `nutrition_entries`, `subscriptions`
- Edge Function: `anthropic` (Claude API proxy — API key never exposed to client)
- Tested and working

### STEP 4 — Auth Flow
- Onboarding, signup, login screens built
- Supabase auth with persistence working locally

### STEP 5 — Main Screens Converted
All screens exist and are wired to Supabase:
- ✅ DashboardScreen.tsx
- ✅ TrainScreen.tsx
- ✅ FuelScreen.tsx
- ✅ CoachScreen.tsx (live Claude chat via Edge Function)
- ✅ PlansScreen.tsx
- ✅ TribeScreen.tsx
- ✅ OnboardingScreen.tsx / LoginScreen.tsx / SignUpScreen.tsx

### STEP 6 — API Integrations
- **RevenueCat:** `react-native-purchases` installed, test key configured
  - Products created in dashboard: `apex_pro_monthly`, `apex_pro_annual`, `apex_coach_monthly`
  - ⚠️ Entitlements (`pro`, `coach`) and Offering (`default`) still need to be created in RevenueCat dashboard
- **Nutritionix:** Connected with food search + logging
- **HealthKit:** Code structure prepared — full testing pending iOS dev client

### STEP 7 — Push Notifications + XP Gamification
- `GamificationContext` with AsyncStorage persistence
- XP awards: workout log +10 XP, meal log +5 XP
- Level = XP / 100, displayed on Dashboard
- Expo push token registration + daily 8 PM reminder

### STEP 8 — CI/CD Pipeline (COMPLETED this session)
- **`eas.json`** hardened with 3 profiles:
  - `development` → APK, internal, channel: development
  - `preview` → APK, internal, channel: preview
  - `production` → AAB (Android) / IPA (iOS), channel: production
- **GitHub Actions** (`.github/workflows/eas.yml`) — 6 jobs:
  - TypeScript check on every push
  - Supabase Edge Functions deploy on push to main/develop
  - Android preview build on push to `develop`
  - Android + iOS production build on push to `main`
  - OTA update publish before each production build
  - Manual dispatch trigger for any platform/profile
- **`app.config.ts`** updated with `expo-updates` OTA config + `runtimeVersion` policy + Sentry plugin
- **`src/lib/sentry.ts`** — crash reporting init with PII stripping
- **`src/lib/analytics.ts`** — PostHog init with typed event catalogue

### STEP 9 — App Store Assets (COMPLETED this session)
- **`APEX_StoreAssets.docx`** created with:
  - iOS App Store listing (name, subtitle, description, keywords, What's New)
  - Google Play listing (name, short desc, full description, tags)
  - 3 IAP product definitions (IDs, prices, durations, descriptions)
  - RevenueCat paywall copy (headline, bullets, CTA, legal micro-copy)
  - Privacy Policy (ready to paste on a public webpage)
  - Screenshot guide (sizes, 6 screenshot briefs, design spec, tools)

### Android Build
- ✅ EAS Android build working — APK generated successfully
- Fixed: removed `expo-barcode-scanner` (deprecated in SDK 54), using `expo-camera` instead
- Fixed: `babel-preset-expo` missing — installed

---

## ⚙️ ENVIRONMENT — ALL KEYS CONFIGURED

File: `/Users/joshuasaunders/Documents/New project/.env` (gitignored ✓)

| Variable | Status |
|---|---|
| EXPO_PUBLIC_SUPABASE_URL | ✅ `https://nitruxotcddfkxyaosiy.supabase.co` |
| EXPO_PUBLIC_SUPABASE_ANON_KEY | ✅ configured |
| EXPO_PUBLIC_EAS_PROJECT_ID | ✅ `559c2858-00ff-4501-a270-1c4341868f17` |
| EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY | ✅ test key configured |
| EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY | ✅ test key configured |
| EXPO_PUBLIC_SENTRY_DSN | ✅ configured |
| SUPABASE_ACCESS_TOKEN | ✅ configured |
| SUPABASE_PROJECT_REF | ✅ `nitruxotcddfkxyaosiy` |
| SENTRY_AUTH_TOKEN | ✅ configured |
| SENTRY_ORG | ✅ `bodybyreason` |
| EXPO_PUBLIC_NUTRITIONIX_APP_ID | ⚠️ empty — add when ready |
| EXPO_PUBLIC_POSTHOG_API_KEY | ⚠️ empty — add when ready |

---

## ⏳ IMMEDIATE NEXT STEPS (IN ORDER)

### 1. Install 2 missing packages locally
```bash
cd "/Users/joshuasaunders/Documents/New project"
npx expo install expo-updates
npx expo install @sentry/react-native
```

### 2. Add GitHub Secrets
Go to: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

| Secret Name | Value |
|---|---|
| `EXPO_TOKEN` | (your Expo access token) |
| `SUPABASE_ACCESS_TOKEN` | (in your .env) |
| `SUPABASE_PROJECT_REF` | `nitruxotcddfkxyaosiy` |
| `SENTRY_AUTH_TOKEN` | (in your .env) |
| `SENTRY_ORG` | `bodybyreason` |

Also add a **Variable** (not secret): `IOS_BUILDS_ENABLED = false`  
(Flip to `true` once Apple Developer account is approved)

### 3. Finish RevenueCat Dashboard Setup
In RevenueCat dashboard (revenuecat.com):

**Create Entitlements** (Monetization → Entitlements → New):
- Name: `pro` → attach `apex_pro_monthly` and `apex_pro_annual`
- Name: `coach` → attach `apex_coach_monthly`

**Create Offering** (Monetization → Offerings → New):
- Identifier: `default`
- Add packages: Monthly ($19.99), Annual ($149.99), Coach ($49.99)

### 4. UI Audit — Match React Native Screens to HTML Prototype
The HTML prototype (shared at project start) is the gold standard for how the app should look. The React Native screens need to match it pixel-for-pixel before App Store submission.

Ask Claude to:
> "Read each screen file in `/Users/joshuasaunders/Documents/New project/src/screens/` and compare them to the HTML prototype. For each screen, list what's missing or different from the prototype UI, then rewrite each screen to match exactly."

Attach the original HTML prototype file when asking.

### 5. Wire Paywall + Entitlement Checks
Once RevenueCat entitlements are set up, ask Claude to:
> "Update `PlansScreen.tsx` to show the RevenueCat paywall using `react-native-purchases-ui`. Gate the AI Coach screen so free users see an upsell modal. Check the `pro` entitlement using `Purchases.getCustomerInfo()` before allowing access."

### 6. iOS Build — Waiting on Apple
- Apple Developer membership paid, team approval pending
- Once approved: go to GitHub repo → Actions → Run workflow → platform: ios, profile: production
- OR run locally: `eas build --platform ios --profile production`
- Then test: HealthKit, RevenueCat native paywall, push notifications
- Then: TestFlight → invite 20-50 beta testers

### 7. Host Privacy Policy + Support URL
Before App Store submission, these URLs must be live:
- `https://yourdomain.com/privacy` — paste the Privacy Policy from `APEX_StoreAssets.docx`
- `https://yourdomain.com/support` — a basic support page or email redirect

Simple option: create a free Notion page or GitHub Pages site.

### 8. App Store Screenshots
Create 6 screenshots per the guide in `APEX_StoreAssets.docx`:
- Required sizes: 6.7" (iPhone 15 Pro Max) and 5.5" (iPhone 8 Plus)
- Recommended tool: Figma for overlays + Rotato for device frames
- Use real populated screens — no placeholder data

### 9. Production Supabase RLS Audit
Ask Claude to:
> "Review `/Users/joshuasaunders/Documents/New project/supabase/migrations/001_init_schema.sql` and audit Row Level Security. Every table must have RLS enabled and policies that ensure users can only read/write their own data."

### 10. App Store Connect Setup (when Apple account active)
- Create app in App Store Connect
- Enter all copy from `APEX_StoreAssets.docx`
- Add IAP products (same 3 IDs: `apex_pro_monthly`, `apex_pro_annual`, `apex_coach_monthly`)
- Update `eas.json` submit block with your `appleId`, `ascAppId`, `appleTeamId`

---

## 🔑 KEY FILES REFERENCE

| File | Purpose |
|---|---|
| `src/screens/*.tsx` | All app screens |
| `src/lib/supabase.ts` | Supabase client |
| `src/lib/revenuecat.ts` | RevenueCat init |
| `src/lib/sentry.ts` | Crash reporting |
| `src/lib/analytics.ts` | PostHog events |
| `src/lib/notifications.ts` | Push notifications |
| `src/contexts/AuthContext.tsx` | Auth state |
| `src/contexts/GamificationContext.tsx` | XP + levels |
| `src/navigation/MainTabNavigator.tsx` | Bottom tabs |
| `supabase/functions/anthropic/` | Claude API proxy |
| `supabase/migrations/001_init_schema.sql` | DB schema |
| `eas.json` | Build profiles |
| `.github/workflows/eas.yml` | CI/CD pipeline |
| `app.config.ts` | Expo config + plugins |
| `.env` | All API keys (gitignored) |
| `APEX_StoreAssets.docx` | App Store copy + screenshots guide |

---

## 📊 OVERALL PROGRESS

| Phase | Status |
|---|---|
| Phase 1: Foundation & Setup | ✅ Complete |
| Phase 2: Convert Prototype to React Native | ✅ Screens built — UI audit needed |
| Phase 3: Backend & Data Layer | ✅ Core complete — RLS audit needed |
| Phase 4: App Store Configuration | 🔄 In progress — waiting on Apple |
| Phase 5: Testing & QA | ⏳ Not started |
| Phase 6: Submission & Launch | ⏳ Blocked on Apple + UI audit |

**Estimated time to App Store from today: 60–90 days**

---

## 💬 HOW TO CONTINUE IN CLAUDE CHAT

Paste this entire file into a new Claude chat, then add your specific request. Example:

> "Here is my APEX app build log. [paste this file] I need you to do the UI audit — read each screen file and compare it to the HTML prototype below, then rewrite each screen to match exactly. Here is the prototype: [paste HTML]"

Or:

> "Here is my APEX app build log. [paste this file] Do the Supabase RLS audit on my schema file. Here is the SQL: [paste SQL]"

---

*APEX Health Platform · Build Log v1.0 · April 2026 · Confidential*
