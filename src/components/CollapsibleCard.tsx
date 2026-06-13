"use client";

import { useState, type ReactNode } from "react";

/* A .card whose header toggles its body open/closed. Same markup as the plain
   cards (.card / .card-h / .card-b) so styling is unchanged; the header becomes
   a button with a rotating chevron. Used for the secondary detail-page panels
   (History, Analytics, Comments, Links, reviews) so a long item page collapses
   to what the reader cares about. */
export function CollapsibleCard({
  title, sub, defaultOpen = true, className = "", children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"card collapsible-card" + (className ? " " + className : "")} data-open={open}>
      <button type="button" className="card-h card-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="card-chev" data-open={open} aria-hidden="true">▸</span>
        <h3>{title}</h3>
        {sub != null && <span className="mono card-sub">{sub}</span>}
      </button>
      {open && <div className="card-b">{children}</div>}
    </div>
  );
}
