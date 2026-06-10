import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { getUsers } from "@/server/repo/structure";

export const GET = withAuth(async () => {
  const users = await getUsers();
  return NextResponse.json({ success: true, data: { users } });
});
