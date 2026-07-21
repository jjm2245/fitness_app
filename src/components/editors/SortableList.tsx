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
  children,
}: {
  id: string;
  children: (grip: { ref: (el: HTMLElement | null) => void; props: Record<string, unknown> }) => React.ReactNode;
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
    <div ref={setNodeRef} style={style}>
      {children({ ref: setActivatorNodeRef, props: { ...attributes, ...listeners, className: styles.gripHandle } })}
    </div>
  );
}
