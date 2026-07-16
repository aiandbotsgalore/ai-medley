export function reconcileSelectedTrackIds(
  selectedIds: string[],
  knownLibraryIds: string[],
  libraryIds: string[],
  initialized: boolean,
) {
  if (!initialized) return libraryIds;
  const current = new Set(libraryIds);
  const known = new Set(knownLibraryIds);
  const selected = new Set(selectedIds.filter((id) => current.has(id)));
  for (const id of libraryIds) if (!known.has(id)) selected.add(id);
  return libraryIds.filter((id) => selected.has(id));
}

export function toggleSelectedTrackId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function selectLibraryEntriesById<T extends { id: string }>(
  library: T[],
  selectedIds: string[],
) {
  const selected = new Set(selectedIds);
  return library.filter((entry) => selected.has(entry.id));
}
