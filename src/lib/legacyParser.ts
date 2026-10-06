// ============================================================================
// legacyParser.ts — phpMyAdmin SQL dump parser (pure, no DB needed).
// Mirrors rentpro/scripts/lib/legacyParser.ts so the RentPro UI can render
// your REAL legacy data in the new interface without a Postgres backend.
// (In production this is replaced by Prisma queries against PostgreSQL.)
// ============================================================================

export type Cell = string | null;

export interface LegacyTable {
  name: string;
  columns: string[];
  rows: Cell[][];
}

export interface ParsedDump {
  tables: Map<string, LegacyTable>;
  totalRows: number;
  order: string[];
}

const INSERT_RE = /INSERT\s+INTO\s+`([^`]+)`\s*\(([^)]*)\)\s+VALUES/gi;

export function parseLegacyDump(sql: string): ParsedDump {
  const tables = new Map<string, LegacyTable>();
  const order: string[] = [];
  let totalRows = 0;

  let m: RegExpExecArray | null;
  INSERT_RE.lastIndex = 0;
  while ((m = INSERT_RE.exec(sql)) !== null) {
    const tableName = m[1];
    const columns = m[2]
      .split(",")
      .map((c) => c.trim().replace(/`/g, ""));
    const valuesStart = m.index + m[0].length;
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
    INSERT_RE.lastIndex = end;
  }

  return { tables, totalRows, order };
}

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
    default: return c;
  }
}

function parseValue(s: string, start: number): { value: Cell; next: number } {
  let i = skipWhitespace(s, start);
  const c = s[i];
  if (c === "'") {
    i++;
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
        i++;
        break;
      }
      out += ch;
      i++;
    }
    return { value: out, next: i };
  }
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

function parseTuples(s: string, start: number): { rows: Cell[][]; end: number } {
  let i = start;
  const rows: Cell[][] = [];
  const n = s.length;
  while (i < n) {
    i = skipWhitespace(s, i);
    if (i >= n) break;
    if (s[i] === ";") { i++; break; }
    if (s[i] !== "(") break;
    i++;
    const row: Cell[] = [];
    for (;;) {
      i = skipWhitespace(s, i);
      if (s[i] === ")") { i++; break; }
      const v = parseValue(s, i);
      row.push(v.value);
      i = v.next;
      i = skipWhitespace(s, i);
      if (s[i] === ",") { i++; continue; }
      if (s[i] === ")") { i++; break; }
    }
    rows.push(row);
    i = skipWhitespace(s, i);
    if (s[i] === ",") { i++; continue; }
    if (s[i] === ";") { i++; break; }
  }
  return { rows, end: i };
}

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

export function toNum(v: Cell): number {
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toDate(v: Cell): Date | null {
  if (v === null || v === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
