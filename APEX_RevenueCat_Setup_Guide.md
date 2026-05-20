# APEX — RevenueCat Subscription Configuration Guide

## Overview

| Item | Value |
|---|---|
| Entitlement | `pro` |
| Offering | `default` |
| Monthly Product ID | `apex_pro_monthly` |
| Annual Product ID | `apex_pro_annual` |
| Monthly Price | $19.99 / month |
| Annual Price | $149.99 / year |
| Free Trial | 3 days (monthly only — see rationale below) |

---

## Part 1 — App Store Connect

### Prerequisites
- Your app record exists in App Store Connect
- You have an active Paid Apps agreement in the Agreements section

### Step 1 — Create a Subscription Group

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **APEX**
2. In the left sidebar under **Features**, click **Subscriptions**
3. Click **+ (Create)** next to Subscription Groups
4. Name it **APEX Pro** (this is internal only; users never see it)
5. Click **Create**

> The subscription group is how Apple handles upgrades, downgrades, and trial eligibility. All your APEX subscription tiers belong in **one group**.

---

### Step 2 — Create the Monthly Product

Inside the **APEX Pro** group, click **+ Add Subscription** and fill in:

| Field | Value |
|---|---|
| Reference Name | `APEX Pro Monthly` |
| Product ID | `apex_pro_monthly` |

Click **Create**, then configure the product:

**Subscription Duration:** 1 Month

**Subscription Prices:**
1. Click **+ Add Subscription Price**
2. Select currency: **USD**
3. Set price: **$19.99**
4. Click **Next** → Apple auto-generates international prices. Review and confirm.

**Free Trial (Introductory Offer):**
1. Under **Subscription Prices**, find **Introductory Offer** and click **+ Add Introductory Offer**
2. Set **Type** to **Free Trial**
3. Set **Duration** to **3 Days**
4. Click **Save**

> Apple automatically limits introductory offers to users who have never had a subscription in this group before. You do not need to handle this in code — RevenueCat surfaces eligibility automatically.

**Localization:**
1. Click **+ Add Localization**
2. Select **English (U.S.)**
3. Fill in:
   - **Subscription Display Name:** `APEX Pro Monthly`
   - **Description:** `Unlock full access to APEX with a monthly subscription.`
4. Click **Save**

**Subscription Group Level:** Set this to **1** (since this is your only tier, it doesn't matter, but set it for correctness)

**Review Information:** Add a screenshot of the paywall or subscription screen. This is required for App Store Review.

---

### Step 3 — Create the Annual Product

Back in the **APEX Pro** group, click **+ Add Subscription** again:

| Field | Value |
|---|---|
| Reference Name | `APEX Pro Annual` |
| Product ID | `apex_pro_annual` |

Click **Create**, then:

**Subscription Duration:** 1 Year

**Subscription Prices:**
1. Click **+ Add Subscription Price**
2. Select **USD**, set price to **$149.99**
3. Confirm international pricing

**No Free Trial on Annual** — see the rationale in Part 5.

**Localization:**
- **Display Name:** `APEX Pro Annual`
- **Description:** `Unlock full access to APEX with an annual subscription. Best value.`

**Subscription Group Level:** Set to **1** (same as monthly — they're the same tier, just different billing frequencies)

---

### Step 4 — Submit for Review

Apple reviews subscription products as part of your app binary review. You **do not** submit them independently. When you submit a new build, the associated subscription products are included. Make sure both products show **Ready to Submit** status.

---

## Part 2 — Google Play Console

### Prerequisites
- Your app is created in Google Play Console
- You have a **Google Play Android Developer** account with billing enabled
- Your app has been published to at least the Internal Testing track (Play requires a published app to activate in-app products)

### Step 1 — Open Subscriptions

1. Go to [Google Play Console](https://play.google.com/console) → **APEX**
2. In the left sidebar, go to **Monetize** → **Products** → **Subscriptions**

---

### Step 2 — Create the Monthly Subscription

Click **Create subscription** and fill in:

| Field | Value |
|---|---|
| Product ID | `apex_pro_monthly` |
| Name | `APEX Pro Monthly` |
| Description | `Unlock full access to APEX with a monthly subscription.` |
| Status | Active |

Click **Save**.

**Create a Base Plan:**

After saving, click **Add base plan**:

| Field | Value |
|---|---|
| Base Plan ID | `monthly-base` |
| Renewal type | Auto-renewing |
| Billing period | 1 month |

Click **Add prices**:
- Select **United States** → **$19.99**
- Click **Set other region prices** to auto-generate international prices. Review and confirm.

Click **Save** on the base plan, then **Activate** it.

**Create an Offer (Free Trial):**

With the base plan saved, click **Add offer**:

| Field | Value |
|---|---|
| Offer ID | `monthly-trial` |
| Offer type | **Free trial** |
| Trial duration | **3 days** |
| Eligibility criteria | **New customer acquisition** (users who have never subscribed before) |

Click **Save**, then **Activate** the offer.

> On Google Play, "New customer acquisition" eligibility means the user has never had this subscription product before on their Google account. This mirrors Apple's behavior.

---

### Step 3 — Create the Annual Subscription

Click **Create subscription** again:

| Field | Value |
|---|---|
| Product ID | `apex_pro_annual` |
| Name | `APEX Pro Annual` |
| Description | `Unlock full access to APEX with an annual subscription. Best value.` |
| Status | Active |

Click **Save**.

**Create a Base Plan:**

| Field | Value |
|---|---|
| Base Plan ID | `annual-base` |
| Renewal type | Auto-renewing |
| Billing period | 1 year |

Add price: **United States → $149.99**. Generate international prices. Save and **Activate**.

**No offer/trial on annual** — see Part 5.

---

### Step 4 — Grant RevenueCat Service Account Access

RevenueCat needs a Google Play service account to validate purchases and receive renewal notifications.

1. In Play Console → **Setup** → **API access**
2. Link to a Google Cloud project (or create one)
3. Click **Create new service account** → follow the Google Cloud Console link
4. In Google Cloud Console: create the service account, assign the role **Service Account Token Creator**, download the JSON key
5. Back in Play Console → grant the service account these permissions:
   - **View financial data** ✓
   - **Manage orders and subscriptions** ✓
6. In RevenueCat dashboard → your app → **Configuration** → paste the JSON key

---

## Part 3 — RevenueCat Dashboard

### Step 1 — Create the App

1. Go to [app.revenuecat.com](https://app.revenuecat.com)
2. **Projects** → **+ Create new project** → name it **APEX**
3. Add an **App Store** app:
   - App Name: `APEX`
   - Bundle ID: (your Expo bundle ID, e.g., `com.yourname.apex`)
   - App Store Connect API key: generate one in App Store Connect → **Users and Access** → **Integrations** → **In-App Purchase** (use Key Type: **In-App Purchase**)
4. Add a **Google Play** app:
   - Package Name: (your app's package name)
   - Service Account Credentials JSON: (the file from Part 2, Step 4)

---

### Step 2 — Add Products

Go to **Products** in the left sidebar → **+ New**:

**Product 1:**

| Field | Value |
|---|---|
| Identifier | `apex_pro_monthly` |
| App Store Product ID | `apex_pro_monthly` |
| Play Store Product ID | `apex_pro_monthly` |
| Play Store Base Plan ID | `monthly-base` |

**Product 2:**

| Field | Value |
|---|---|
| Identifier | `apex_pro_annual` |
| App Store Product ID | `apex_pro_annual` |
| Play Store Product ID | `apex_pro_annual` |
| Play Store Base Plan ID | `annual-base` |

---

### Step 3 — Create the Entitlement

Go to **Entitlements** → **+ New**:

| Field | Value |
|---|---|
| Identifier | `pro` |
| Description | `Full access to APEX Pro features` |

Attach both products:
- Click **Attach** → select `apex_pro_monthly`
- Click **Attach** → select `apex_pro_annual`

---

### Step 4 — Create the Offering

Go to **Offerings** → **+ New**:

| Field | Value |
|---|---|
| Identifier | `default` |
| Description | `Default APEX Pro offering` |

Make sure **Current Offering** is checked — this makes it the active offering your app fetches.

---

### Step 5 — Add Packages

Inside the **default** offering, click **+ Add Package**:

**Package 1:**

| Field | Value |
|---|---|
| Identifier | `$rc_monthly` (or use `MONTHLY` — RevenueCat has a reserved identifier `$rc_monthly`) |
| Products | `apex_pro_monthly` (App Store) + `apex_pro_monthly` (Play Store) |

> Use RevenueCat's reserved identifier `$rc_monthly` for the monthly package. This maps to the `PackageType.monthly` enum in the SDK, which simplifies your paywall code. Same applies to `$rc_annual`.

**Package 2:**

| Field | Value |
|---|---|
| Identifier | `$rc_annual` |
| Products | `apex_pro_annual` (App Store) + `apex_pro_annual` (Play Store) |

---

### Step 6 — Verify the Structure

Your final RevenueCat structure should look like this:

```
Project: APEX
├── Entitlement: pro
│   ├── apex_pro_monthly
│   └── apex_pro_annual
└── Offering: default (current)
    ├── Package: $rc_monthly → apex_pro_monthly
    └── Package: $rc_annual  → apex_pro_annual
```

---

## Part 4 — Free Trial Best Practices

- **3-day trials are short by design.** This is intentional for high-intent apps — it filters for serious users and limits trial abuse. 7-day is the most common for consumer apps, but 3-day works well for fitness/productivity/tool apps where value is immediate.
- **Eligibility is automatic.** Apple and Google both limit introductory offers to users who haven't previously subscribed to a product in the same group (App Store) or same product (Play Store). RevenueCat surfaces this in the `StoreProduct.introductoryDiscount` and `introductoryPrice` fields so your paywall can show "Start your 3-day free trial" only to eligible users.
- **Test with a sandbox account.** On iOS, use a sandbox Apple ID. Note that sandbox trials run in accelerated time (a 3-day trial = a few minutes in sandbox). On Android, use a Google Play license tester account — trials are also accelerated.
- **Show the trial on the paywall.** Make your paywall copy explicitly say "3-day free trial, then $19.99/month" — this is required by Apple guidelines and increases conversion.
- **Cancellation reminder.** Consider sending a push notification on day 2 of the trial ("Your trial ends tomorrow") using RevenueCat webhooks or a tool like OneSignal.

---

## Part 5 — Trial on Monthly vs. Annual

**Recommendation: Put the 3-day free trial on monthly only.**

Here's why:

- **Annual buyers are already high-intent.** Someone willing to pay $149.99 upfront has already made their decision. Adding a free trial doesn't move the needle much and introduces friction and abuse risk.
- **Refund/chargeback risk.** If a user starts an annual trial and immediately cancels, they've experienced the full product with no conversion. Worse, if they forget to cancel, they may dispute the charge — resulting in a chargeback at a much higher amount.
- **Funnel logic.** The intended flow is: see paywall → start monthly trial → convert to paying → optionally upgrade to annual. This gives you a predictable funnel.
- **You can A/B test later.** RevenueCat Experiments lets you test offering variations. Once you have monthly trial data, you can run an experiment adding a trial to annual and measure impact.

**The one exception:** If your paywall prominently features the annual plan as the default/hero option (common in apps following the "Annual First" strategy), you may want to add a short trial there too. But start without it.

---

## Part 6 — Things to Avoid

### App Store Connect
- **Don't create multiple subscription groups** unless you have genuinely different tiers (e.g., Pro vs. Enterprise). Monthly and Annual belong in the same group.
- **Don't use "free" in your product Reference Name.** Apple's internal tools sometimes flag this. Name it "APEX Pro Monthly" not "APEX Pro Free Trial Monthly."
- **Don't forget Review Information.** Without a paywall screenshot, App Store Review may reject your subscription products.
- **Don't submit products in a "Missing Metadata" state.** Every product needs at minimum: one price, one localization, and a duration set before it can be reviewed.

### Google Play Console
- **Don't skip activating base plans.** A subscription product without an active base plan is invisible to users.
- **Don't forget to activate offers separately.** In Play Console, both the base plan AND the offer must each be individually activated.
- **Don't reuse a product ID after deletion.** Deleted Play Store product IDs cannot be recreated. If something goes wrong, create a new product ID.
- **Don't grant the service account Owner role.** Use only the minimal permissions listed above (View financial data + Manage orders). Over-permissioning a service account is a security risk.

### RevenueCat
- **Don't create separate products for iOS and Android.** One RevenueCat product should map to both the App Store and Play Store product IDs — RevenueCat handles the routing.
- **Don't hardcode product IDs in your app.** Fetch offerings from RevenueCat dynamically (`Purchases.getOfferings()`). This lets you update pricing and packages without an app release.
- **Don't forget to set the offering as "Current."** If your offering isn't marked current, `Purchases.getOfferings()` will return `nil` for `current` and your paywall won't load.
- **Don't test in production.** Use sandbox/test mode until everything is verified end-to-end.

---

## Quick Checklist

### App Store Connect
- [ ] Subscription group **APEX Pro** created
- [ ] `apex_pro_monthly` created, $19.99, 3-day free trial, localization added
- [ ] `apex_pro_annual` created, $149.99, no trial, localization added
- [ ] Review screenshot uploaded to both products
- [ ] Both products show **Ready to Submit**

### Google Play Console
- [ ] `apex_pro_monthly` subscription created and active
- [ ] Base plan `monthly-base` created, $19.99/month, activated
- [ ] Offer `monthly-trial` (3-day free trial) created and activated
- [ ] `apex_pro_annual` subscription created and active
- [ ] Base plan `annual-base` created, $149.99/year, activated
- [ ] Service account created with correct permissions
- [ ] RevenueCat service account JSON uploaded

### RevenueCat
- [ ] App Store app connected (App Store Connect API key)
- [ ] Google Play app connected (service account JSON)
- [ ] Products `apex_pro_monthly` and `apex_pro_annual` created
- [ ] Entitlement `pro` created, both products attached
- [ ] Offering `default` created and marked **Current**
- [ ] Packages `$rc_monthly` and `$rc_annual` added with correct products
- [ ] Sandbox purchase tested end-to-end on both platforms
