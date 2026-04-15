# Restaurant Intake + Training App Builder (No Google Apps Script)

Reusable system for turning chef interviews into production-ready training apps.

This follows a 3-layer architecture:

1. **Intake layer**: form UI for live interview/data entry
2. **Database layer**: Google Sheet is the source of truth
3. **Output layer**: restaurant-facing training app generated from that same data

You can:

- connect each restaurant to its own spreadsheet
- keep adding/editing/deleting dishes over multiple sessions
- reuse the same intake tool for every new restaurant
- open a live training app or export a static training app snapshot

## Stack

- Intake frontend: plain HTML/CSS/JS (`public/index.html`)
- Backend: Node.js + Express (`server.js`)
- Persistence for restaurant connections: SQLite (`data/app.db`)
- Spreadsheet integration: Google Sheets API (service account), **not** Google Apps Script
- Output frontend: live training app (`public/training.html`)

## 1) Google setup and cost

1. Create a Google Cloud project.
2. Enable **Google Sheets API**.
3. Create a **service account**.
4. Download the JSON key file.
5. Share each restaurant spreadsheet with the service account email (Editor role).

Notes:

- Google Sheets API itself is documented as available at no additional cost for normal usage, with request quotas.
- If you stay within quota, you should not pay API charges for this project.

## 2) Environment setup

Copy example env file:

```bash
cp .env.example .env
```

Then set one of:

- `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`
- or `GOOGLE_SERVICE_ACCOUNT_JSON={...}`

`PORT` defaults to `3000`.

## 3) Run locally

```bash
npm install
npm start
```

Open: `http://localhost:3000`

## 4) Workflow in the app

1. Click **+ New restaurant**
2. Enter:
   - restaurant name
   - spreadsheet URL or ID
   - worksheet tab name (default: `Dishes`)
3. Add dish entries via the form during chef interview.
4. Use search/edit/delete in the dish list.
5. Return later and continue on the same restaurant connection.
6. Output options:
   - click **Open live training app** to open a URL that always reflects current data
   - click **Generate static training app** to export a single HTML snapshot file

## 5) Output URLs

- Live training app route: `/training/:restaurantId`
- Training app data API: `GET /api/restaurants/:id/training-app`

## API endpoints (used by UI)

- `GET /api/health`
- `GET /api/restaurants`
- `GET /api/restaurants/:id`
- `POST /api/restaurants`
- `PUT /api/restaurants/:id`
- `GET /api/restaurants/:id/dishes`
- `GET /api/restaurants/:id/training-app`
- `POST /api/restaurants/:id/dishes`
- `PUT /api/restaurants/:id/dishes/:rowNum`
- `DELETE /api/restaurants/:id/dishes/:rowNum`

## Free hosting recommendations

If you want a free deployment:

- **Cloudflare Pages + Cloudflare D1 + Workers** (best long-term free option, no app sleeping)
- **Render free web service** (simple, but free web services can sleep and local SQLite is ephemeral)

For this codebase specifically, the safest free path is:

1. Keep Google Sheets as the database of record
2. Host backend on a free web host
3. Treat local SQLite as cache/connection metadata (can be recreated if needed)

If you want, the next step can be migrating connection metadata from SQLite to Supabase/Postgres free tier to avoid any ephemeral filesystem concerns.
