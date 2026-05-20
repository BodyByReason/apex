# APEX Next Steps

## 1. Finish Current QA Pass

- Apply the latest Supabase migration:
  - `npx supabase@latest db push`
- Verify language selection persists after onboarding and app restart.
- Verify profile photo upload updates both Profile and the top-right header avatar.
- Verify badge sharing opens an image share sheet from:
  - Profile
  - Achievement unlock modal
- Verify feature voting:
  - submit suggestion
  - upvote
  - remove vote
- Verify walk tracker:
  - open from Dashboard steps tile
  - grant location
  - start walk
  - stop walk

## 2. Build the New BMR / Calories / Macros Onboarding Step

- After login and after language + color selection, ask for:
  - current weight
  - current age
  - current height
  - goal weight
- Calculate and show:
  - estimated BMR
  - daily calorie target
  - macro targets
  - lean-out targets for roughly `1–3 lbs/week`
- Persist these values in the user profile so they can drive the rest of the app.

## 3. Add the Tutorial + Free/Paid Plan Explainer Screen

- Show a tutorial walkthrough explaining how to use:
  - HOME
  - TRAIN
  - FUEL
  - TRIBE
  - COACH
  - PLANS
- Add a tutorial video section.
- Explain what the user gets for free.
- Explain paid options like:
  - AI Coach
  - live 1-on-1 coaching
  - group coaching

## 4. Connect Onboarding Targets into Fuel and Coach

- Use saved calorie + macro targets in Fuel.
- Use those targets when scanning food and giving next-meal guidance.
- Use the onboarding profile in Coach so advice reflects:
  - current weight
  - goal weight
  - calorie target
  - macro targets
  - overall goal

## 5. Resume iOS / Dev Client Work Once Apple Approves the Account

- Build and install iOS dev client.
- Re-test native flows outside Expo Go:
  - HealthKit
  - RevenueCat
  - maps/location
  - notifications
- Continue TestFlight / App Store preparation.
