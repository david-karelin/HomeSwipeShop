# Product Link Manual Pass

Generated on 2026-03-19T17:43:36.066Z

## Before You Start

- Use reports/product_link_audit.csv as the main sheet.
- Filter launchStatus to ok before clicking rows that are ready for pass 2.
- Fix any fail or review rows in Firestore first if you want a clean manual pass.

## Current Snapshot

- Total products: 498
- Data-ready rows: 0
- Launch-ready rows: 0
- Rows needing fixes or review: 498

## Manual Product Checks

Fill in the blank manual columns in reports/product_link_audit.csv as you click on mobile:

- manualOpened
- manualPageLoads
- manualRightProduct
- manualRightRetailer
- manualNo404
- manualNoWeirdRedirect
- manualMobileIssue
- manualFixNeeded
- manualNotes

## UI Flow Checks

Run these flows on mobile or mobile emulation:

- feed -> modal -> retailer
- RoomScan pick -> retailer
- saved sheet -> modal -> retailer
- bag sheet -> modal -> retailer
- shortlist page -> modal -> retailer
- checkout item -> retailer
- confirm gate -> continue to retailer
- missing URL fallback
- overlay close/restore behavior
