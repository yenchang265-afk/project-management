/* Disk storage for attachments: var/uploads/<attachment id>. The id is always
   server-generated ("att-" + UUID), never derived from user input, so paths
   can't traverse. Original filenames live only in the DB row. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UPLOAD_DIR = join(process.cwd(), "var", "uploads");

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export async function saveUpload(id: string, bytes: Buffer): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, id), bytes);
}

export async function readUpload(id: string): Promise<Buffer | null> {
  try { return await readFile(join(UPLOAD_DIR, id)); } catch { return null; }
}

export async function removeUpload(id: string): Promise<void> {
  // best-effort: a missing file must not block deleting the DB row
  try { await rm(join(UPLOAD_DIR, id)); } catch { /* already gone */ }
}
