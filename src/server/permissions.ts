import { NextResponse } from "next/server";
import type { Role } from "@/lib/engine";
import type { AuthedUser } from "./auth";

/**
 * Declarative permission matrix — the ONE source of truth for who may do what.
 * To change access rules, edit this table; never add inline role checks in routes.
 */
export const PERMISSIONS = {
  manage_orgs: ["PM"],
  manage_teams: ["PM"],
  manage_projects: ["PM"],
  manage_sprints: ["PM"],
  manage_announcements: ["PM"],
  manage_metadata: ["PM"],   // labels, components, custom-field defs
  assign_item_project: ["PM"],
  spawn_iteration: ["PM"],
  bulk_commands: ["PM", "Dev"],
} as const satisfies Record<string, readonly Role[]>;

export type PermissionAction = keyof typeof PERMISSIONS;

export function can(user: AuthedUser, action: PermissionAction): boolean {
  return (PERMISSIONS[action] as readonly Role[]).includes(user.role);
}

/** Route guard: null when allowed, otherwise the legacy 403 envelope. */
export function requirePerm(user: AuthedUser, action: PermissionAction): NextResponse | null {
  if (!can(user, action))
    return NextResponse.json({ success: false, error: "Only PM can administer projects and teams." }, { status: 403 });
  return null;
}
