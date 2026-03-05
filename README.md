# Food Ordering App (Messenger Checkout)

Modern, mobile-first food ordering web application with:

- Category browsing (Meals, Drinks, Snacks, Desserts)
- Search and filtering
- Cart with quantity updates, remove support, and computed totals
- Checkout form (name, phone, address/pickup, notes)
- Messenger integration on final submit
- Admin panel (login, add item, enable/disable item)
- Optional order logging backup (`server/data/orders.json`)

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express
- Validation/Security: Zod, Helmet, rate limiting, input sanitization
- Messenger: Deep-link (`m.me`) and optional direct Graph API mode

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

3. Start frontend + backend:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`

## Messenger Modes

### 1) Deep-link mode (recommended starter)

Set:

- `MESSENGER_MODE=deeplink`
- `MESSENGER_PAGE_USERNAME=your_page_username`
- or `MESSENGER_PAGE_URL=https://www.facebook.com/profile.php?id=...`

On checkout, users are redirected to:

`https://m.me/PAGE_USERNAME?text=ORDER_DETAILS`

### 2) Direct API mode (advanced)

Set:

- `MESSENGER_MODE=api`
- `MESSENGER_PAGE_ACCESS_TOKEN=...`
- `MESSENGER_RECIPIENT_ID=...`

The backend attempts to send directly through Graph API and still returns a deep-link fallback.
In the frontend, redirect fallback only happens when direct send is unavailable.

## Admin Access

Defaults (change in `.env`):

- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=admin123`

## Supabase Order Logging

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, orders are saved to Supabase table `public.orders`.
If Supabase is not configured (or insert fails), the app falls back to `server/data/orders.json`.

Run this SQL in Supabase SQL editor:

```sql
-- Use supabase/schema.sql
```

## Deployment

### GitHub

```bash
git init
git add .
git commit -m "Initial food ordering app"
git branch -M main
git remote add origin https://github.com/JasonCruzGit/fooddelivery.git
git push -u origin main
```

### Vercel CLI

```bash
npx vercel
npx vercel --prod
```

Set these env vars in Vercel project settings:

- `MESSENGER_MODE`
- `MESSENGER_PAGE_URL` or `MESSENGER_PAGE_USERNAME`
- `MESSENGER_PAGE_ACCESS_TOKEN`
- `MESSENGER_RECIPIENT_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

## Notes

- Menu seed data is auto-created in `server/data/menu.json`
- Orders are logged in `server/data/orders.json`
