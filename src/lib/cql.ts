/* =========================================================================
   CQL — Cadence Query Language. A JQL subset evaluated over flat work-item
   rows. Pure (no React/DOM/DB), engine-style error handling: parseCql never
   throws, it returns { ok, query } | { ok: false, error }.

   Grammar:
     query   := or [ "ORDER BY" field [ "ASC" | "DESC" ] ]
     or      := and ( "OR" and )*
     and     := clause ( "AND" clause )*          — AND binds tighter than OR
     clause  := field op value | field [NOT] IN "(" value ("," value)* ")"
     op      := = | != | ~ | !~ | > | >= | < | <=
     value   := bareword | "quoted string" | number | EMPTY
   ========================================================================= */

/** Flat row shape the queries run against (one row per work item). */
export interface CqlRow {
  id: string;
  title: string;
  item: string;
  type: string;
  state: string;
  assignee: string;
  sprint?: string;
  points?: number;
  priority?: number;
  severity?: number;
  phase?: string;
  tags: string[];
  parent?: string;
  cf: Record<string, string | number>;
}

const FIELDS = new Set([
  "id", "title", "item", "type", "state", "assignee", "sprint",
  "points", "priority", "severity", "phase", "tag", "parent",
]);

type Op = "=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<=";

type Value = { kind: "str"; v: string } | { kind: "num"; v: number } | { kind: "empty" };

type Clause =
  | { kind: "cmp"; field: string; op: Op; value: Value }
  | { kind: "in"; field: string; negate: boolean; values: Value[] };

type Node =
  | { kind: "and"; nodes: Node[] }
  | { kind: "or"; nodes: Node[] }
  | Clause;

export interface CqlQuery {
  where: Node;
  orderBy?: { field: string; desc: boolean };
}

export type CqlParseResult = { ok: true; query: CqlQuery } | { ok: false; error: string };

/* ---------- tokenizer ---------- */

interface Tok { kind: "word" | "str" | "op" | "lparen" | "rparen" | "comma"; v: string }

function tokenize(text: string): Tok[] | string {
  const toks: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(") { toks.push({ kind: "lparen", v: "(" }); i++; continue; }
    if (c === ")") { toks.push({ kind: "rparen", v: ")" }); i++; continue; }
    if (c === ",") { toks.push({ kind: "comma", v: "," }); i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1, out = "";
      for (; j < text.length && text[j] !== quote; j++) out += text[j];
      if (j >= text.length) return `Unterminated string starting at "${text.slice(i, i + 12)}…"`;
      toks.push({ kind: "str", v: out });
      i = j + 1;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "!=" || two === ">=" || two === "<=" || two === "!~") { toks.push({ kind: "op", v: two }); i += 2; continue; }
    if (c === "=" || c === "~" || c === ">" || c === "<") { toks.push({ kind: "op", v: c }); i++; continue; }
    const m = /^[A-Za-z0-9_.\-]+/.exec(text.slice(i));
    if (!m) return `Unexpected character "${c}"`;
    toks.push({ kind: "word", v: m[0] });
    i += m[0].length;
  }
  return toks;
}

/* ---------- parser (recursive descent) ---------- */

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }
  private isKeyword(t: Tok | undefined, kw: string): boolean {
    return !!t && t.kind === "word" && t.v.toUpperCase() === kw;
  }

  parse(): CqlQuery | string {
    const where = this.parseOr();
    if (typeof where === "string") return where;
    let orderBy: CqlQuery["orderBy"];
    if (this.isKeyword(this.peek(), "ORDER")) {
      this.next();
      if (!this.isKeyword(this.peek(), "BY")) return 'Expected BY after ORDER.';
      this.next();
      const f = this.next();
      if (!f || f.kind !== "word") return "Expected a field after ORDER BY.";
      const field = f.v.toLowerCase();
      if (!FIELDS.has(field) && !field.startsWith("cf.")) return `Unknown field "${f.v}".`;
      let desc = false;
      if (this.isKeyword(this.peek(), "ASC")) this.next();
      else if (this.isKeyword(this.peek(), "DESC")) { this.next(); desc = true; }
      orderBy = { field, desc };
    }
    if (this.pos < this.toks.length) return `Unexpected "${this.toks[this.pos].v}".`;
    return { where, orderBy };
  }

  private parseOr(): Node | string {
    const first = this.parseAnd();
    if (typeof first === "string") return first;
    const nodes = [first];
    while (this.isKeyword(this.peek(), "OR")) {
      this.next();
      const n = this.parseAnd();
      if (typeof n === "string") return n;
      nodes.push(n);
    }
    return nodes.length === 1 ? nodes[0] : { kind: "or", nodes };
  }

  private parseAnd(): Node | string {
    const first = this.parseClause();
    if (typeof first === "string") return first;
    const nodes = [first];
    while (this.isKeyword(this.peek(), "AND")) {
      this.next();
      const n = this.parseClause();
      if (typeof n === "string") return n;
      nodes.push(n);
    }
    return nodes.length === 1 ? nodes[0] : { kind: "and", nodes };
  }

  private parseClause(): Node | string {
    if (this.peek()?.kind === "lparen") {
      this.next();
      const inner = this.parseOr();
      if (typeof inner === "string") return inner;
      if (this.peek()?.kind !== "rparen") return "Expected ).";
      this.next();
      return inner;
    }
    const f = this.next();
    if (!f || f.kind !== "word") return "Expected a field name.";
    const field = f.v.toLowerCase();
    if (!FIELDS.has(field) && !field.startsWith("cf."))
      return `Unknown field "${f.v}". Known: ${[...FIELDS].join(", ")}, cf.<key>.`;

    // [NOT] IN (a, b, c)
    let negate = false;
    if (this.isKeyword(this.peek(), "NOT")) { this.next(); negate = true; }
    if (this.isKeyword(this.peek(), "IN")) {
      this.next();
      if (this.peek()?.kind !== "lparen") return "Expected ( after IN.";
      this.next();
      const values: Value[] = [];
      for (;;) {
        const v = this.parseValue();
        if (typeof v === "string") return v;
        values.push(v);
        const t = this.peek();
        if (t?.kind === "comma") { this.next(); continue; }
        if (t?.kind === "rparen") { this.next(); break; }
        return "Expected , or ) in the IN list.";
      }
      if (!values.length) return "IN list can't be empty.";
      return { kind: "in", field, negate, values };
    }
    if (negate) return "Expected IN after NOT.";

    const opTok = this.next();
    if (!opTok || opTok.kind !== "op") return `Expected an operator after "${f.v}".`;
    const value = this.parseValue();
    if (typeof value === "string") return value;
    return { kind: "cmp", field, op: opTok.v as Op, value };
  }

  private parseValue(): Value | string {
    const t = this.next();
    if (!t) return "Expected a value.";
    if (t.kind === "str") return { kind: "str", v: t.v };
    if (t.kind === "word") {
      if (t.v.toUpperCase() === "EMPTY") return { kind: "empty" };
      const n = Number(t.v);
      return Number.isFinite(n) && t.v.trim() !== "" && /^-?[\d.]+$/.test(t.v)
        ? { kind: "num", v: n }
        : { kind: "str", v: t.v };
    }
    return `Expected a value, got "${t.v}".`;
  }
}

export function parseCql(text: string): CqlParseResult {
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: false, error: "Empty query." };
  const toks = tokenize(trimmed);
  if (typeof toks === "string") return { ok: false, error: toks };
  const result = new Parser(toks).parse();
  if (typeof result === "string") return { ok: false, error: result };
  return { ok: true, query: result };
}

/* ---------- evaluator ---------- */

function fieldValue(row: CqlRow, field: string): string | number | string[] | undefined {
  if (field.startsWith("cf.")) return row.cf[field.slice(3)];
  switch (field) {
    case "id": return row.id;
    case "title": return row.title;
    case "item": return row.item;
    case "type": return row.type;
    case "state": return row.state;
    case "assignee": return row.assignee;
    case "sprint": return row.sprint;
    case "points": return row.points;
    case "priority": return row.priority;
    case "severity": return row.severity;
    case "phase": return row.phase;
    case "tag": return row.tags;
    case "parent": return row.parent;
    default: return undefined;
  }
}

function isUnset(v: string | number | string[] | undefined): boolean {
  return v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function eqOne(actual: string | number, expected: Value): boolean {
  if (expected.kind === "empty") return false;
  if (typeof actual === "number") {
    return expected.kind === "num" ? actual === expected.v : String(actual) === expected.v;
  }
  const e = expected.kind === "num" ? String(expected.v) : expected.v;
  return actual.toLowerCase() === e.toLowerCase();
}

function equals(actual: string | number | string[] | undefined, expected: Value): boolean {
  if (expected.kind === "empty") return isUnset(actual);
  if (isUnset(actual)) return false;
  if (Array.isArray(actual)) return actual.some((a) => eqOne(a, expected));
  return eqOne(actual!, expected);
}

function compare(actual: string | number | string[] | undefined, op: Op, expected: Value): boolean {
  switch (op) {
    case "=": return equals(actual, expected);
    case "!=": return !equals(actual, expected);
    case "~": {
      if (expected.kind === "empty" || isUnset(actual)) return false;
      const hay = Array.isArray(actual) ? actual.join(" ") : String(actual);
      const needle = expected.kind === "num" ? String(expected.v) : expected.v;
      return hay.toLowerCase().includes(needle.toLowerCase());
    }
    case "!~": return !compare(actual, "~", expected);
    case ">": case ">=": case "<": case "<=": {
      if (expected.kind !== "num" || isUnset(actual) || Array.isArray(actual)) return false;
      const a = typeof actual === "number" ? actual : Number(actual);
      if (!Number.isFinite(a)) return false;
      if (op === ">") return a > expected.v;
      if (op === ">=") return a >= expected.v;
      if (op === "<") return a < expected.v;
      return a <= expected.v;
    }
  }
}

function evalNode(node: Node, row: CqlRow): boolean {
  switch (node.kind) {
    case "and": return node.nodes.every((n) => evalNode(n, row));
    case "or": return node.nodes.some((n) => evalNode(n, row));
    case "cmp": return compare(fieldValue(row, node.field), node.op, node.value);
    case "in": {
      const actual = fieldValue(row, node.field);
      const hit = node.values.some((v) => equals(actual, v));
      return node.negate ? !hit : hit;
    }
  }
}

/** Filter rows by the query, then apply ORDER BY (unset values sort last;
 *  input order is otherwise preserved — Array.prototype.sort is stable). */
export function runCql(query: CqlQuery, rows: CqlRow[]): CqlRow[] {
  const out = rows.filter((r) => evalNode(query.where, r));
  const ob = query.orderBy;
  if (!ob) return out;
  const dir = ob.desc ? -1 : 1;
  return [...out].sort((a, b) => {
    const va = fieldValue(a, ob.field), vb = fieldValue(b, ob.field);
    const ua = isUnset(va), ub = isUnset(vb);
    if (ua && ub) return 0;
    if (ua) return 1; // unset last regardless of direction
    if (ub) return -1;
    const na = typeof va === "number" ? va : Number(va);
    const nb = typeof vb === "number" ? vb : Number(vb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}
