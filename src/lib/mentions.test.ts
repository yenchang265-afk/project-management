/* @mention autocomplete — pure token logic. Detects an active "@query" at the
   caret, matches it to known names, and rewrites the text with the canonical
   full name so the server-side extractMentions (which needs an exact full-name
   match) actually fires. */
import { describe, expect, it } from "vitest";
import { activeMention, applyMention, matchNames } from "./mentions";

describe("activeMention", () => {
  it("detects a partial @token at the caret", () => {
    expect(activeMention("hello @ma", 9)).toEqual({ start: 6, query: "ma" });
  });
  it("includes a space so first+last name typeahead works", () => {
    expect(activeMention("hi @Maya C", 10)).toEqual({ start: 3, query: "Maya C" });
  });
  it("matches an @ at the very start", () => {
    expect(activeMention("@ma", 3)).toEqual({ start: 0, query: "ma" });
  });
  it("matches after a newline", () => {
    expect(activeMention("line1\n@sa", 9)).toEqual({ start: 6, query: "sa" });
  });
  it("ignores an @ glued to a previous word (email)", () => {
    expect(activeMention("ping a@b", 8)).toBeNull();
  });
  it("returns null when there is no @ before the caret", () => {
    expect(activeMention("no mention here", 8)).toBeNull();
  });
  it("returns null when a newline sits between the @ and the caret", () => {
    expect(activeMention("@maya\nhello", 11)).toBeNull();
  });
  it("returns the empty query right after a bare @", () => {
    expect(activeMention("hey @", 5)).toEqual({ start: 4, query: "" });
  });
});

describe("matchNames", () => {
  const NAMES = ["Maya Chen", "Sam Okafor", "Priya Patel"];
  it("prefix-matches case-insensitively", () => {
    expect(matchNames("ma", NAMES)).toEqual(["Maya Chen"]);
    expect(matchNames("p", NAMES)).toEqual(["Priya Patel"]);
  });
  it("matches across the space (first + last)", () => {
    expect(matchNames("maya c", NAMES)).toEqual(["Maya Chen"]);
  });
  it("returns all names for an empty query", () => {
    expect(matchNames("", NAMES)).toEqual(NAMES);
  });
  it("returns [] when nothing matches", () => {
    expect(matchNames("zzz", NAMES)).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces the @query with the canonical name + trailing space", () => {
    expect(applyMention("hello @ma", 6, 9, "Maya Chen"))
      .toEqual({ value: "hello @Maya Chen ", caret: 17 });
  });
  it("preserves text after the caret", () => {
    expect(applyMention("hi @ma there", 3, 6, "Maya Chen"))
      .toEqual({ value: "hi @Maya Chen  there", caret: 14 });
  });
});
