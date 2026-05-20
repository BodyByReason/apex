# APEX / WW Reconciled Inventory & Decisions v2

## Scope

This document updates the reconciled inventory + audit with finalized decisions made on May 6 around WW banners, re-quiz behavior, coach demos, and tier boundaries. It is meant to be the single source of truth for launch behavior across WW Free, WW Upgrade, and Apex 1-on-1.

## 1. Banner and timer decisions

### 1.1 WW home banner state machine

**Decision:** Treat all Walk + Water (WW) banners on the home screen as one connected state machine, not separate ad hoc banners.[cite:1]

**States:**
- **Day 3 Pre / Live preview**
  - Banner: “Tonight’s group workout. Preview what’s coming and save your spot.”
  - Destination: Day 3 workout preview page with outline plus CTA to join live at scheduled time.
- **Day 3 Live**
  - Banner: “We’re live. Join the group workout now.”
  - Destination: live group workout room (or evergreen live-appearing replay once live has been recorded).
- **Day 3 Post – You Finished (48h)**
  - Banner: “You finished. Claim your reward. 48h remaining.”
  - Destination: challenge-finisher upgrade page with 48-hour discounted offer (7.99 for 3-day, 9.99 for longer durations).
- **You Finished (24h)**
  - Banner: “You finished. Claim your reward. 24h remaining.”
  - Destination: same upgrade page with real-time 24-hour timer.
- **Missed It**
  - Banner: “Missed the group workout? Watch the replay.”
  - Destination: replay page showing the Day 3 workout recording, available for 48h after challenge completion.
- **Don’t Stop Now (post-offer)**
  - Banner: “Don’t Stop Now. Your habit is just getting started — jump into the next challenge.”
  - Destination: WW re-quiz with unlocked durations (no gender question), auto-logged-in user.

### 1.2 Timer authenticity

**Decision:**
- The **48h and 24h timers** must be real, user-specific countdowns based on `challengeOfferExpiry` and not hardcoded text.[cite:1]
- The banner **copy itself shows a live countdown** (e.g., “48h 0m remaining”), not just the detail page.
- The detail page uses the same underlying timer source so numbers can never disagree.

### 1.3 Offer window and replay window

**Decision:**
- Group workout **replay is available for 48h** after the live session for both 3-day and longer-duration users.
- After 48h:
  - The replay access goes away.
  - The “Missed It” state transitions into “Don’t Stop Now” which sends users back into the re-quiz.

## 2. Don’t Stop Now behavior

### 2.1 Copy and intent

**Approved banner copy:**
- **Eyebrow:** KEEP THE STREAK ALIVE
- **Headline:** Don’t Stop Now.
- **Body:** Your habit is just getting started — jump into the next challenge.

**Intent:** This is a **momentum banner**, not a second pricing banner. Its job is to keep WW users moving into longer-duration challenges once the initial discount window has ended.[cite:1]

### 2.2 Destination and quiz behavior

**Decision:**
- Tapping the Don’t Stop Now banner opens the **WW re-quiz flow**.
- Re-quiz behavior:
  - **No gender step.**
  - **All durations (3, 7, 14, 21) unlocked** for prior completers.
  - User remains signed in; no new auth gate.
- Paywall behavior after re-quiz:
  - 3-day completers: see pricing ladder starting at 7.99 then 9.99.
  - Longer-duration completers: see pricing ladder starting at 9.99.

## 3. Pricing ladder decisions

### 3.1 WW challenge-finisher offers

**Decision:** Only **post-challenge offers** exist in WW; the old in-quiz 4.99 / 14.99 paywall is removed from the funnel.[cite:1]

**3-day completers:**
- Primary challenge-finisher offer: 7.99/month for 48h.
- After 48h, fallback: 9.99/month.
- After user returns later (beyond fallback window): full 19.99/month list price.

**Longer-duration completers (7, 14, 21 days):**
- Primary challenge-finisher offer: 9.99/month for 48h.
- After 48h: full 19.99/month.

### 3.2 Weekly price

**Decision:** Weekly prices are optional and **not required for launch**. If used, they are purely for A/B testing and should not clutter the main paywall copy at launch.

## 4. Quiz system decisions

### 4.1 WW quiz vs Apex quiz

**Decision:**
- **Keep WW quiz** for WW Free and WW Upgrade.
- **Keep Apex GoalSetup** for direct Apex 1-on-1 clients.
- **Add a shortened Apex migration quiz** for WW users upgrading to Apex via deep link.

### 4.2 Data carryover

WW → Apex migration rules:
- Reuse WW answers for: goal, steps baseline, water baseline, wake/sleep rhythm, and health context where available.
- Map WW goal (Lean / Energy / Confidence / Feel better) into Apex goal (Lose / Build / Recomp / Performance) via a deterministic mapping table.
- Only ask missing Apex-only fields during migration (e.g., detailed health conditions, medications, GLP-1, equipment, food preferences) instead of re-asking everything.

### 4.3 WW re-quiz after Don’t Stop Now

**Decision:**
- Re-quiz is the same underlying WalkWaterQuizScreen with:
  - Gender question skipped.
  - All duration options unlocked.
  - Auth already satisfied.

## 5. Coach demo and content decisions

### 5.1 WW upgraded workout videos

**Decision:**
- For launch, prioritize **filming and uploading custom workout videos** for upgraded WW workout cards so WW Upgrade users do not see generic or obviously demo content.[cite:1]
- YouTube fallback may remain behind the scenes but the visible content should feel like curated, real training.

### 5.2 Apex Coach Demos

**Decision:**
- All Coach Demo surfaces in Apex are **hidden from end users** until final production videos are ready.
- Implementation: feature flag or role-based gating so only coach / admin can see demo-management tools; regular Apex clients see nothing.
- This avoids Apple/App Store review risk around placeholder or misleading demo content.

### 5.3 Form review

**Decision:**
- Remove all AI-based form review flows and their UI (tempo overlays, rep counters, vision indicators).
- Keep and polish the **15-second record-and-send-to-coach** flow for Apex 1-on-1 users.
- That recording is viewable in the coach dashboard per client and is the only form review path at launch.

## 6. Tier boundaries and access

### 6.1 WW Free

- Tabs: Home, Walk, Water, Community, Coach.
- No Train / Fuel tabs.
- Access to WW quiz, challenge, group workout live + replay within 48h, challenge-finisher paywall, Don’t Stop Now re-quiz.
- Community and leaderboard must transition to real data; seeded data is considered a trust risk and scheduled for replacement.

### 6.2 WW Upgrade

- Tabs: Home, Walk, Train, Fuel, Community, Coach.
- Same community and leaderboard as WW Free (shared WW tribe), but backed by real users once seeding is removed.
- Access to AI food scanner and WW-specific training videos.
- No Apex-only “Pro” language; no Apex paywalls.

### 6.3 Apex 1-on-1

- Tabs: Dashboard, Train, Fuel, Tribe, Coach, Plans.
- Access controlled by 1-on-1 coaching purchase outside the app (Zoom call + deep link).
- No Pro/Free language or paywalls; Apex clients have full access to all features included in their coaching tier.
- Live coaching (Go Live in Tribe) reserved for Apex 1-on-1, while WW uses the group workout finale pattern.

### 6.4 Coach access

**Decision:**
- Same mobile app binary, but **coach-specific login** controls access to Coach Mode (coach dashboard, client list, coach inbox, live-session tools).
- Coach Mode, Walk-Water admin toggle, and Pro preview are **never visible** to regular WW or Apex clients.

## 7. Inbox segmentation

**Decision:**
- Single coach inbox system with segmentation by **user tier and lifecycle state**, not three separate inboxes.

Minimal segmentation:
- Filters or tags: WW Free, WW Upgrade, Apex 1-on-1.
- Status fields: new lead, booked call, challenge complete, upgraded, active 1-on-1 client, at-risk (missed 3+ days), churned.

## 8. Implementation notes for dev

1. Wire WW home banner as a deterministic state machine based on challenge status, time since completion, and purchase status.
2. Replace seeded WW leaderboards and community messages with real Supabase-backed data; keep or remove seeding only in non-production environments.
3. Remove in-quiz WW paywall; only show challenge-finisher paywalls post-completion.
4. Implement the new pricing ladder logic and ensure RevenueCat products and entitlements match the 7.99/9.99/19.99 structure.
5. Gate Coach Demos and Coach Mode behind coach login; hide from clients.
6. Implement WW→Apex migration quiz and data carryover, including goal-mapping.
7. Remove all AI form review UX; keep the 15-second recording path and wire recordings to the coach dashboard.

---

This v2 document supersedes prior ambiguous notes about Don’t Stop Now, coach demos, and Pro/Free language in Apex. It should be treated as the reference for May 12 challenge launch behavior.
