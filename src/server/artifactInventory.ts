import fs from "node:fs";
import path from "node:path";

export type ArtifactReference = {
  filePath: string;
  reason:
    | "source"
    | "completed-output"
    | "candidate"
    | "manifest"
    | "checkpoint"
    | "active-session";
};

export type ArtifactInventoryItem = {
  relativePath: string;
  sizeBytes: number;
  category: ArtifactReference["reason"] | "reparse" | "unknown";
  action: "preserve";
};

export function buildArtifactInventory(input: {
  roots: string[];
  references: ArtifactReference[];
  activeSessionIds?: string[];
}): ArtifactInventoryItem[] {
  const referenceMap = new Map(
    input.references.map((reference) => [
      path.resolve(reference.filePath).toLowerCase(),
      reference.reason,
    ]),
  );
  const active = new Set(input.activeSessionIds ?? []);
  const items: ArtifactInventoryItem[] = [];
  for (const rootValue of input.roots) {
    if (!fs.existsSync(rootValue)) continue;
    const root = path.resolve(rootValue);
    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        const relativePath = `${path.basename(root)}/${path.relative(root, fullPath).replace(/\\/g, "/")}`;
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) {
          items.push({
            relativePath,
            sizeBytes: lstat.size,
            category: "reparse",
            action: "preserve",
          });
          continue;
        }
        if (lstat.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!lstat.isFile()) continue;
        const referenced = referenceMap.get(path.resolve(fullPath).toLowerCase());
        const firstSegment = path.relative(root, fullPath).split(path.sep)[0];
        const category =
          referenced ??
          (active.has(firstSegment) ? "active-session" : "unknown");
        items.push({
          relativePath,
          sizeBytes: lstat.size,
          category,
          action: "preserve",
        });
      }
    }
  }
  return items.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function summarizeArtifactInventory(items: ArtifactInventoryItem[]) {
  const byCategory: Record<string, { files: number; bytes: number }> = {};
  for (const item of items) {
    const summary = byCategory[item.category] ?? { files: 0, bytes: 0 };
    summary.files++;
    summary.bytes += item.sizeBytes;
    byCategory[item.category] = summary;
  }
  return {
    mode: "inventory-only" as const,
    files: items.length,
    bytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    byCategory,
    deletionCandidates: 0,
  };
}
