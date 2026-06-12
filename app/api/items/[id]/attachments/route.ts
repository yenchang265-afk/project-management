import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth";
import { createAttachment, listAttachments } from "@/server/repo/attachments";
import { deleteAttachment } from "@/server/repo/attachments";
import { getItem } from "@/server/repo/items";
import { getScope, itemInScope } from "@/server/scope";
import { MAX_ATTACHMENT_BYTES, removeUpload, saveUpload } from "@/server/uploads";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/items/:id/attachments[?wiId=…] — metadata list. */
export const GET = withAuth<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  const [found, scope] = await Promise.all([getItem(id), getScope(user)]);
  if (!found || !itemInScope(found.item.project ?? null, scope))
    return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  const wiId = (new URL(req.url).searchParams.get("wiId") ?? "").trim() || undefined;
  const attachments = await listAttachments(id, wiId);
  return NextResponse.json({ success: true, data: { attachments } });
});

/** POST /api/items/:id/attachments — multipart upload (field "file", optional
 *  "wiId"). 5 MB cap; the stored MIME is the browser-reported type, and the
 *  download route always serves Content-Disposition: attachment + nosniff,
 *  so a lying type can't turn into same-origin script execution. */
export const POST = withAuth<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  const [found, scope] = await Promise.all([getItem(id), getScope(user)]);
  if (!found || !itemInScope(found.item.project ?? null, scope))
    return NextResponse.json({ success: false, error: "Item not found." }, { status: 404 });
  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ success: false, error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ success: false, error: "Missing file." }, { status: 400 });
  if (file.size === 0)
    return NextResponse.json({ success: false, error: "File is empty." }, { status: 422 });
  if (file.size > MAX_ATTACHMENT_BYTES)
    return NextResponse.json({ success: false, error: "Attachments are capped at 5 MB." }, { status: 422 });
  const filename = (file.name || "file").slice(0, 255);
  const mime = (file.type || "application/octet-stream").slice(0, 128);
  const wiIdRaw = form.get("wiId");
  const wiId = typeof wiIdRaw === "string" && wiIdRaw.trim() ? wiIdRaw.trim().slice(0, 32) : null;

  const r = await createAttachment(id, wiId, filename, mime, file.size, user.name);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  try {
    await saveUpload(r.id, Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    await deleteAttachment(r.id); // don't leave a row pointing at nothing
    await removeUpload(r.id);
    throw e;
  }
  return NextResponse.json({ success: true, data: { id: r.id } });
});
