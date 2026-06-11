import { NextResponse } from "next/server";
import type { ZodType } from "zod";

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
