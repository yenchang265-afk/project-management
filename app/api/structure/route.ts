import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { getStructure } from "@/server/repo/structure";
import { getScope, scopeStructure } from "@/server/scope";

export const GET = withAuth(async (_req, user) => {
  const structure = await getStructure();
  const scope = await getScope(user);
  return NextResponse.json({ success: true, data: scopeStructure(structure, scope) });
});
