import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { getStructure } from "@/server/repo/structure";

export const GET = withAuth(async () => {
  const structure = await getStructure();
  return NextResponse.json({ success: true, data: structure });
});
