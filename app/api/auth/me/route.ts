import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";

export const GET = withAuth(async (_req, user) => {
  return NextResponse.json({ success: true, data: { user } });
});
