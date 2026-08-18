/**
 * Backend de "FinanzasAP" — Google Apps Script Web App
 * Guarda todo en pestañas del Google Sheet al que está ligado este script:
 * Gastos, Ingresos, Ahorros, Config. Se crean solas la primera vez que se usan.
 */

const SHEET_GASTOS = 'Gastos';
const SHEET_INGRESOS = 'Ingresos';
const SHEET_AHORROS = 'Ahorros';
const SHEET_CONFIG = 'Config';
const SHEET_BIENES = 'Bienes';
const SHEET_PROYECTOS = 'Proyectos';

const GASTOS_HEADERS = ['id', 'ts', 'amount', 'category', 'categoryKey', 'categoryColor', 'subcategory', 'detail', 'concept', 'lat', 'lng', 'paymentMethod', 'chargeMonth', 'currency'];
const INGRESOS_HEADERS = ['monthKey', 'amount', 'updatedAt', 'currency', 'concept', 'id'];
const AHORROS_HEADERS = ['id', 'ts', 'amount', 'concept', 'purpose', 'location'];
const CONFIG_HEADERS = ['key', 'value'];
const BIENES_HEADERS = ['id', 'name', 'type', 'currency', 'value', 'debt', 'updatedAt'];
const PROYECTOS_HEADERS = ['id', 'name', 'type', 'currency', 'items', 'updatedAt'];

// Columnas que deben guardarse siempre como texto plano — si no se fuerza esto,
// Google Sheets autoconvierte valores como "2026-08" a una fecha real, lo que
// rompe las comparaciones de igualdad en el resto del código.
const TEXT_COLUMNS = ['id', 'ts', 'monthKey', 'chargeMonth', 'updatedAt', 'key'];

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return sheet;
  }
  // Migración: si el código agregó columnas nuevas después de que esta hoja ya
  // existía (ej. paymentMethod, chargeMonth), completa los encabezados que falten
  // en la fila 1 sin tocar los que ya están.
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  headers.forEach((h, i) => {
    const col = i + 1;
    const existing = col <= currentHeaders.length ? currentHeaders[col - 1] : '';
    if (!existing) {
      sheet.getRange(1, col).setValue(h);
    }
  });
  return sheet;
}

// Fuerza a texto plano SOLO la celda puntual que se está por escribir
// (mucho más liviano que reformatear columnas enteras en cada pedido).
function protectTextCell_(sheet, row, col, header) {
  if (TEXT_COLUMNS.indexOf(header) !== -1) {
    sheet.getRange(row, col).setNumberFormat('@');
  }
}

function readAll_(name, headers) {
  const sheet = getSheet_(name, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      // Por si alguna fila vieja ya quedó guardada como fecha real: la volvemos a texto YYYY-MM-DD.
      if (v instanceof Date && (h === 'monthKey' || h === 'chargeMonth')) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
      } else if (v instanceof Date) {
        v = v.toISOString();
      }
      obj[h] = v;
    });
    return obj;
  });
}

function appendRow_(name, headers, obj) {
  const sheet = getSheet_(name, headers);
  const nextRow = sheet.getLastRow() + 1;
  headers.forEach((h, i) => protectTextCell_(sheet, nextRow, i + 1, h));
  const row = headers.map((h) => (obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
}

function deleteRowById_(name, headers, id) {
  const sheet = getSheet_(name, headers);
  const idCol = headers.indexOf('id') + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

function addIncome_(monthKey, currency, amount, concept) {
  const sheet = getSheet_(SHEET_INGRESOS, INGRESOS_HEADERS);
  const nextRow = sheet.getLastRow() + 1;
  const id = Utilities.getUuid();
  const updatedAt = new Date().toISOString();
  protectTextCell_(sheet, nextRow, 1, 'monthKey');
  protectTextCell_(sheet, nextRow, 3, 'updatedAt');
  protectTextCell_(sheet, nextRow, 6, 'id');
  sheet.getRange(nextRow, 1, 1, 6).setValues([[monthKey, amount, updatedAt, currency, concept || '', id]]);
}

function deleteIncomeById_(id) {
  const sheet = getSheet_(SHEET_INGRESOS, INGRESOS_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const idCol = INGRESOS_HEADERS.indexOf('id') + 1;
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

function upsertAsset_(asset) {
  const sheet = getSheet_(SHEET_BIENES, BIENES_HEADERS);
  const lastRow = sheet.getLastRow();
  const updatedAt = new Date().toISOString();
  if (lastRow >= 2 && asset.id) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(asset.id)) {
        sheet.getRange(i + 2, 2, 1, 4).setValues([[asset.name, asset.type, asset.currency, asset.value]]);
        sheet.getRange(i + 2, 6).setValue(asset.debt || 0);
        protectTextCell_(sheet, i + 2, 7, 'updatedAt');
        sheet.getRange(i + 2, 7).setValue(updatedAt);
        return;
      }
    }
  }
  const nextRow = sheet.getLastRow() + 1;
  const id = asset.id || Utilities.getUuid();
  protectTextCell_(sheet, nextRow, 1, 'id');
  protectTextCell_(sheet, nextRow, 7, 'updatedAt');
  sheet.getRange(nextRow, 1, 1, 7).setValues([[id, asset.name, asset.type, asset.currency, asset.value, asset.debt || 0, updatedAt]]);
}

function upsertProyecto_(proyecto) {
  const sheet = getSheet_(SHEET_PROYECTOS, PROYECTOS_HEADERS);
  const lastRow = sheet.getLastRow();
  const updatedAt = new Date().toISOString();
  const itemsJson = JSON.stringify(proyecto.items || []);
  if (lastRow >= 2 && proyecto.id) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(proyecto.id)) {
        sheet.getRange(i + 2, 2, 1, 3).setValues([[proyecto.name, proyecto.type, proyecto.currency]]);
        sheet.getRange(i + 2, 5).setValue(itemsJson);
        protectTextCell_(sheet, i + 2, 6, 'updatedAt');
        sheet.getRange(i + 2, 6).setValue(updatedAt);
        return;
      }
    }
  }
  const nextRow = sheet.getLastRow() + 1;
  const id = proyecto.id || Utilities.getUuid();
  protectTextCell_(sheet, nextRow, 1, 'id');
  protectTextCell_(sheet, nextRow, 6, 'updatedAt');
  sheet.getRange(nextRow, 1, 1, 6).setValues([[id, proyecto.name, proyecto.type, proyecto.currency, itemsJson, updatedAt]]);
}

function getConfig_() {
  const rows = readAll_(SHEET_CONFIG, CONFIG_HEADERS);
  const cfg = {
    cierreDay: 15, lastPaymentMethod: 'no_credito', lastCurrency: 'CHF', fxRate: '', hiddenLoans: '',
    dailyEstimateCHF: 100, dailyEstimateARS: 40000,
  };
  rows.forEach((r) => {
    if (r.key === 'cierreDay') cfg.cierreDay = Number(r.value) || 15;
    if (r.key === 'lastPaymentMethod') cfg.lastPaymentMethod = r.value || 'no_credito';
    if (r.key === 'lastCurrency') cfg.lastCurrency = r.value || 'CHF';
    if (r.key === 'fxRate') cfg.fxRate = r.value || '';
    if (r.key === 'hiddenLoans') cfg.hiddenLoans = r.value || '';
    if (r.key === 'dailyEstimateCHF') cfg.dailyEstimateCHF = Number(r.value) || 100;
    if (r.key === 'dailyEstimateARS') cfg.dailyEstimateARS = Number(r.value) || 40000;
  });
  return cfg;
}

function setConfigValue_(key, value) {
  const sheet = getSheet_(SHEET_CONFIG, CONFIG_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(key)) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  const nextRow = sheet.getLastRow() + 1;
  protectTextCell_(sheet, nextRow, 1, 'key');
  sheet.getRange(nextRow, 1, 1, 2).setValues([[key, value]]);
}

function buildAllData_() {
  const transactions = readAll_(SHEET_GASTOS, GASTOS_HEADERS)
    .map((r) => ({
      id: String(r.id),
      ts: r.ts,
      amount: Number(r.amount),
      category: r.category,
      categoryKey: r.categoryKey,
      categoryColor: r.categoryColor,
      subcategory: r.subcategory || null,
      detail: r.detail || null,
      concept: r.concept || null,
      lat: r.lat === '' ? null : Number(r.lat),
      lng: r.lng === '' ? null : Number(r.lng),
      paymentMethod: r.paymentMethod || 'no_credito',
      chargeMonth: r.chargeMonth || '',
      currency: r.currency || 'CHF',
    }))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const incomeRows = readAll_(SHEET_INGRESOS, INGRESOS_HEADERS);
  const income = {};
  const incomeMovements = [];
  incomeRows.forEach((r) => {
    const currency = r.currency || 'CHF';
    const key = r.monthKey + ':' + currency;
    const amt = Number(r.amount) || 0;
    if (!income[key]) income[key] = { amount: 0, updatedAt: r.updatedAt };
    income[key].amount += amt;
    if (String(r.updatedAt) > String(income[key].updatedAt)) income[key].updatedAt = r.updatedAt;
    incomeMovements.push({
      id: r.id ? String(r.id) : '',
      monthKey: r.monthKey,
      currency: currency,
      amount: amt,
      concept: r.concept || null,
      ts: r.updatedAt,
    });
  });
  incomeMovements.sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const savings = readAll_(SHEET_AHORROS, AHORROS_HEADERS)
    .map((r) => ({ id: String(r.id), ts: r.ts, amount: Number(r.amount), concept: r.concept || null, purpose: r.purpose || null, location: r.location || null }))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const assets = readAll_(SHEET_BIENES, BIENES_HEADERS)
    .map((r) => ({
      id: String(r.id),
      name: r.name,
      type: r.type,
      currency: r.currency,
      value: Number(r.value) || 0,
      debt: Number(r.debt) || 0,
      updatedAt: r.updatedAt,
    }));

  const proyectos = readAll_(SHEET_PROYECTOS, PROYECTOS_HEADERS)
    .map((r) => {
      let items = [];
      try { items = JSON.parse(r.items || '[]'); } catch (e) { items = []; }
      return { id: String(r.id), name: r.name, type: r.type, currency: r.currency, items: items, updatedAt: r.updatedAt };
    });

  return { transactions, income, incomeMovements, savings, assets, proyectos, config: getConfig_() };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const callback = e.parameter.callback;
  const action = e.parameter.action;
  let result;

  if (!action || action === 'all') {
    result = buildAllData_();
  } else if (action === 'addTransaction') {
    const tx = JSON.parse(e.parameter.tx);
    appendRow_(SHEET_GASTOS, GASTOS_HEADERS, tx);
    if (tx.paymentMethod) setConfigValue_('lastPaymentMethod', tx.paymentMethod);
    if (tx.currency) setConfigValue_('lastCurrency', tx.currency);
    result = { ok: true };
  } else if (action === 'deleteTransaction') {
    deleteRowById_(SHEET_GASTOS, GASTOS_HEADERS, e.parameter.id);
    result = { ok: true };
  } else if (action === 'addIncome') {
    const mv = JSON.parse(e.parameter.mv);
    addIncome_(mv.monthKey, mv.currency || 'CHF', Number(mv.amount), mv.concept);
    result = { ok: true };
  } else if (action === 'deleteIncome') {
    deleteIncomeById_(e.parameter.id);
    result = { ok: true };
  } else if (action === 'addSavings') {
    appendRow_(SHEET_AHORROS, AHORROS_HEADERS, JSON.parse(e.parameter.mv));
    result = { ok: true };
  } else if (action === 'deleteSavings') {
    deleteRowById_(SHEET_AHORROS, AHORROS_HEADERS, e.parameter.id);
    result = { ok: true };
  } else if (action === 'setConfig') {
    setConfigValue_(e.parameter.key, e.parameter.value);
    result = { ok: true };
  } else if (action === 'saveAsset') {
    upsertAsset_(JSON.parse(e.parameter.asset));
    result = { ok: true };
  } else if (action === 'deleteAsset') {
    deleteRowById_(SHEET_BIENES, BIENES_HEADERS, e.parameter.id);
    result = { ok: true };
  } else if (action === 'saveProyecto') {
    upsertProyecto_(JSON.parse(e.parameter.proyecto));
    result = { ok: true };
  } else if (action === 'deleteProyecto') {
    deleteRowById_(SHEET_PROYECTOS, PROYECTOS_HEADERS, e.parameter.id);
    result = { ok: true };
  } else {
    result = buildAllData_();
  }

  // JSONP: si viene "callback", devolvemos JS ejecutable en vez de JSON puro.
  // Esto esquiva la restricción CORS porque el navegador lo carga como <script>, no como fetch().
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOutput_(result);
}
