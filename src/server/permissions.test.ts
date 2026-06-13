import { describe, expect, it } from "vitest";
import type { AuthedUser } from "./auth";
import { PERMISSIONS, can, requirePerm } from "./permissions";

const pm: AuthedUser = { id: "u-pm", email: "pm@example.com", name: "Pat PM", role: "PM" };
const dev: AuthedUser = { id: "u-dev", email: "dev@example.com", name: "Dee Dev", role: "Dev" };

const PM_ONLY = [
  "manage_orgs",
  "manage_teams",
  "manage_projects",
  "manage_sprints",
  "manage_announcements",
  "manage_metadata",
  "manage_workflows",
  "view_audit",
  "assign_item_project",
  "spawn_iteration",
] as const;

describe("PERMISSIONS matrix", () => {
  it("contains exactly the expected actions", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(
      [...PM_ONLY, "bulk_commands"].slice().sort(),
    );
  });

  it("PM-only rows list only PM", () => {
    for (const action of PM_ONLY) expect(PERMISSIONS[action]).toEqual(["PM"]);
  });

  it("bulk_commands allows both roles", () => {
    expect(PERMISSIONS.bulk_commands).toEqual(["PM", "Dev"]);
  });
});

describe("can()", () => {
  it("allows PM on every action", () => {
    for (const action of PM_ONLY) expect(can(pm, action)).toBe(true);
    expect(can(pm, "bulk_commands")).toBe(true);
  });

  it("denies Dev on PM-only actions", () => {
    for (const action of PM_ONLY) expect(can(dev, action)).toBe(false);
  });

  it("allows Dev on bulk_commands", () => {
    expect(can(dev, "bulk_commands")).toBe(true);
  });

  it("rejects unknown actions at the type level", () => {
    // @ts-expect-error — "deploy_prod" is not a permission action
    expect(() => can(pm, "deploy_prod")).toThrow();
  });
});

describe("requirePerm()", () => {
  it("returns null when the role is allowed", () => {
    expect(requirePerm(pm, "manage_teams")).toBeNull();
    expect(requirePerm(dev, "bulk_commands")).toBeNull();
  });

  it("returns the legacy 403 envelope when denied", async () => {
    const res = requirePerm(dev, "manage_projects");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    await expect(res!.json()).resolves.toEqual({
      success: false,
      error: "Only PM can administer projects and teams.",
    });
  });

  it("denies Dev on every PM-only action with a 403", () => {
    for (const action of PM_ONLY) {
      const res = requirePerm(dev, action);
      expect(res?.status).toBe(403);
    }
  });
});
