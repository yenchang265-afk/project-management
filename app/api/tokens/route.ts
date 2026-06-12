import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth";
import { parseBody } from "@/server/http";
import { createToken, listTokens } from "@/server/repo/tokens";

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(["read", "write"]),
}).strict();

/** GET /api/tokens — the caller's tokens (names + metadata, never the secret). */
export const GET = withAuth(async (_req, user) => {
  const tokens = await listTokens(user.id);
  return NextResponse.json({ success: true, data: { tokens } });
});

/** POST /api/tokens — mint a token. The response carries the plaintext ONCE;
 *  only its hash is stored. Any signed-in user may mint tokens for themself —
 *  a token can't do more than its owner's role allows. */
export const POST = withAuth(async (req, user) => {
  const body = await parseBody(req, CreateTokenSchema);
  if (!body.ok) return body.res;
  const name = body.data.name.trim();
  if (!name) return NextResponse.json({ success: false, error: "Token needs a name." }, { status: 422 });
  const r = await createToken(user.id, name, body.data.scope);
  return NextResponse.json({ success: true, data: { id: r.id, token: r.token } });
});
