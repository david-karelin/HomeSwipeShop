<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1r6DecquuTGfDKgEJt9984UDSrgbTD0Wl

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Curated Launch Inventory

The main swipe feed now prefers curated launch products with approved product images.

1. Copy [scripts/launchSet.example.json](scripts/launchSet.example.json) to `scripts/launchSet.json`
2. Add 40-60 real products with real product images, prices under $60 by default, and only use $60-$80 for standout lamps, sconces, or mirrors that explicitly set `allowedAbove60: true`
3. Validate the file without writing data:
   `npm run seed:launch:dry`
4. Seed the curated inventory:
   `npm run seed:launch`

Launch items are written with deterministic `amazon_<asin>` ids plus `isCurated`, `imageApproved`, `isLaunch`, `active`, `primaryType`, `launchBatch`, and `curationScore`, and the swipe feed will show those approved items before the generic fallback inventory.

## Firestore Indexes

The curated feed query uses a composite index on `products` for:

- `isCurated` ascending
- `active` ascending
- `swipeEligible` ascending
- `imageApproved` ascending
- `updatedAt` descending

The repo now includes [firestore.indexes.json](firestore.indexes.json). Deploy it with:

`firebase deploy --only firestore:indexes`

Without that index, the curated query will fall back instead of using the intended ordered Firestore query.

## Product Schema Cleanup

Use the product migration to standardize older docs around `displayName`, canonical lowercase categories, `primaryType`, structured tags, and `swipeEligible`.

1. Preview the normalization:
   `npm run migrate:products:dry`
2. Apply it to Firestore:
   `npm run migrate:products`

The legacy backfill commands still work as aliases, but the canonical script is now `scripts/migrateProducts.ts`. The migration keeps older inventory in Firestore while marking placeholder-image or out-of-lane items as not swipe-eligible so they stop polluting the main swipe feed.

## Legacy Cleanup

Use the legacy retirement script to bulk-hide obvious junk and softly retire salvageable non-launch inventory from the swipe feed.

1. Preview the cleanup:
   `npm run retire:legacy:dry`
2. Apply it to Firestore:
   `npm run retire:legacy`

Hard-hidden docs are marked `legacyStatus: "hidden"` and removed from the main feed. Soft-retired docs are marked `legacyStatus: "retired_from_swipe"` so they can stay in Firestore without competing in swipe discovery.
