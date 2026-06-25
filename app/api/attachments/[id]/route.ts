import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { deleteAttachment, getAttachment } from "@/server/repo/attachments";
import { getItem } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";
import { readUpload, removeUpload } from "@/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

/** ASCII-safe Content-Disposition filename (RFC 6266 filename* carries UTF-8). */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** GET /api/attachments/:id — authenticated download. Always served as an
 *  attachment with nosniff: stored bytes can never run as same-origin HTML. */
export const GET = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  const att = await getAttachment(id);
  if (!att) return NextResponse.json({ success: false, error: "Attachment not found." }, { status: 404 });
  // scope gate: out-of-scope attachments are indistinguishable from missing ones
  const [parent, scope] = await Promise.all([getItem(att.itemId), getScope(user)]);
  if (!parent || !itemInScope(parent.item.project ?? null, scope))
    return NextResponse.json({ success: false, error: "Attachment not found." }, { status: 404 });
  const bytes = await readUpload(att.id);
  if (!bytes) return NextResponse.json({ success: false, error: "Stored file is missing." }, { status: 410 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": att.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": disposition(att.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0",
    },
  });
});

/** DELETE /api/attachments/:id — uploader or PM; must be in-scope. */
export const DELETE = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  const att = await getAttachment(id);
  if (!att) return NextResponse.json({ success: false, error: "Attachment not found." }, { status: 404 });
  // scope gate: same as GET — out-of-scope items are indistinguishable from missing
  const [parent, scope] = await Promise.all([getItem(att.itemId), getScope(user)]);
  if (!parent || !itemInScope(parent.item.project ?? null, scope))
    return NextResponse.json({ success: false, error: "Attachment not found." }, { status: 404 });
  if (att.uploader !== user.id && user.role !== "PM")
    return NextResponse.json({ success: false, error: "Only the uploader or a PM can delete an attachment." }, { status: 403 });
  // Remove disk file first (best-effort): if the subsequent DB delete fails the
  // client sees an error and can retry; an orphaned DB row with no bytes is
  // recoverable (410 on download). The reverse order leaves an orphaned file
  // with no DB record — unrecoverable without manual intervention.
  await removeUpload(id);
  const r = await deleteAttachment(id);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 404 });
  return NextResponse.json({ success: true, data: {} });
});
