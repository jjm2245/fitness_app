"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Sheet.module.css";

// Bottom-sheet primitive (phase 2): backdrop + slide-up panel with a scrollable
// body. Reused by the Swap, Finish, Add, and New-unit sheets.
//
// PORTALED to <body>: a sheet can be opened from inside a card, and a done
// card carries `opacity: 0.62` — opacity < 1 creates a stacking context that
// would trap the fixed overlay under later siblings (and dim it). The portal
// escapes any ancestor stacking context. Client-only by construction (sheets
// render on user action), so document is always available.
//
// The grab handle is honest (2.5-9): dragging the header zone down past a
// threshold dismisses; otherwise the panel snaps back (no snap animation
// under prefers-reduced-motion). Backdrop tap still closes.
const DISMISS_THRESHOLD_PX = 90;

export function Sheet({
  title,
  subtitle,
  footer,
  onClose,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; delta: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = { startY: e.clientY, delta: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !panelRef.current) return;
    const delta = Math.max(0, e.clientY - drag.current.startY);
    drag.current.delta = delta;
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform = `translateY(${delta}px)`;
  }
  function onPointerUp() {
    if (!drag.current || !panelRef.current) return;
    const { delta } = drag.current;
    drag.current = null;
    const panel = panelRef.current;
    if (delta > DISMISS_THRESHOLD_PX) {
      onClose();
      return;
    }
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.style.transition = reduced ? "none" : "transform 0.18s ease";
    panel.style.transform = "";
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div ref={panelRef} className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div
          className={styles.dragZone}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className={styles.handle} aria-hidden="true" />
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
