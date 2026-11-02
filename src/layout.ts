/**
 * The window's split layout: tab groups side by side ("row") or stacked ("col"), nested. The layout belongs to
 * the window, not to a project: each group shows its own project.
 */
export type Layout = { group: string } | { dir: "row" | "col"; children: Layout[]; sizes?: number[] };
// `sizes`: each child's share (flex-grow), set by dragging the line between them. Any split or close that changes
// a split's children drops its sizes (back to equal), since they no longer line up.

/** `l` with the split whose groups are `key` (leaves joined by "+") given these sizes. */
export function withSizes(l: Layout, key: string, sizes: number[]): Layout {
  if ("group" in l) return l;
  if (leaves(l).join("+") === key) return { ...l, sizes };
  return { ...l, children: l.children.map((c) => withSizes(c, key, sizes)) };
}
/** Where a dragged tab lands on a group: an edge splits that way, the centre joins the group. */
export type Side = "left" | "right" | "top" | "bottom";

/** Group ids in reading order (left to right, top to bottom). */
export const leaves = (l: Layout): string[] => ("group" in l ? [l.group] : l.children.flatMap(leaves));

/** `l` without group `id`; a split left with one child becomes that child. Null when nothing is left. */
export function without(l: Layout, id: string): Layout | null {
  if ("group" in l) return l.group === id ? null : l;
  const kids = l.children.map((c) => without(c, id)).filter((c): c is Layout => !!c);
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  // a child split running the same way as its parent folds into it, so the tree stays flat
  return { dir: l.dir, children: kids.flatMap((k) => ("dir" in k && k.dir === l.dir ? k.children : [k])) };
}

/** `l` with a new group `id` beside group `target`, on `side`. */
export function insertAt(l: Layout, target: string, id: string, side: Side): Layout {
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  if ("group" in l) return l.group !== target ? l : { dir, children: before ? [{ group: id }, l] : [l, { group: id }] };
  // the target sits right in a split running the same way: join it there instead of nesting another split
  const i = l.children.findIndex((c) => "group" in c && c.group === target);
  if (i >= 0 && l.dir === dir) {
    const kids = [...l.children];
    kids.splice(before ? i : i + 1, 0, { group: id });
    return { dir, children: kids };
  }
  return { dir: l.dir, children: l.children.map((c) => insertAt(c, target, id, side)) };
}

// self-check (dev builds): the layout operations a split / close relies on
if (import.meta.env.DEV) {
  const eq = (a: unknown, b: unknown, what: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) console.error(`layout self-check failed: ${what}`, a, b);
  };
  const two = insertAt({ group: "a" }, "a", "b", "right");
  eq(two, { dir: "row", children: [{ group: "a" }, { group: "b" }] }, "split right");
  const three = insertAt(two, "a", "c", "right");
  eq(leaves(three), ["a", "c", "b"], "same-direction split joins the row");
  const nested = insertAt(two, "b", "d", "bottom");
  eq(nested, { dir: "row", children: [{ group: "a" }, { dir: "col", children: [{ group: "b" }, { group: "d" }] }] }, "split down nests");
  eq(without(nested, "b"), { dir: "row", children: [{ group: "a" }, { group: "d" }] }, "closing collapses");
  eq(without({ group: "a" }, "a"), null, "last group");
}
