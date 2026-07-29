"use client";

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import styles from "./editors.module.css";

// Touch-reliable vertical reorder (phase 3.1) — dnd-kit, not hand-rolled. Drag
// starts only from the grip handle (the rest of the row stays tappable); the
// small activation distance keeps a tap from registering as a drag. The parent
// owns the id order and persists via the bulk reorder endpoint on onReorder.
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (newIds: string[]) => void;
  children: React.ReactNode;
}) {
  // PointerSensor covers touch (pointer events) + mouse; 6px activation so a
  // tap on the grip doesn't start an accidental micro-drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// One sortable row. `children` receives the grip props to spread on the drag
// handle only — so tapping the row body still fires its own onClick.
export function SortableRow({
  id,
  as: Tag = "div",
  children,
}: {
  id: string;
  /** The wrapper's element. `li` when the list container is a real `<ol>`/`<ul>`
   *  — a `<div>` between `<ol>` and `<li>` is invalid, and the session card
   *  list is an `<ol>` whose children are `<li>`s (the same nesting trap the
   *  History timeline hit). The card then renders as a div. */
  as?: "div" | "li";
  children: (grip: { setHandle: (el: HTMLElement | null) => void; handleProps: Record<string, unknown> }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 3 : undefined,
    position: "relative",
  };
  return (
    <Tag ref={setNodeRef} style={style}>
      {children({ setHandle: setActivatorNodeRef, handleProps: { ...attributes, ...listeners, className: styles.gripHandle } })}
    </Tag>
  );
}

/**
 * The sortable wiring for a component that IS its own row — the session cards,
 * whose root is already the `<li>` the list needs.
 *
 * Why this exists rather than `SortableRow`: handing a component the activator
 * setter as a PROP crosses a component boundary with a ref-setting function,
 * and the react-hooks purity rule reports "cannot access refs during render" at
 * every use. Calling the hook inside the card keeps the ref where it is made,
 * and removes the wrapper element (and the `<ol>`/`<li>` nesting problem)
 * altogether.
 */
export function useSortableCard(id: string) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return {
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.65 : 1,
      zIndex: isDragging ? 3 : undefined,
      position: "relative",
    } as React.CSSProperties,
    setHandle: setActivatorNodeRef,
    handleProps: { ...attributes, ...listeners } as Record<string, unknown>,
  };
}
