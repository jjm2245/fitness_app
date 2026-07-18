"use client";

import { createPortal } from "react-dom";
import styles from "./Sheet.module.css";

// Bottom-sheet primitive (phase 2): backdrop + slide-up panel with a scrollable
// body. Reused by the Swap, Finish, and Add sheets — sheets scale past what a
// centered modal can hold on a phone.
//
// PORTALED to <body>: a sheet can be opened from inside a card, and a done
// card carries `opacity: 0.62` — opacity < 1 creates a stacking context that
// would trap the fixed overlay under later siblings (and dim it). The portal
// escapes any ancestor stacking context. Client-only by construction (sheets
// render on user action), so document is always available.
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
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.title}>{title}</div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
