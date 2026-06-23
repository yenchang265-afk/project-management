import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { getUsers } from "@/server/repo/structure";

export const GET = withAuth(async (_req, user) => {
  const users = await getUsers();
  // Non-PM users only receive id+name (for @mention autocomplete); roles are PM-visible only.
  const data = user.role === "PM" ? users : users.map(({ id, name }) => ({ id, name }));
  return NextResponse.json({ success: true, data: { users: data } });
});
