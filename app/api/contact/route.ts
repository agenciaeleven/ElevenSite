import { NextResponse } from "next/server";
import { createSign } from "node:crypto";

export const runtime = "nodejs";

type ContactPayload = {
  name?: string;
  company?: string;
  whatsapp?: string;
  need?: string;
  message?: string;
};

type GoogleSheet = {
  properties: {
    sheetId: number;
    title: string;
  };
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CONTACT_SHEET_HEADERS = [
  "Data/Hora",
  "Nome",
  "Empresa",
  "WhatsApp",
  "Necessidade",
  "Mensagem",
  "Origem",
];

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function base64Url(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getGoogleAccessToken() {
  const clientEmail = getRequiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_SHEETS_PRIVATE_KEY").replace(
    /\\n/g,
    "\n",
  );

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claimSet}`;
  const signature = createSign("RSA-SHA256")
    .update(unsignedJwt)
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${signature}`,
    }),
  });

  if (!response.ok) {
    throw new Error("Could not authenticate with Google Sheets");
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

function normalizeSpreadsheetId(value: string) {
  const match = value.match(/\/spreadsheets\/d\/([^/]+)/);
  return match?.[1] || value;
}

function getSheetRange(sheetName: string, range: string) {
  const safeSheetName = sheetName.replace(/'/g, "''");
  return encodeURIComponent(`'${safeSheetName}'!${range}`);
}

function getBrasiliaDateTime() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

async function fetchGoogleSheets<T>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Sheets request failed: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as T;
}

async function ensureContactSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
) {
  const spreadsheet = await fetchGoogleSheets<{ sheets?: GoogleSheet[] }>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
  );
  const sheets = spreadsheet.sheets || [];
  let sheet = sheets.find((item) => item.properties.title === sheetName);

  if (!sheet) {
    const createdSpreadsheet = await fetchGoogleSheets<{
      replies: { addSheet: GoogleSheet }[];
    }>(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        }),
      },
    );
    sheet = createdSpreadsheet.replies[0].addSheet;
  }

  await fetchGoogleSheets(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${getSheetRange(
      sheetName,
      "A1:G1",
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [CONTACT_SHEET_HEADERS] }),
    },
  );

  await fetchGoogleSheets(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheet.properties.sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: CONTACT_SHEET_HEADERS.length,
              },
              cell: {
                userEnteredFormat: {
                  horizontalAlignment: "CENTER",
                  textFormat: { bold: true },
                },
              },
              fields: "userEnteredFormat(horizontalAlignment,textFormat)",
            },
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheet.properties.sheetId,
                gridProperties: { frozenRowCount: 1 },
              },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: sheet.properties.sheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: CONTACT_SHEET_HEADERS.length,
              },
            },
          },
        ],
      }),
    },
  );
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ContactPayload;
    const name = payload.name?.trim();
    const whatsapp = payload.whatsapp?.trim();

    if (!name || !whatsapp) {
      return NextResponse.json(
        { error: "Nome e WhatsApp são obrigatórios." },
        { status: 400 },
      );
    }

    const spreadsheetId = normalizeSpreadsheetId(
      getRequiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
    );
    const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Leads";
    const accessToken = await getGoogleAccessToken();
    await ensureContactSheet(accessToken, spreadsheetId, sheetName);

    await fetchGoogleSheets(
      accessToken,
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${getSheetRange(
        sheetName,
        "A:G",
      )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({
          values: [
            [
              getBrasiliaDateTime(),
              name,
              payload.company?.trim() || "",
              whatsapp,
              payload.need?.trim() || "",
              payload.message?.trim() || "",
              "Site Eleven",
            ],
          ],
        }),
      },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Não foi possível enviar sua mensagem agora." },
      { status: 500 },
    );
  }
}
