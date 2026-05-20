# APEX Reconciled Inventory and Audit Foundation

This document merges the code-grounded inventory with founder clarification notes so the product record reflects both what exists in code and what is intended in the product direction. The source inventory mapped 37 screens, 23 components, 5 navigators, 30+ Supabase tables, and 15+ edge functions across WW Free, WW Upgrade, and Apex.[file:84] The inventory also established a three-stage journey—WW Free, WW Upgrade, and Apex 1-on-1—with WW Upgrade and Apex running as parallel implementations of similar concepts, which is the largest structural drift risk in the app.[file:84]

## Reconciliation method

The base inventory classified features as Confirmed, Likely, or Implied, where Confirmed means found directly in code, Likely means partially wired or strongly suggested, and Implied means referenced in notes or adjacent flows without a verified implementation path.[file:84] The founder notes then clarified which items are intentionally absent, which are planned but not built, which should be removed, and which need to be redefined before audit prioritization begins.[file:84]

The goal of this reconciled version is not to restate every screen from the original file, but to correct the highest-impact ambiguities so the next audit is based on the real product plan instead of code-only assumptions.[file:84]

## Product model

The intended product journey is: WW Free, then WW Upgrade, then Apex 1-on-1; Apex is not just a more unlocked version of WW Upgrade, but a separate premium destination for paid 1-on-1 clients.[file:84] WW Upgrade should feel similar to Apex but simpler, while Apex should feel more advanced and deeper without breaking continuity from the earlier WW experience.[file:84]

A user does not automatically move from WW Upgrade into Apex just by upgrading; the move into Apex happens later through a deep-link flow after a coach-led sales conversation and payment for 1-on-1 coaching.[file:84] Existing external clients migrating into Apex should use a different deep-link path and a fuller onboarding quiz because they did not go through the WW challenge funnel first.[file:84]

## Stage definitions

| Stage | Reconciled definition | Status |
|---|---|---|
| WW Free | Entry challenge product focused on walk, water, community, and coach funneling into a completion offer.[file:84] | Confirmed in code and notes.[file:84] |
| WW Upgrade | Paid continuation of WW with Train and Fuel unlocked, but still distinct from Apex and still part of the WW ecosystem.[file:84] | Confirmed with founder clarification.[file:84] |
| Apex 1-on-1 | Separate premium app experience for paid coaching clients, entered by deep link and not intended for WW users by default.[file:84] | Confirmed with founder clarification.[file:84] |
| Migration path for existing coaching clients | Separate path into Apex using a longer onboarding flow because those users skipped WW challenge discovery.[file:84] | Planned and needs implementation.[file:84] |

## Core reconciliations

### Navigation and access

The original inventory correctly identified two physical navigator stacks and a large amount of feature overlap between WW Upgrade and Apex.[file:84] The founder clarified that Apex should only be accessible for paid 1-on-1 clients, while WW Free and WW Upgrade users should remain in the WW environment unless explicitly moved into Apex through the coaching sales flow.[file:84]

The inventory assumed WW and WW Upgrade likely shared access to Profile because the same screen appeared reachable in code, but the founder clarified that Profile should only be accessible to Apex 1-on-1 users and this restriction is intentional.[file:84] The coach should still be able to inspect WW Free, WW Upgrade, and Apex experiences for testing and updates, but that access should not expose coach tooling to regular users.[file:84]

### Coach access and dashboard

The inventory identified CoachModeScreen and multiple coach/admin tools behind gesture and password gates.[file:84] The founder clarified that this is not sufficient for production, and that the coach side needs a separate login so a user cannot stumble into coaching tools by inspecting source, unlocking admin mode, or finding hidden routes.[file:84]

The coach dashboard was not simply “buggy”; the founder clarified that it needs a full redesign and simplification while still preserving the underlying feature set.[file:84] The intended coach dashboard should provide a high-level operational view across clients, finances, challenge performance, conversion, retention, and direct client state, plus easier drill-down into workouts, nutrition, and plans.[file:84]

### DM and coach funnel

The inventory correctly found that WW Free and WW Upgrade share the same DM flow and that any DM bug likely affects both editions.[file:84] The founder clarified that this shared DM flow should remain for WW Free and WW Upgrade, but Apex 1-on-1 users do not need the same booking DM because by the time they are in Apex they have already booked with the coach or migrated as existing clients.[file:84]

The DM booking flow currently appears to support coach-side calendaring more than user-side scheduling, and the founder clarified that booked sessions should also get onto the user's calendar, not just rely on a morning reminder message from the coach.[file:84] There is also no clear inbox separation between WW Free, WW Upgrade, and Apex users from the coach perspective, which should be treated as a real product gap rather than a mere documentation issue.[file:84]

### “Point At It” clarification

The original inventory flagged “Point At It” as missing because it did not find a clearly named feature in code.[file:84] The founder clarified that “Point At It” is the button used to take a photo of food for the AI scanner inside WW Upgrade, and the requested fix is a UI consistency fix so its font and size match the DM Coach button.[file:84]

This means the issue is no longer “unknown feature not found,” but “known scanner entry-point with unresolved naming or UI mismatch.”[file:84] It should therefore move from Implied-unclear into Confirmed product intent with implementation verification still needed.[file:84]

### Banners, timers, and challenge re-engagement

The inventory found the core 48-hour post-challenge countdown logic in code, but could not verify the persistent top-of-screen banner system described in the notes.[file:84] The founder clarified that the “You Finished,” “48h,” “24h,” “Missed It,” and “Don’t Stop Now” experiences are real intended surfaces at the top of the screen and should open corresponding pages tied to the Day 3 Pre, Day 3 Live, and Day 3 Post workout states.[file:84]

The founder also clarified that the group workout replay should be available for 48 hours after challenge completion, then the Don’t Stop Now banner should appear, and the Missed It banner should appear if the user completed the challenge but missed the live group workout and needs replay access.[file:84] As a result, these features should be treated as planned-but-incomplete rather than theoretical or speculative.[file:84]

### Challenge continuity and streak logic

The inventory correctly identified uncertainty about what happens to WW streaks during upgrade transitions and Apex entry.[file:84] The founder clarified that WW streak should continue at all times across Free, Upgrade, and Apex for users who came through the WW flow, while external clients who migrate directly into Apex are the exception because they never participated in the challenge.[file:84]

The founder also confirmed that the missed-day system is not set up yet, which means the inventory’s concerns about missing missed-day logic are real and unresolved.[file:84] This makes streak continuity a confirmed product rule with incomplete implementation.[file:84]

### Leaderboard and community authenticity

The inventory found hardcoded WW leaderboard seed data and seeded community messages using fake names such as Maria G., Aisha K., Chris R., James T., and Priya S., which is a major trust risk.[file:84] The founder confirmed that WW community and leaderboard should use real data, and that Free WW and Upgraded WW users should share the same real leaderboard and community chat.[file:84]

The founder also clarified that Apex should have its own separate tribe environment for 1-on-1 clients.[file:84] The Apex leaderboard is intended to track workouts completed, meals logged, and level, and it already has three scopes—This Week, This Month, and All Time—while WW leaderboard remains challenge-specific around steps, water, and streaks.[file:84]

### Live coaching and go-live surfaces

The inventory identified two different live surfaces: a WW group-workout finale flow and an Apex tribe/live-coaching flow.[file:84] The founder clarified that these are intentionally separate concepts: WW go-live is for the coach running the challenge finale, while Apex go-live is for tribe announcements and Apex 1-on-1 live sessions.[file:84]

For WW, the founder wants an evergreen group-workout replay model so longer-duration users can experience the finale without requiring the coach to always go live again.[file:84] For Apex 1-on-1 users, the live coaching screen exists but is too cluttered, and the desired simplification is a cleaner user-facing surface with just essential actions such as Join Session and Reschedule Workout.[file:84]

### Form review removal

The inventory surfaced a large AI form-review stack including FormReviewScreen, SerenaProtoScreen, FormReviewTempoOverlay, VisionIndicator, RepCounter, TempoAssistCard, and related AI vision workflows.[file:84] The founder clarified that anything related to AI reviewing user form should be removed, including tempo overlay, tempo assistance, rep counter, and vision indicator, while preserving the ability for users to record a 10–15 second clip and send it directly to Coach Josh for manual review.[file:84]

This is a major reconciliation because the code inventory treated form review as an active flagship feature, while the product direction now treats AI form review as deprecated and manual coach review as the retained behavior.[file:84] Live Serena and Live Marcus may still remain as voice-driven workout assistants, but not as AI form-review systems.[file:84]

### Food scanner and meal scope

The inventory correctly found that WW Upgrade has a simpler food/fuel path and Apex has the deeper scanner and meal system.[file:84] The founder clarified that this separation is intentional: WW Upgrade gets the simpler scanner, while APEX 1-on-1 gets the more advanced Cal AI-style UI, suggestions, meal plans, grocery list assistant, and related premium nutrition features.[file:84]

The founder also clarified that only a few WW meal cards need manual fixing and that custom workout videos will be uploaded manually over time.[file:84] That means some flagged “meal mismatch” and “video gap” items are not conceptual gaps, but content-production gaps.[file:84]

### Apex profile restructuring

The inventory noted clutter in the Apex profile and categorized several issues as UX feedback rather than feature gaps.[file:84] The founder clarified the intended structure more precisely: the profile should focus only on the Apex user, remove coach-related profile items, order sections as Stats, Before and After, then Personalization, use collapsible sections to conserve space, and end with Delete Account at the bottom.[file:84]

This means the profile issue is not just “too cluttered,” but a confirmed restructuring requirement with a target order and content boundary.[file:84] Coach-related controls should move into the separate coach section rather than remain visible in the client-facing profile.[file:84]

## Reconciled status map

| Topic | Claude inventory status | Reconciled status |
|---|---|---|
| WW Free / WW Upgrade / Apex stage model | Confirmed but code-centric.[file:84] | Confirmed and clarified by founder journey rules.[file:84] |
| WW users access full Profile screen | Likely shared screen in code.[file:84] | Intentionally should not be user-accessible outside Apex.[file:84] |
| Point At It | Implied, not found in code.[file:84] | Clarified as WW Upgrade food-scan camera button; UI fix required.[file:84] |
| You Finished / 48h / 24h / Missed It / Don’t Stop Now banners | Partially found or not found.[file:84] | Confirmed product intent; implementation incomplete or fragmented.[file:84] |
| WW streak behavior across upgrade and Apex | Unclear in code.[file:84] | Confirmed requirement: streak should continue across WW-origin users.[file:84] |
| WW leaderboard authenticity | Confirmed fake seed data.[file:84] | Confirmed must become real-data leaderboard for Free + Upgrade.[file:84] |
| WW community authenticity | Confirmed fake seeded messages.[file:84] | Confirmed must become real community for Free + Upgrade.[file:84] |
| Apex tribe separation | Confirmed distinct Apex tribe surface.[file:84] | Confirmed and intentionally separate from WW community.[file:84] |
| Apex DM booking flow | Confirmed in code.[file:84] | Should be removed for Apex user journey.[file:84] |
| AI form review stack | Confirmed in code.[file:84] | Deprecated by product direction; replace with coach-reviewed clip submission.[file:84] |
| Coach dashboard access | Hidden/admin unlock in same app.[file:84] | Needs separate coach login and redesigned dashboard.[file:84] |
| Live coaching in Apex | Confirmed but cluttered and partially Zoom-based.[file:84] | Keep concept, simplify user UI, move toward native in-app session flow.[file:84] |
| WW finale live/replay | Confirmed with unclear replay handling.[file:84] | Confirmed feature direction: live when possible, evergreen replay for longer-duration users.[file:84] |

## Build-vs-remove reconciliation

### Confirmed to keep and improve

- WW Free to WW Upgrade to Apex 1-on-1 progression.[file:84]
- Shared WW DM booking funnel for Free and Upgrade users.[file:84]
- Separate Apex tribe environment for 1-on-1 clients.[file:84]
- Live WW finale concept, including replay path for longer-duration users.[file:84]
- APEX food scanner and advanced nutrition system, upgraded with Cal AI-style UX.[file:84]
- User ability to send a short exercise video to Coach Josh for manual review.[file:84]
- Coach visibility across all product editions for testing and operational oversight.[file:84]

### Confirmed to remove or phase out

- AI form review and related visual-analysis stack.[file:84]
- Pro/free language inside the Apex 1-on-1 experience.[file:84]
- Apex-side DM booking flow for users already in 1-on-1 coaching.[file:84]
- User-visible coach/admin tools inside normal Apex client flows.[file:84]
- Temporary seeded leaderboard and seeded WW community content once real data is ready.[file:84]
- Admin WalkWaterMode toggle as a long-term production mechanism once the full app is complete.[file:84]

### Confirmed to build or complete

- Separate coach login and protected coach dashboard.[file:84]
- Reworked coach operations dashboard with finance, client, conversion, retention, and challenge views.[file:84]
- Re-engagement banner system: You Finished, 48h, 24h, Missed It, and Don’t Stop Now.[file:84]
- Real WW leaderboard and real WW community chat.[file:84]
- User-side calendar inclusion in DM booking flow.[file:84]
- WW missed-day system and streak-recovery logic.[file:84]
- Deep-link migration flows for WW-to-Apex and current-client-to-Apex onboarding.[file:84]
- Simpler Apex live-coaching client screen.[file:84]
- Custom workout video uploads and coach demo completion.[file:84]

## Audit foundation

The audit below converts the reconciled inventory into execution-ready findings. It focuses on UX clarity, conversion, retention, trust/authenticity, native app experience, and coach-to-user interaction quality, using the reconciled record rather than the raw code inventory alone.[file:84]

## Audit findings

### 1. Trust and authenticity

#### WW leaderboard and WW community are the highest trust risk

**Feature / Page:** WW Community, WW Leaderboard, WW Upgrade Community  
**Problem:** WW Free and WW Upgrade currently show seeded fake leaderboard and chat content as if it were authentic member activity, including hardcoded names and fake member counts.[file:84]  
**Why it matters:** This is the fastest way to destroy trust for both free users and paying upgraders because fake social proof in a community product feels deceptive, not aspirational.[file:84]  
**Recommended solution:** Replace seeded leaderboard and seeded chat with real-data pipelines, or temporarily label all non-live data as sample/demo content until authenticity is fully ready.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Should old fake data be removed entirely on launch, or is there a fallback empty-state strategy for low-volume real communities?[file:84]  
**Priority:** Critical  
**Effort:** Medium  
**Suggested owner:** Backend / Frontend / Product / QA

#### Banner authenticity is defined in product but incomplete in implementation

**Feature / Page:** WW post-challenge banners and timers  
**Problem:** The intended You Finished, 48h, 24h, Missed It, and Don’t Stop Now banner system is only partially present in code, with countdown logic existing in places but not as a complete persistent top-banner system.[file:84]  
**Why it matters:** These banners control the most sensitive conversion and retention moments in the WW journey, so inconsistency here creates confusion, weakens urgency, and makes the system feel fake.[file:84]  
**Recommended solution:** Build a single banner-state engine driven by challenge completion, finale attendance, replay expiry, purchase status, and elapsed time, then reuse it across WW Free and WW Upgrade.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Which screens should always display these banners, and what are the exact state transitions between You Finished, 48h, 24h, Missed It, and Don’t Stop Now?[file:84]  
**Priority:** Critical  
**Effort:** Large  
**Suggested owner:** Product / Frontend / Backend / QA

### 2. Product architecture

#### WW Upgrade and Apex are still parallel products with drift risk

**Feature / Page:** WW Upgrade and Apex core surfaces  
**Problem:** WW Upgrade and Apex duplicate many of the same ideas—dashboard, train, fuel, community/tribe, and coach—through separate code paths.[file:84]  
**Why it matters:** Every bug fix, UX upgrade, and content improvement risks being applied to one branch and missed in the other, which compounds quality drift and slows iteration.[file:84]  
**Recommended solution:** Define a shared component and logic strategy where possible, and explicitly document which surfaces are intentionally simpler in WW Upgrade versus intentionally deeper in Apex.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Which WW Upgrade experiences are meant to stay simplified forever, and which should mirror Apex closely enough to justify shared code or shared design contracts?[file:84]  
**Priority:** High  
**Effort:** Large  
**Suggested owner:** Product / Engineering / Design

#### Stage transitions need explicit deep-link rules

**Feature / Page:** WW-to-Apex conversion and current-client migration  
**Problem:** The product direction requires separate deep-link paths for WW-origin users and for existing coaching clients, but this migration framework is not fully implemented or documented.[file:84]  
**Why it matters:** Without deterministic transitions, users may get the wrong onboarding, repeat questions unnecessarily, or land in product editions they should not see.[file:84]  
**Recommended solution:** Create two explicit entry contracts: one for WW-origin clients carrying over WW quiz data into a shortened Apex onboarding, and one for existing clients entering a fuller Apex onboarding flow.[file:84]  
**Questions or enhancement ideas to confirm before starting:** What specific WW answers should map into the shortened Apex onboarding, and which HIPAA-adjacent or coaching-specific questions are still required later?[file:84]  
**Priority:** High  
**Effort:** Large  
**Suggested owner:** Product / Backend / Frontend

### 3. Coach systems

#### Coach access model is not production-safe yet

**Feature / Page:** Coach dashboard and coach-only surfaces  
**Problem:** Coach tooling currently relies on in-app hidden/admin access patterns rather than a clean separate coach login and protected coach-facing environment.[file:84]  
**Why it matters:** This creates security, trust, and product-boundary problems because users should never be able to stumble into coaching surfaces intended only for operations and client management.[file:84]  
**Recommended solution:** Create a separate coach login and route boundary, move coach-only profile items out of the client profile, and isolate the coach dashboard from normal user navigation.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Should coach login be a distinct build, a distinct auth role with separate route protection, or a completely separate app shell?[file:84]  
**Priority:** Critical  
**Effort:** Large  
**Suggested owner:** Product / Backend / Frontend / Security

#### Coach dashboard requires full redesign, not just bug fixing

**Feature / Page:** CoachModeScreen and coach operational dashboard  
**Problem:** The current dashboard is too cluttered and does not present the coach with the right operational overview or clean drill-downs.[file:84]  
**Why it matters:** If the coach cannot quickly see client state, business state, and conversion/retention signals, the coaching business becomes harder to run even if the raw data technically exists.[file:84]  
**Recommended solution:** Redesign the dashboard around a 30,000-foot overview first, then add clear drill-down modules for clients, DMs, finances, challenge performance, conversion, retention, and content/admin controls.[file:84]  
**Questions or enhancement ideas to confirm before starting:** What are the top five coach decisions the dashboard should support daily, weekly, and monthly?[file:84]  
**Priority:** Critical  
**Effort:** Large  
**Suggested owner:** Product / Design / Frontend / Backend

### 4. Messaging and booking

#### DM flow should remain in WW, not Apex

**Feature / Page:** CoachDMScreen, WW Coach flows, Apex Coach flows  
**Problem:** Apex still contains a DM booking-style flow even though the intended product journey says Apex users should already have booked or migrated before entry.[file:84]  
**Why it matters:** Keeping the same booking funnel inside Apex creates redundant journeys and muddies the distinction between WW conversion and paid coaching delivery.[file:84]  
**Recommended solution:** Keep the DM booking funnel for WW Free and WW Upgrade only, and replace the Apex version with coaching support, direct access, or operational messaging relevant to active 1-on-1 clients.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Should Apex users still have direct asynchronous messaging to Coach Josh, and if so, should that live in a simpler inbox without booking logic?[file:84]  
**Priority:** High  
**Effort:** Medium  
**Suggested owner:** Product / Frontend / Backend

#### Booking flow needs two-way calendar support

**Feature / Page:** WW DM booking flow  
**Problem:** The current booking flow appears to support coach-side calendaring but not reliable user-side calendar placement and reminders.[file:84]  
**Why it matters:** Users are more likely to miss booked sessions if the booking is not embedded into their own calendar workflow, increasing no-shows and follow-up burden.[file:84]  
**Recommended solution:** Add user calendar event creation and confirmation artifacts into the booking flow, not just coach-side reminders or manual morning-of messages.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Should the app support both native calendar insertion and downloadable calendar invites?[file:84]  
**Priority:** High  
**Effort:** Medium  
**Suggested owner:** Frontend / Backend / Product

### 5. Training and form review

#### AI form review should be removed and replaced by coach-reviewed clips

**Feature / Page:** FormReviewScreen, SerenaProtoScreen, workout vision stack  
**Problem:** The codebase still contains a large AI form-review system, but the product direction is now to remove AI form analysis and keep only a short video submission to the coach.[file:84]  
**Why it matters:** Continuing to ship an unwanted and untrusted AI form-review experience wastes complexity, risks bad feedback during workouts, and conflicts with the current product strategy.[file:84]  
**Recommended solution:** Remove or hide the AI form-review surfaces and replace them with a lightweight record-send-review workflow that routes 10–15 second clips to Coach Josh with camera flip and orientation support.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Should these clips appear in the coach dashboard, coach inbox, or a dedicated form-review queue?[file:84]  
**Priority:** Critical  
**Effort:** Large  
**Suggested owner:** Product / Frontend / Backend / QA

#### Custom workout video gap is a content risk and a conversion leak

**Feature / Page:** Workout cards and exercise demos  
**Problem:** Many workout cards still rely on YouTube IDs rather than branded custom videos, especially outside the eventual Apex premium ideal.[file:84]  
**Why it matters:** YouTube-based demos dilute the brand, risk ad distractions, and can expose users to competitor content inside a premium training experience.[file:84]  
**Recommended solution:** Prioritize custom video replacement for the highest-traffic workout cards first, then define fallback behavior for any exercise still waiting on production assets.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Which 20 exercises are viewed most often and should be replaced first with branded footage?[file:84]  
**Priority:** High  
**Effort:** Medium  
**Suggested owner:** Content / Video / Product / Frontend

### 6. Profile and IA

#### Apex profile needs restructuring around the client, not the coach

**Feature / Page:** Apex Profile  
**Problem:** The current profile includes coach-related controls and is too cluttered for the intended Apex client experience.[file:84]  
**Why it matters:** A cluttered profile makes personalization feel messy and lowers the perceived quality of a premium coaching product.[file:84]  
**Recommended solution:** Rebuild the profile around a user-first information architecture with Stats, Before and After, then Personalization, using collapsible sections and keeping Delete Account at the bottom.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Which current profile items are non-negotiable for users versus coach/admin-only controls that should be removed entirely?[file:84]  
**Priority:** High  
**Effort:** Medium  
**Suggested owner:** Product / Design / Frontend

### 7. Conversion and retention

#### WW completion flow is the most important conversion engine and still incomplete

**Feature / Page:** WW ChallengeCompleteScreen, finale, re-engagement sequence  
**Problem:** The 3-day finale, winner announcement, upgrade unlock, and post-finale offer sequence is strategically central but still fragmented across screens, banners, replay windows, and incomplete follow-up states.[file:84]  
**Why it matters:** This is the biggest conversion moment in the entire funnel, so any ambiguity in the finale experience directly weakens paid upgrade performance.[file:84]  
**Recommended solution:** Treat the finale and post-finale journey as one orchestrated system: live moment, replay window, You Finished state, 48h state, 24h state, Missed It fallback, Don’t Stop Now fallback, and re-quiz re-entry.[file:84]  
**Questions or enhancement ideas to confirm before starting:** What exact copy, pricing, and fallback paths should exist for 3-day completers versus longer-duration completers who did not buy initially?[file:84]  
**Priority:** Critical  
**Effort:** Large  
**Suggested owner:** Product / Design / Frontend / Backend / Copy

#### Missed-day logic is a real retention gap

**Feature / Page:** WW challenge state machine  
**Problem:** The system does not currently have a real missed-day logic model, even though challenge continuity and streak carryover matter heavily to the founder's product strategy.[file:84]  
**Why it matters:** Without missed-day recovery, users fall out of the habit loop too easily and the challenge feels brittle instead of motivating.[file:84]  
**Recommended solution:** Define missed-day rules, banner behavior, push behavior, replay eligibility, and streak outcomes, then implement them as a formal state machine rather than scattered conditions.[file:84]  
**Questions or enhancement ideas to confirm before starting:** Should missing a day reset streak immediately, allow grace, or preserve streak under specific conditions tied to the finale and replay system?[file:84]  
**Priority:** High  
**Effort:** Medium  
**Suggested owner:** Product / Backend / Frontend

## Top 10 highest-impact fixes

1. Replace fake WW leaderboard and fake WW community content with real data.[file:84]
2. Build the full WW top-banner re-engagement system: You Finished, 48h, 24h, Missed It, Don’t Stop Now.[file:84]
3. Create a separate coach login and protected coach environment.[file:84]
4. Redesign the coach dashboard around operational clarity and business control.[file:84]
5. Remove AI form review and replace it with coach-reviewed short video submission.[file:84]
6. Clarify and implement stage-transition deep links for WW-origin clients and migrating clients.[file:84]
7. Simplify the Apex live-coaching client surface to core actions only.[file:84]
8. Fix WW missed-day and streak continuity logic across Free, Upgrade, and Apex transitions.[file:84]
9. Remove Apex DM booking flow and keep booking DM confined to WW Free and WW Upgrade.[file:84]
10. Restructure Apex profile around the user and move coach items out.[file:84]

## Quick wins under 1 day

- Rename and visually standardize the WW Upgrade Point At It button so it matches the DM Coach button styling.[file:84]
- Remove “Pro” and “Free” language from Apex 1-on-1 surfaces where access is already paid.[file:84]
- Hide coach/admin controls from normal Apex users while the separate coach login is being built.[file:84]
- Add clearer labels around any temporary demo/sample content that still cannot be removed immediately.[file:84]
- Reorder current Apex profile sections toward Stats, Before and After, and Personalization even before deeper redesign work begins.[file:84]

## Features to simplify, remove, or merge

- Remove AI form review, tempo overlay, tempo assist, rep counter, and vision indicator from the user-facing coaching flow.[file:84]
- Remove Apex DM booking flow and simplify Apex messaging to active-client support patterns.[file:84]
- Remove coach-related profile items from the Apex user profile.[file:84]
- Merge banner logic into one WW state engine rather than scattered timers and screens.[file:84]
- Reduce duplicated WW Upgrade versus Apex logic wherever the product does not intentionally require different experiences.[file:84]

## Open questions blocking development

- What exact state machine governs You Finished, 48h, 24h, Missed It, replay expiry, and Don’t Stop Now?[file:84]
- Which WW quiz answers map directly into the shortened Apex onboarding for WW-origin clients?[file:84]
- What exact pricing ladder should exist after 3-day completion versus longer-duration completion when a user declines the first offer?[file:84]
- Should the coach login live inside the same app shell with strict role routing or as a fully separate build and auth surface?[file:84]
- What is the single source of truth for coach inbox segmentation across WW Free, WW Upgrade, and Apex users?[file:84]
- Which content set is first for custom workout video replacement and coach demo completion?[file:84]

## Root cause themes

- Product stages are conceptually clear but operationally under-specified at the transition points.[file:84]
- Several high-importance conversion and trust surfaces exist in product intent but are only partially implemented in code.[file:84]
- Coach-facing workflows are overloaded into user-facing architecture instead of being isolated as a first-class coach system.[file:84]
- WW Upgrade and Apex duplicate too much logic, creating drift and maintenance overhead.[file:84]
- Legacy AI-heavy experimentation remains in the codebase even where product direction has moved toward simpler coach-led experiences.[file:84]
