// ============================================================================
// legacyParser.ts
// ----------------------------------------------------------------------------
// Parses a phpMyAdmin SQL dump (the `INSERT INTO ... VALUES ...;` statements)
// into typed rows. Pure string parsing with a real state machine — no MySQL
// server required.
//
// It correctly handles:
//   - single-quoted string literals
//   - backslash escapes (\', \", \\, \n, \r, \t, \0, ...)
//   - doubled-quote escapes ('')
//   - NULL
//   - bare numeric tokens (kept as STRINGS to preserve money precision like
//     "24000.00" — convert with Number()/parseFloat() where needed)
//   - multiple INSERT statements for the same table (concatenated)
//   - Bangla (utf8mb4) text — no special handling needed, JS strings are UTF-16
//
// This is the foundation of the migration: if the parser is correct, every
// downstream count and money total is trustworthy.
// ============================================================================

export type Cell = string | null;

export interface LegacyTable {
  name: string;
  columns: string[];
  rows: Cell[][];
}

export interface ParsedDump {
  tables: Map<string, LegacyTable>;
  /** total INSERT rows parsed across all tables */
  totalRows: number;
  /** table names in the order first encountered */
  order: string[];
}

const INSERT_RE =
  /INSERT\s+INTO\s+`([^`]+)`\s*\(([^)]*)\)\s+VALUES/gi;

export function parseLegacyDump(sql: string): ParsedDump {
  const tables = new Map<string, LegacyTable>();
  const order: string[] = [];
  let totalRows = 0;

  let m: RegExpExecArray | null;
  INSERT_RE.lastIndex = 0;
  while ((m = INSERT_RE.exec(sql)) !== null) {
    const tableName = m[1];
    const colGroup = m[2];
    const columns = colGroup
      .split(",")
      .map((c) => c.trim().replace(/`/g, ""));

    const valuesStart = m.index + m[0].length; // char right after "VALUES"
    const { rows, end } = parseTuples(sql, valuesStart);

    let existing = tables.get(tableName);
    if (!existing) {
      existing = { name: tableName, columns, rows: [] };
      tables.set(tableName, existing);
      order.push(tableName);
    } else if (existing.columns.length === 0) {
      existing.columns = columns;
    }
    existing.rows.push(...rows);
    totalRows += rows.length;

    // continue scanning after this INSERT statement
    INSERT_RE.lastIndex = end;
  }

  return { tables, totalRows, order };
}

// --- internal helpers -------------------------------------------------------

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

function skipWhitespace(s: string, i: number): number {
  while (i < s.length && isWhitespace(s[i])) i++;
  return i;
}

function unescapeChar(c: string): string {
  switch (c) {
    case "n": return "\n";
    case "r": return "\r";
    case "t": return "\t";
    case "0": return "\0";
    case "b": return "\b";
    case "Z": return "\x1a";
    case "\\": return "\\";
    case "'": return "'";
    case '"': return '"';
    default: return c; // unknown escape — keep the char literally
  }
}

interface ValueResult {
  value: Cell;
  next: number;
}

function parseValue(s: string, start: number): ValueResult {
  let i = skipWhitespace(s, start);
  const c = s[i];

  if (c === "'") {
    // string literal with backslash + doubled-quote escapes
    i++; // skip opening quote
    let out = "";
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\\") {
        out += unescapeChar(s[i + 1]);
        i += 2;
        continue;
      }
      if (ch === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i++; // closing quote
        break;
      }
      out += ch;
      i++;
    }
    return { value: out, next: i };
  }

  // bare token: NULL, number, or (rarely) unquoted identifier
  let token = "";
  while (
    i < s.length &&
    s[i] !== "," &&
    s[i] !== ")" &&
    !isWhitespace(s[i])
  ) {
    token += s[i];
    i++;
  }
  if (token === "NULL") return { value: null, next: i };
  return { value: token === "" ? null : token, next: i };
}

interface TuplesResult {
  rows: Cell[][];
  end: number;
}

function parseTuples(s: string, start: number): TuplesResult {
  let i = start;
  const rows: Cell[][] = [];
  const n = s.length;

  while (i < n) {
    i = skipWhitespace(s, i);
    if (i >= n) break;
    if (s[i] === ";") { i++; break; }
    if (s[i] !== "(") break; // not a tuple start — end of this INSERT

    i++; // skip '('
    const row: Cell[] = [];
    // parse one tuple's values
    for (;;) {
      i = skipWhitespace(s, i);
      if (s[i] === ")") { i++; break; } // empty tuple or end of tuple
      const v = parseValue(s, i);
      row.push(v.value);
      i = v.next;
      i = skipWhitespace(s, i);
      if (s[i] === ",") { i++; continue; }
      if (s[i] === ")") { i++; break; }
    }
    rows.push(row);

    i = skipWhitespace(s, i);
    if (s[i] === ",") { i++; continue; } // another tuple follows
    if (s[i] === ";") { i++; break; }
  }
  return { rows, end: i };
}

// --- row accessors ----------------------------------------------------------

/** Convert a row array into an object keyed by column name. */
export function rowToObject(
  table: LegacyTable,
  row: Cell[]
): Record<string, Cell> {
  const obj: Record<string, Cell> = {};
  table.columns.forEach((col, idx) => {
    obj[col] = row[idx] ?? null;
  });
  return obj;
}

/** Safely parse a possibly-null cell into a JS number (0 for NULL/empty). */
export function toNum(v: Cell): number {
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Convert 'YYYY-MM-DD' (or NULL) into a Date (or null). */
export function toDate(v: Cell): Date | null {
  if (v === null || v === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v); // fallback for ISO-ish strings
  return Number.isNaN(d.getTime()) ? null : d;
}
