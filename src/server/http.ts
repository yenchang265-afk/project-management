import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import type { AuthedUser } from "./auth";

/** PM-only guard for admin routes (Phase 3: PM acts as admin until real RBAC). */
export function requirePM(user: AuthedUser): NextResponse | null {
  if (user.role !== "PM")
    return NextResponse.json({ success: false, error: "Only PM can administer projects and teams." }, { status: 403 });
  return null;
}

export async function parseBody<T>(req: Request, schema: ZodType<T>):
  Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return { ok: false, res: NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return { ok: false, res: NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 }) };
  return { ok: true, data: parsed.data };
}
