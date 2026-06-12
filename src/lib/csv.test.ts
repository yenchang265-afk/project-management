import { describe, it, expect } from "vitest";
import { mapCsvToWiDrafts, parseCsv } from "./csv";

/* CSV import — pure parse + map (no React/DOM/DB). Imported rows become
   wiCreate command drafts, so flows and guards still apply server-side. */

describe("parseCsv", () => {
  it("splits rows and columns, trimming the trailing newline", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("handles quoted fields with commas, escaped quotes, and newlines", () => {
    expect(parseCsv('a,"x, y"\n"he said ""hi""","multi\nline"')).toEqual([
      ["a", "x, y"],
      ['he said "hi"', "multi\nline"],
    ]);
  });

  it("handles CRLF", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("mapCsvToWiDrafts", () => {
  const header = ["item", "title", "type", "state", "assignee", "sprint", "due_date", "component"];
  const items = new Set(["PAY-412"]);

  it("maps valid rows to per-item drafts", () => {
    const r = mapCsvToWiDrafts([header, ["PAY-412", "Do thing", "task", "todo", "Sam", "S1", "2026-07-01", "API"]], items);
    expect(r.errors).toEqual([]);
    expect(r.drafts).toEqual([{
      itemId: "PAY-412",
      draft: { type: "task", title: "Do thing", assignee: "Sam", state: "todo", sprint: "S1", dueDate: "2026-07-01", component: "API" },
    }]);
  });

  it("requires item + title + type columns and known item ids", () => {
    expect(mapCsvToWiDrafts([["title", "type"], ["x", "task"]], items).errors[0]).toMatch(/item/);
    const bad = mapCsvToWiDrafts([header, ["PAY-999", "x", "task", "", "", "", "", ""]], items);
    expect(bad.errors[0]).toMatch(/PAY-999/);
    expect(bad.drafts).toEqual([]);
  });

  it("rejects bad enums and dates with row numbers; good rows still map", () => {
    const r = mapCsvToWiDrafts([
      header,
      ["PAY-412", "ok row", "story", "", "", "", "", ""],
      ["PAY-412", "bad type", "wishlist", "", "", "", "", ""],
      ["PAY-412", "bad state", "task", "someday", "", "", "", ""],
      ["PAY-412", "bad date", "task", "", "", "", "tomorrow", ""],
      ["PAY-412", "", "task", "", "", "", "", ""],
    ], items);
    expect(r.drafts).toHaveLength(1);
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toMatch(/row 3/i);
  });

  it("empty optional cells are omitted from the draft", () => {
    const r = mapCsvToWiDrafts([header, ["PAY-412", "t", "bug", "", "", "", "", ""]], items);
    expect(r.drafts[0].draft).toEqual({ type: "bug", title: "t", assignee: "" });
  });
});
