export type WorkspaceTab = "workshop" | "history";

export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1) {
  const destination = index + delta;
  if (index < 0 || index >= items.length || destination < 0 || destination >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(destination, 0, moved);
  return next;
}

export function getAdjacentTab(
  current: WorkspaceTab,
  key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
): WorkspaceTab {
  if (key === "Home") return "workshop";
  if (key === "End") return "history";
  return current === "workshop" ? "history" : "workshop";
}
