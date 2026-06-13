"use client";

import { useMemo, useState } from "react";
import {
  ITEM_LINK_KINDS, ITEM_LINK_LABELS, itemInboundLinks,
  type Item, type ItemLinkKind, type Snapshot,
} from "@/lib/engine";
import { CollapsibleCard } from "./CollapsibleCard";

/* Cross-item links (ITEM_LINK / ITEM_UNLINK events, derived into snap.links).
   Informational v1 — links never gate spine transitions. Outgoing links are
   editable here; the inbound direction is computed from the other items via
   itemInboundLinks and shown read-only. Both roles may link/unlink. */
interface ItemLinksProps {
  item: Item;
  snap: Snapshot;
  all: Item[];
  onLink: (to: string, linkKind: ItemLinkKind) => void;
  onUnlink: (to: string, linkKind: ItemLinkKind) => void;
}

export function ItemLinks({ item, snap, all, onLink, onUnlink }: ItemLinksProps) {
  const [draftKind, setDraftKind] = useState<ItemLinkKind>("relates");
  const [draftTarget, setDraftTarget] = useState("");

  const inbound = useMemo(() => itemInboundLinks(item, all), [item, all]);
  const titleOf = useMemo(() => new Map(all.map((it) => [it.id, it.title])), [all]);

  const candidates = useMemo(
    () =>
      all.filter(
        (other) =>
          other.id !== item.id &&
          !snap.links.some((l) => l.to === other.id && l.linkKind === draftKind),
      ),
    [all, item.id, snap.links, draftKind],
  );

  function add() {
    if (!draftTarget) return;
    onLink(draftTarget, draftKind);
    setDraftTarget("");
  }

  const count = snap.links.length + inbound.length;

  return (
    <CollapsibleCard title={<>Links <span className="wi-cc">{count}</span></>} sub="informational · never gates">
        <div className="item-links">
          {count === 0 && <div className="wi-empty">No links yet.</div>}
          {snap.links.map((l) => (
            <div className="item-link-row" key={`out-${l.linkKind}-${l.to}`}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <span className="kpill">{ITEM_LINK_LABELS[l.linkKind].out}</span>
              <span className="mono">{l.to}</span>
              <span style={{ color: "var(--text-3)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {titleOf.get(l.to) ?? "(unknown item)"}
              </span>
              <button className="act" aria-label={`Unlink ${l.to}`} title="Remove link"
                onClick={() => onUnlink(l.to, l.linkKind)}>✕</button>
            </div>
          ))}
          {inbound.map((l) => (
            <div className="item-link-row" key={`in-${l.linkKind}-${l.from}`}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", opacity: 0.85 }}>
              <span className="kpill">{ITEM_LINK_LABELS[l.linkKind].in}</span>
              <span className="mono">{l.from}</span>
              <span style={{ color: "var(--text-3)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {titleOf.get(l.from) ?? "(unknown item)"}
              </span>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>inbound</span>
            </div>
          ))}
        </div>
        <div className="item-link-add" style={{ display: "flex", gap: 6, paddingTop: 8 }}>
          <select aria-label="Link kind" value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as ItemLinkKind)}>
            {ITEM_LINK_KINDS.map((k) => <option key={k} value={k}>{ITEM_LINK_LABELS[k].out}</option>)}
          </select>
          <select aria-label="Link target" value={draftTarget} style={{ flex: 1 }}
            onChange={(e) => setDraftTarget(e.target.value)}>
            <option value="">Select item…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}
          </select>
          <button className="act primary" onClick={add} disabled={!draftTarget}>Link</button>
        </div>
    </CollapsibleCard>
  );
}
