/* Notification fan-out — called from the commands route AFTER a successful
   append. Best-effort by design: a notify failure must never fail the command,
   so the impure entry point swallows (and logs) every error.
   The planning core is pure and unit-tested: watchers come from the engine fold,
   @mentions from extractMentions, and the actor is never notified. */
import { deriveItem, label, type Item, type PdlcEvent } from "@/lib/engine";
import { getUsers, getStructure } from "./repo/structure";
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

/** Pure: which group members are @mentioned in `text` via their group name?
 *  Reuses extractMentions over the group names (same word-boundary rule), then
 *  returns the de-duped union of the matched groups' members. */
export function expandGroupMentions(
  text: string,
  groups: { name: string; members: string[] }[],
): string[] {
  if (!text || groups.length === 0) return [];
  const hit = new Set(extractMentions(text, groups.map((g) => g.name)));
  const out: string[] = [];
  for (const g of groups) {
    if (!hit.has(g.name)) continue;
    for (const m of g.members) if (!out.includes(m)) out.push(m);
  }
  return out;
}

const snippet = (text: string) => (text.length > 120 ? text.slice(0, 117) + "…" : text);

const COMMENT_TYPES = new Set(["ITEM_COMMENT", "WI_COMMENT"]);

/** Pure: plan the notification rows for one appended event.
 *  TRANSITION → watchers; ITEM_COMMENT → watchers + @mentions; WI_COMMENT →
 *  the work item's assignee + item watchers + @mentions. Mention wins when
 *  several apply; the acting user is always excluded. */
export function planNotifications(
  item: Item, event: PdlcEvent, users: { id: string; name: string }[],
  groups: { name: string; members: string[] }[] = [],
): NotificationDraft[] {
  if (event.type !== "TRANSITION" && !COMMENT_TYPES.has(event.type)) return [];

  const snap = deriveItem(item);
  const watching = new Set([...snap.watchers].map((n) => n.toLowerCase()));
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

  // comment events — watchers get "comment", @mentions get "mention" (one row
  // each). A WI_COMMENT also notifies the target work item's assignee and names
  // the work item rather than the parent item.
  const text = event.text ?? "";
  const mentioned = new Set([
    ...extractMentions(text, users.map((u) => u.name)),
    ...expandGroupMentions(text, groups),
  ].map((n) => n.toLowerCase()));
  const assignees = new Set<string>();
  let where = item.id;
  if (event.type === "WI_COMMENT") {
    const wi = snap.workItems.find((w) => w.id === event.wiId);
    if (wi?.assignee) assignees.add(wi.assignee.toLowerCase());
    if (event.wiId) where = event.wiId;
  }

  for (const u of users) {
    const name = u.name.toLowerCase();
    if (name === actor) continue;
    const isMention = mentioned.has(name);
    if (!isMention && !watching.has(name) && !assignees.has(name)) continue;
    rows.push({
      userId: u.id, itemId: item.id,
      kind: isMention ? "mention" : "comment",
      message: isMention
        ? `${event.actor} mentioned you on ${where}: ${snippet(text)}`
        : `${event.actor} commented on ${where}: ${snippet(text)}`,
    });
  }
  return rows;
}

/** Impure entry point (route calls this fire-and-forget). `item` is the
 *  pre-append item — watchers are unaffected by TRANSITION / ITEM_COMMENT. */
export async function notifyAfterCommand(item: Item, event: PdlcEvent): Promise<void> {
  try {
    if (event.type !== "TRANSITION" && !COMMENT_TYPES.has(event.type)) return;
    const users = await getUsers();
    const struct = await getStructure();
    const groups = struct.teams.map((t) => ({ name: t.name, members: t.members.map((m) => m.name) }));
    const rows = planNotifications(item, event, users, groups);
    if (rows.length) {
      await createNotifications(rows);
      void emailNotifications(rows); // optional channel — no-op without SMTP_URL
    }
  } catch (e) {
    // best-effort: the command already succeeded — log and move on
    console.error("[notify] fan-out failed:", e instanceof Error ? e.stack : e);
  }
}
