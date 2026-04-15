require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { google } = require("googleapis");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, "data", "app.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const REQUIRED_HEADERS = [
  "Dish Name",
  "Menu Category",
  "Short Description",
  "Ingredients",
  "Modifications",
  "Spanish Ingredients",
  "Spanish Modifications",
  "Dairy",
  "Eggs",
  "Fish",
  "Shellfish",
  "Tree Nuts",
  "Peanuts",
  "Gluten",
  "Soy",
  "Sesame",
  "Alcohol",
  "Updated At",
];

const db = new sqlite3.Database(DB_PATH);
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      spreadsheet_id TEXT NOT NULL,
      sheet_name TEXT NOT NULL DEFAULT 'Dishes',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getServiceAccountEmail() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return parsed.client_email || null;
    } catch (error) {
      return null;
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
      const parsed = JSON.parse(raw);
      return parsed.client_email || null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

function getAuthConfig() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      return { credentials: parsed };
    } catch (error) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS };
  }

  throw new Error(
    "Google Sheets credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

async function getSheetsClient() {
  const authConfig = getAuthConfig();
  const auth = new google.auth.GoogleAuth({
    ...authConfig,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function normalizeYesNo(value) {
  return String(value || "NO").toUpperCase() === "YES" ? "YES" : "NO";
}

function parseDishPayload(body) {
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();

  if (!name) {
    throw new Error("Dish name is required.");
  }

  if (!category) {
    throw new Error("Menu category is required.");
  }

  return {
    name,
    category,
    description: String(body.description || "").trim(),
    ingredients: String(body.ingredients || "").trim(),
    modifications: String(body.modifications || "").trim(),
    ingredientsSpanish: String(body.ingredientsSpanish || "").trim(),
    modificationsSpanish: String(body.modificationsSpanish || "").trim(),
    dairy: normalizeYesNo(body.dairy),
    eggs: normalizeYesNo(body.eggs),
    fish: normalizeYesNo(body.fish),
    shellfish: normalizeYesNo(body.shellfish),
    treenuts: normalizeYesNo(body.treenuts),
    peanuts: normalizeYesNo(body.peanuts),
    gluten: normalizeYesNo(body.gluten),
    soy: normalizeYesNo(body.soy),
    sesame: normalizeYesNo(body.sesame),
    alcohol: normalizeYesNo(body.alcohol),
  };
}

function parseSpreadsheetId(value) {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  const idMatch = input.match(/^[a-zA-Z0-9-_]{20,}$/);
  if (idMatch) {
    return input;
  }

  return "";
}

function sheetRange(sheetName, range) {
  const safeSheetName = sheetName.replace(/'/g, "''");
  return `'${safeSheetName}'!${range}`;
}

async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (existing?.properties?.sheetId != null) {
    return existing.properties.sheetId;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });

  const refreshed = await sheets.spreadsheets.get({ spreadsheetId });
  const created = refreshed.data.sheets?.find(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (created?.properties?.sheetId == null) {
    throw new Error(`Unable to create worksheet "${sheetName}".`);
  }

  return created.properties.sheetId;
}

async function ensureHeaderRow(sheets, spreadsheetId, sheetName) {
  await ensureSheetExists(sheets, spreadsheetId, sheetName);
  const headerRange = sheetRange(sheetName, "A1:R1");

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  const existing = current.data.values?.[0] || [];
  const isSame =
    existing.length === REQUIRED_HEADERS.length &&
    existing.every((val, idx) => val === REQUIRED_HEADERS[idx]);

  if (!isSame) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [REQUIRED_HEADERS],
      },
    });
  }
}

function toDishRow(dish) {
  return [
    dish.name,
    dish.category,
    dish.description,
    dish.ingredients,
    dish.modifications,
    dish.ingredientsSpanish,
    dish.modificationsSpanish,
    dish.dairy,
    dish.eggs,
    dish.fish,
    dish.shellfish,
    dish.treenuts,
    dish.peanuts,
    dish.gluten,
    dish.soy,
    dish.sesame,
    dish.alcohol,
    new Date().toISOString(),
  ];
}

function fromSheetRows(rows = []) {
  return rows
    .map((row, idx) => ({
      rowNum: idx + 2,
      name: row[0] || "",
      category: row[1] || "",
      description: row[2] || "",
      ingredients: row[3] || "",
      modifications: row[4] || "",
      ingredientsSpanish: row[5] || "",
      modificationsSpanish: row[6] || "",
      dairy: row[7] || "NO",
      eggs: row[8] || "NO",
      fish: row[9] || "NO",
      shellfish: row[10] || "NO",
      treenuts: row[11] || "NO",
      peanuts: row[12] || "NO",
      gluten: row[13] || "NO",
      soy: row[14] || "NO",
      sesame: row[15] || "NO",
      alcohol: row[16] || "NO",
      updatedAt: row[17] || "",
    }))
    .filter((dish) => dish.name || dish.category || dish.description);
}

function parseRowFromRange(updatedRange = "") {
  const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function normalizeRestaurantRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    spreadsheetId: row.spreadsheet_id,
    sheetName: row.sheet_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function groupDishesByCategory(dishes) {
  const grouped = {};
  for (const dish of dishes) {
    const category = dish.category || "Uncategorized";
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(dish);
  }

  return Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .map((category) => ({
      category,
      dishes: grouped[category],
    }));
}

async function getRestaurantOrThrow(id) {
  const restaurant = await getSql("SELECT * FROM restaurants WHERE id = ?", [id]);
  if (!restaurant) {
    const error = new Error("Restaurant not found.");
    error.statusCode = 404;
    throw error;
  }
  return restaurant;
}

app.get("/api/health", (req, res) => {
  const email = getServiceAccountEmail();
  const credentialsConfigured =
    Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  res.json({
    ok: true,
    credentialsConfigured,
    serviceAccountEmail: email,
  });
});

app.get("/api/template", (req, res) => {
  res.json({
    headers: REQUIRED_HEADERS,
    sampleDish: {
      name: "Pasta Puttanesca",
      category: "DINNER",
      description: "Classic pasta with tomato, olive, and caper sauce.",
      ingredients: "MAIN: Pasta, Garlic | SAUCE: Tomato, Capers, Olives",
      modifications: "No cheese, no anchovies",
      ingredientsSpanish: "PRINCIPAL: Pasta, Ajo | SALSA: Tomate, Alcaparras, Aceitunas",
      modificationsSpanish: "Sin queso, sin anchoas",
      dairy: "NO",
      eggs: "NO",
      fish: "YES",
      shellfish: "NO",
      treenuts: "NO",
      peanuts: "NO",
      gluten: "YES",
      soy: "NO",
      sesame: "NO",
      alcohol: "NO",
    },
  });
});

app.get("/api/restaurants", async (req, res, next) => {
  try {
    const rows = await allSql(
      "SELECT * FROM restaurants ORDER BY updated_at DESC, created_at DESC"
    );
    res.json({ restaurants: rows.map(normalizeRestaurantRow) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/restaurants/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await getRestaurantOrThrow(id);
    res.json({ restaurant: normalizeRestaurantRow(row) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/restaurants", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const sheetName = String(req.body.sheetName || "Dishes").trim() || "Dishes";
    const spreadsheetId = parseSpreadsheetId(req.body.spreadsheetId || req.body.spreadsheetUrl);

    if (!name) {
      return res.status(400).json({ error: "Restaurant name is required." });
    }

    if (!spreadsheetId) {
      return res
        .status(400)
        .json({ error: "A valid Google Spreadsheet URL or ID is required." });
    }

    const sheets = await getSheetsClient();
    await ensureHeaderRow(sheets, spreadsheetId, sheetName);

    const result = await runSql(
      "INSERT INTO restaurants (name, spreadsheet_id, sheet_name, updated_at) VALUES (?, ?, ?, datetime('now'))",
      [name, spreadsheetId, sheetName]
    );
    const created = await getSql("SELECT * FROM restaurants WHERE id = ?", [result.lastID]);
    res.status(201).json({ restaurant: normalizeRestaurantRow(created) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/restaurants/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await getRestaurantOrThrow(id);

    const name = String(req.body.name || existing.name).trim();
    const sheetName = String(req.body.sheetName || existing.sheet_name).trim() || "Dishes";
    const spreadsheetId = parseSpreadsheetId(
      req.body.spreadsheetId || req.body.spreadsheetUrl || existing.spreadsheet_id
    );

    if (!name) {
      return res.status(400).json({ error: "Restaurant name is required." });
    }

    if (!spreadsheetId) {
      return res
        .status(400)
        .json({ error: "A valid Google Spreadsheet URL or ID is required." });
    }

    const sheets = await getSheetsClient();
    await ensureHeaderRow(sheets, spreadsheetId, sheetName);

    await runSql(
      "UPDATE restaurants SET name = ?, spreadsheet_id = ?, sheet_name = ?, updated_at = datetime('now') WHERE id = ?",
      [name, spreadsheetId, sheetName, id]
    );
    const updated = await getSql("SELECT * FROM restaurants WHERE id = ?", [id]);
    res.json({ restaurant: normalizeRestaurantRow(updated) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/restaurants/:id/dishes", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const restaurant = await getRestaurantOrThrow(id);
    const sheets = await getSheetsClient();

    await ensureHeaderRow(sheets, restaurant.spreadsheet_id, restaurant.sheet_name);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: restaurant.spreadsheet_id,
      range: sheetRange(restaurant.sheet_name, "A2:R"),
    });

    res.json({ dishes: fromSheetRows(response.data.values || []) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/restaurants/:id/training-app", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const restaurant = await getRestaurantOrThrow(id);
    const sheets = await getSheetsClient();

    await ensureHeaderRow(sheets, restaurant.spreadsheet_id, restaurant.sheet_name);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: restaurant.spreadsheet_id,
      range: sheetRange(restaurant.sheet_name, "A2:R"),
    });

    const dishes = fromSheetRows(response.data.values || []);
    res.json({
      restaurant: normalizeRestaurantRow(restaurant),
      generatedAt: new Date().toISOString(),
      sections: groupDishesByCategory(dishes),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/restaurants/:id/dishes", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const restaurant = await getRestaurantOrThrow(id);
    const dish = parseDishPayload(req.body);
    const sheets = await getSheetsClient();

    await ensureHeaderRow(sheets, restaurant.spreadsheet_id, restaurant.sheet_name);
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: restaurant.spreadsheet_id,
      range: sheetRange(restaurant.sheet_name, "A:R"),
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [toDishRow(dish)] },
    });

    await runSql("UPDATE restaurants SET updated_at = datetime('now') WHERE id = ?", [id]);
    const rowNum = parseRowFromRange(response.data.updates?.updatedRange);
    res.status(201).json({ rowNum, dish });
  } catch (error) {
    next(error);
  }
});

app.put("/api/restaurants/:id/dishes/:rowNum", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rowNum = Number(req.params.rowNum);
    if (!Number.isFinite(rowNum) || rowNum < 2) {
      return res.status(400).json({ error: "Invalid row number." });
    }

    const restaurant = await getRestaurantOrThrow(id);
    const dish = parseDishPayload(req.body);
    const sheets = await getSheetsClient();

    await ensureHeaderRow(sheets, restaurant.spreadsheet_id, restaurant.sheet_name);
    await sheets.spreadsheets.values.update({
      spreadsheetId: restaurant.spreadsheet_id,
      range: sheetRange(restaurant.sheet_name, `A${rowNum}:R${rowNum}`),
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [toDishRow(dish)] },
    });

    await runSql("UPDATE restaurants SET updated_at = datetime('now') WHERE id = ?", [id]);
    res.json({ rowNum, dish });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/restaurants/:id/dishes/:rowNum", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rowNum = Number(req.params.rowNum);
    if (!Number.isFinite(rowNum) || rowNum < 2) {
      return res.status(400).json({ error: "Invalid row number." });
    }

    const restaurant = await getRestaurantOrThrow(id);
    const sheets = await getSheetsClient();
    const sheetId = await ensureSheetExists(
      sheets,
      restaurant.spreadsheet_id,
      restaurant.sheet_name
    );

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: restaurant.spreadsheet_id,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowNum - 1,
                endIndex: rowNum,
              },
            },
          },
        ],
      },
    });

    await runSql("UPDATE restaurants SET updated_at = datetime('now') WHERE id = ?", [id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/training/:restaurantId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "training.html"));
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const message =
    error?.response?.data?.error?.message ||
    error.message ||
    "Unexpected server error.";

  res.status(statusCode).json({ error: message });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Menu intake app running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize app:", error.message);
    process.exit(1);
  });
