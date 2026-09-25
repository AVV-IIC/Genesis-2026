'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

// ---- input validation ----------------------------------------------------------

function str(value, { label = 'Field', max = 200, required = false, trim = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') fail(400, `${label} must be text.`);
  let s = String(value);
  if (trim) s = s.trim();
  if (required && !s) fail(400, `${label} is required.`);
  if (s.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
  return s;
}

function num(value, { label = 'Value', min = -Infinity, max = Infinity, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) fail(400, `${label} must be a number.`);
  if (n < min || n > max) fail(400, `${label} must be between ${min} and ${max}.`);
  return n;
}

function int(value, opts = {}) {
  const n = num(value, opts);
  if (n !== null && !Number.isInteger(n)) fail(400, `${opts.label || 'Value'} must be a whole number.`);
  return n;
}

const bool = (value) => value === true || value === 1 || value === '1' || value === 'true';

function oneOf(value, options, label = 'Value') {
  if (!options.includes(value)) fail(400, `${label} must be one of: ${options.join(', ')}.`);
  return value;
}

function isoDate(value, { label = 'Date', nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(400, `${label} is not a valid date and time.`);
  return d.toISOString();
}

function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) fail(404, 'Not found.');
  return n;
}

// ---- CSV --------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  text = String(text).replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Guard against spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows));
}

function parseMembers(value) {
  if (Array.isArray(value)) return value.map((m) => String(m).trim()).filter(Boolean).slice(0, 12);
  return String(value || '')
    .split(/[;|\n]/)
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 12);
}

module.exports = {
  HttpError,
  fail,
  str,
  num,
  int,
  bool,
  oneOf,
  isoDate,
  idParam,
  parseCsv,
  toCsv,
  sendCsv,
  parseMembers,
};
