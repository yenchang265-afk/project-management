/* Notification fan-out — called from the commands route AFTER a successful
   append. Best-effort by design: a notify failure must never fail the command,
   so the impure entry point swallows (and logs) every error.
   The planning core is pure and unit-tested: watchers come from the engine fold,
   @mentions from extractMentions, and the actor is never notified. */
import { deriveItem, label, type Item, type PdlcEvent } from "@/lib/engine";
import { getUsers } from "./repo/structure";
import { createNotifications, type NotificationDraft } from "./repo/notifications";
import { emailNotifications } from "./mailer";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pure: which of `names` are @mentioned in `text`? Case-insensitive full-name
 *  match ("@maya chen" → "Maya Chen"); the name must end at a word boundary so
 *  "@Maya Chenoweth" doesn't mention "Maya Chen". De-duplicated. */
export function extractMentions(text: string, names: string[]): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const re = new RegExp("@" + escapeRegExp(name) + "(?![\\p{L}\\p{N}_])", "iu");
    if (re.test(text) && !out.includes(name)) out.push(name);
  }
  return out;
}

const snippet = (text: string) => (text.length > 120 ? text.slice(0, 117) + "…" : text);

/** Pure: plan the notification rows for one appended event.
 *  TRANSITION → watchers; ITEM_COMMENT → watchers + @mentions (mention wins
 *  when both apply). The acting user is always excluded. */
export function planNotifications(
  item: Item, event: PdlcEvent, users: { id: string; name: string }[],
): NotificationDraft[] {
  if (event.type !== "TRANSITION" && event.type !== "ITEM_COMMENT") return [];

  const watching = new Set([...deriveItem(item).watchers].map((n) => n.toLowerCase()));
  const actor = event.actor.toLowerCase();
  const rows: NotificationDraft[] = [];

  if (event.type === "TRANSITION") {
    const message = `${event.actor} moved ${item.id} to ${label(String(event.to))}`;
    for (const u of users) {
      const name = u.name.toLowerCase();
      if (name === actor || !watching.has(name)) continue;
      rows.push({ userId: u.id, itemId: item.id, kind: "transition", message });
    }
    return rows;
  }

  // ITEM_COMMENT — watchers get "comment", @mentions get "mention" (one row each)
  const text = event.text ?? "";
  const mentioned = new Set(extractMentions(text, users.map((u) => u.name)).map((n) => n.toLowerCase()));
  for (const u of users) {
    const name = u.name.toLowerCase();
    if (name === actor) continue;
    const isMention = mentioned.has(name);
    if (!isMention && !watching.has(name)) continue;
    rows.push({
      userId: u.id, itemId: item.id,
      kind: isMention ? "mention" : "comment",
      message: isMention
        ? `${event.actor} mentioned you on ${item.id}: ${snippet(text)}`
        : `${event.actor} commented on ${item.id}: ${snippet(text)}`,
    });
  }
  return rows;
}

/** Impure entry point (route calls this fire-and-forget). `item` is the
 *  pre-append item — watchers are unaffected by TRANSITION / ITEM_COMMENT. */
export async function notifyAfterCommand(item: Item, event: PdlcEvent): Promise<void> {
  try {
    if (event.type !== "TRANSITION" && event.type !== "ITEM_COMMENT") return;
    const users = await getUsers();
    const rows = planNotifications(item, event, users);
    if (rows.length) {
      await createNotifications(rows);
      void emailNotifications(rows); // optional channel — no-op without SMTP_URL
    }
  } catch (e) {
    // best-effort: the command already succeeded — log and move on
    console.error("[notify] fan-out failed:", e instanceof Error ? e.stack : e);
  }
}
