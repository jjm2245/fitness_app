"use client";

import { useState } from "react";
import styles from "./session.module.css";

// The ⋯ card menu — holds everything that used to be a permanent button:
// Swap · Move up / down · Remove exercise · Check progression · Undo swap.
// A lightweight popover (not a sheet): it's used mid-workout and must be fast.
export interface CardMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function CardMenu({ items, label = "Exercise menu" }: { items: CardMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.menuWrap} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={styles.menuBtn} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <>
          <button type="button" className={styles.menuBackdrop} aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className={styles.menuCard} role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${it.danger ? styles.menuItemDanger : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
