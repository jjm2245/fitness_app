"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./session.module.css";

// The ⋯ card menu — holds everything that used to be a permanent button.
// PORTALED to <body> and positioned from the trigger's rect (2.7-1):
// - clamped inside the viewport (right-aligned to the trigger; flips ABOVE
//   when it would overflow the bottom) — it can never spill off-screen;
// - one consistent light scrim that dims the page and closes on tap, so a
//   tap goes to a menu item or the scrim, never to the card behind it;
// - escaping the card's stacking context also keeps it opaque on a
//   collapsed done card (opacity < 1 creates a stacking context).
export interface CardMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

const MENU_WIDTH = 210;
const ITEM_HEIGHT = 44;
const EDGE = 8;

export function CardMenu({ items, label = "Exercise menu" }: { items: CardMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = items.length * ITEM_HEIGHT + 8;
    // Right-align to the trigger, clamped to the viewport.
    const left = Math.max(EDGE, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE));
    // Below the trigger by default; flip above when it would overflow.
    const below = rect.bottom + 4;
    const top = below + menuHeight > window.innerHeight - EDGE ? Math.max(EDGE, rect.top - menuHeight - 4) : below;
    setPos({ top, left });
    setOpen(true);
  }

  return (
    <span className={styles.menuWrap} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.menuBtn}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        ⋯
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div className={styles.menuScrim} onClick={() => setOpen(false)}>
            <div
              className={styles.menuCard}
              role="menu"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
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
          </div>,
          document.body
        )}
    </span>
  );
}
