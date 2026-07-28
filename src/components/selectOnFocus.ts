"use client";

import { useRef } from "react";

/**
 * Props that make a numeric input select its contents when you tap into it, so
 * the first keystroke REPLACES what's there instead of appending to it.
 *
 * `onFocus={e => e.currentTarget.select()}` on its own DOES NOT WORK, and looks
 * like it does until you drive a real field. The browser's own mouseup lands
 * after the focus handler and collapses the selection to a caret: measured in
 * the running app, `selectionStart/End` came back `[2, 2]` on a field showing
 * `81` rather than the `[0, 2]` the select() had just set. Typing then appended,
 * which is the exact bug this was meant to fix.
 *
 * So the mouseup that COMPLETES the focusing tap is suppressed. Later ones are
 * left alone, which keeps drag-selecting inside an already-focused field
 * working — the flag is what distinguishes the two.
 *
 * This is deliberately one shared helper rather than three inlined handlers:
 * the subtlety above is not something a call site should have to re-derive.
 */
export function useSelectOnFocus() {
  const justFocused = useRef(false);
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      justFocused.current = true;
      e.currentTarget.select();
    },
    onMouseUp: (e: React.MouseEvent<HTMLInputElement>) => {
      if (!justFocused.current) return;
      justFocused.current = false;
      e.preventDefault(); // keep the selection the focus handler just made
    },
    onBlur: () => {
      justFocused.current = false;
    },
  };
}
