/* Tests for the AI prompt builders (G-27). The model call itself is env-gated
   and not exercised here; these pin the pure prompt construction — the thread
   is rendered, the shift-left risk vocabulary is injected, and team load is
   surfaced — so the prompts stay stable and grounded. aiEnabled gates the
   whole feature on ANTHROPIC_API_KEY. */
import { describe, expect, it } from "vitest";
import {
  aiEnabled, buildAssignmentPrompt, buildCommentSummaryPrompt,
  buildRiskPrompt, buildSprintNarrativePrompt,
} from "./ai";
import type { WiComment } from "@/lib/engine";

const comment = (author: string, text: string): WiComment =>
  ({ id: author, author, role: "PM", ts: 1, text });

describe("aiEnabled", () => {
  it("is false without ANTHROPIC_API_KEY", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiEnabled()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(aiEnabled()).toBe(true);
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe("buildCommentSummaryPrompt", () => {
  it("renders each comment as author: text", () => {
    const p = buildCommentSummaryPrompt([comment("Maya", "ship it"), comment("Sam", "needs QA")]);
    expect(p.user).toContain("Maya: ship it");
    expect(p.user).toContain("Sam: needs QA");
  });
  it("handles an empty thread", () => {
    expect(buildCommentSummaryPrompt([]).user).toContain("no comments");
  });
});

describe("buildRiskPrompt", () => {
  it("injects the shift-left risk vocabulary and the item", () => {
    const p = buildRiskPrompt("Payments revamp", "stores card tokens");
    expect(p.system).toContain("touches_pii");
    expect(p.system).toContain("touches_auth");
    expect(p.system).toContain("new_data_store");
    expect(p.user).toContain("Payments revamp");
    expect(p.user).toContain("stores card tokens");
  });
});

describe("buildSprintNarrativePrompt", () => {
  it("states committed/completed/spilled", () => {
    const p = buildSprintNarrativePrompt({ sprint: "S-12", committed: 30, completed: 22, spilled: 8 });
    expect(p.user).toContain("S-12");
    expect(p.user).toMatch(/30/);
    expect(p.user).toMatch(/22/);
    expect(p.user).toMatch(/8/);
  });
});

describe("buildAssignmentPrompt", () => {
  it("lists candidates with their load", () => {
    const p = buildAssignmentPrompt("Fix login", "", [{ name: "Sam", load: 3 }, { name: "Priya", load: 1 }]);
    expect(p.user).toContain("Sam (3 open items)");
    expect(p.user).toContain("Priya (1 open items)");
    expect(p.user).toContain("Fix login");
  });
});
