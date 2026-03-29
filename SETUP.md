# Serafina OS Setup

## GitHub

1. Create a new GitHub repository.
2. Push this `serafina-os` folder to that repo.
3. Keep `index.html`, `api/`, `vercel.json`, and `supabase/schema.sql` in the repo root.

## Supabase

1. Create a Supabase project.
2. Run the SQL in `supabase/schema.sql`.
3. Copy:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Shopify

1. Create a Storefront API token.
2. Set:
   - `SHOPIFY_STORE`
   - `SHOPIFY_STOREFRONT_TOKEN`
3. For webhooks, also set:
   - `SHOPIFY_WEBHOOK_SECRET`

## Vercel

1. Import the GitHub repo into Vercel.
2. Root directory: `serafina-os`
3. Add all env vars from `.env.example`.
4. Deploy.

## Cron

`vercel.json` schedules `/api/cron/daily-sync` once per day.

You can also protect manual cron calls with:

- `CRON_SECRET`

## What Works After Setup

- Manual cloud push/pull from the sidebar `☁ Sync` button
- Shopify connection tests through serverless routes
- Shopify product sync through serverless routes
- Daily Vercel cron endpoint
- GitHub validation workflow for inline app JS syntax

## Local Intake Importer

If you want to dump backlog footage from your laptop into Serafina OS:

1. Put files into:
   - `/Users/dollyshahani/Documents/Playground/serafina-intake/serafina-raw`
   - `/Users/dollyshahani/Documents/Playground/serafina-intake/founder-raw`
   - `/Users/dollyshahani/Documents/Playground/serafina-intake/needs-review`
2. Run:
   - `npm run import:intake`
3. Then in the app:
   - open `☁ Sync`
   - `Pull Cloud`

The importer uploads those files into Supabase Storage, adds them to `sf3_content` in the cloud snapshot, and moves processed source files into the local `imported/` folder.
