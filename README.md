# Menu Intake App (No Google Apps Script)

Reusable restaurant data-entry app for collecting menu details into Google Sheets.  
This project is designed so you can:

- connect a restaurant to a specific spreadsheet
- keep adding/editing/deleting dishes over multiple sessions
- reuse the same tool for every new restaurant
- export a standalone HTML menu when data gathering is complete

## Stack

- Frontend: plain HTML/CSS/JS (`public/index.html`)
- Backend: Node.js + Express (`server.js`)
- Persistence for restaurant connections: SQLite (`data/app.db`)
- Spreadsheet integration: Google Sheets API (service account), **not** Google Apps Script

## 1) Google setup

1. Create a Google Cloud project.
2. Enable **Google Sheets API**.
3. Create a **service account**.
4. Download the JSON key file.
5. Share each restaurant spreadsheet with the service account email (Editor role).

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
3. Add dish entries via the form.
4. Use search/edit/delete in the dish list.
5. Return later and continue on the same restaurant connection.
6. Click **Generate menu HTML** when done to export final menu file.

## API endpoints (used by UI)

- `GET /api/health`
- `GET /api/restaurants`
- `POST /api/restaurants`
- `PUT /api/restaurants/:id`
- `GET /api/restaurants/:id/dishes`
- `POST /api/restaurants/:id/dishes`
- `PUT /api/restaurants/:id/dishes/:rowNum`
- `DELETE /api/restaurants/:id/dishes/:rowNum`
