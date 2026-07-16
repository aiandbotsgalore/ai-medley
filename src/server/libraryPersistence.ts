import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  readJsonArrayFile,
  writeJsonArrayFileAtomic,
} from "./jsonStore";

export type LibraryEntry = Record<string, unknown> & {
  id: string;
  path: string;
};

export type UploadedFileRecord = {
  filename: string;
  originalname: string;
  path: string;
  size: number;
  mimetype: string;
  sha256?: string;
};

export type LibraryStoreOperations = {
  read: () => LibraryEntry[];
  write: (data: LibraryEntry[]) => void;
};

export type LibraryDeletionRecord = {
  schemaVersion: 1;
  id: string;
  originalPath: string | null;
  quarantinePath: string | null;
  status: "pending" | "quarantined";
  requestedAt: string;
  updatedAt: string;
};

export type LibraryDeletionStoreOperations = {
  read: () => LibraryDeletionRecord[];
  write: (data: LibraryDeletionRecord[]) => void;
};

function resolveStore(input: {
  dbPath?: string;
  store?: LibraryStoreOperations;
}): LibraryStoreOperations {
  if (input.store) return input.store;
  if (!input.dbPath) throw new Error("Library persistence requires dbPath");
  return {
    read: () => readJsonArrayFile<LibraryEntry>(input.dbPath!),
    write: (data) => writeJsonArrayFileAtomic(input.dbPath!, data),
  };
}

function resolveDeletionStore(input: {
  dbPath?: string;
  deletionStore?: LibraryDeletionStoreOperations;
}): LibraryDeletionStoreOperations {
  if (input.deletionStore) return input.deletionStore;
  if (!input.dbPath) throw new Error("Library deletion requires dbPath");
  const deletionPath = `${input.dbPath}.deletions.json`;
  return {
    read: () =>
      fs.existsSync(deletionPath)
        ? readJsonArrayFile<LibraryDeletionRecord>(deletionPath)
        : [],
    write: (data) => writeJsonArrayFileAtomic(deletionPath, data),
  };
}

function removeStagedFiles(files: UploadedFileRecord[]) {
  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
    } catch {
      // Preserve the original persistence failure. The caller still receives an
      // error and can report any remaining staged path from its upload logs.
    }
  }
}

export function commitUploadedFiles(input: {
  dbPath?: string;
  files: UploadedFileRecord[];
  store?: LibraryStoreOperations;
  now?: () => string;
}) {
  const store = resolveStore(input);
  const now = input.now ?? (() => new Date().toISOString());
  try {
    const library = store.read();
    const newEntries: LibraryEntry[] = input.files.map((file) => ({
      id: file.filename.split(".")[0],
      originalName: file.originalname,
      filename: file.filename,
      path: file.path,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: now(),
      ...(file.sha256 ? { sha256: file.sha256 } : {}),
    }));
    store.write([...library, ...newEntries]);
    return newEntries;
  } catch (error) {
    removeStagedFiles(input.files);
    throw error;
  }
}

export function deleteLibraryEntryTransactional(input: {
  dbPath?: string;
  id: string;
  store?: LibraryStoreOperations;
  deletionStore?: LibraryDeletionStoreOperations;
  now?: () => string;
}) {
  const store = resolveStore(input);
  const deletionStore = resolveDeletionStore(input);
  const now = input.now ?? (() => new Date().toISOString());
  const library = store.read();
  const index = library.findIndex((entry) => entry.id === input.id);
  if (index === -1) return { deleted: false };

  const entry = library[index];
  const sourcePath = String(entry.path || "");
  const sourceExists = Boolean(sourcePath) && fs.existsSync(sourcePath);
  const quarantinePath = sourceExists
    ? `${sourcePath}.deleting-${randomUUID()}`
    : null;
  const requestedAt = now();
  const existingDeletions = deletionStore.read();
  const pending: LibraryDeletionRecord = {
    schemaVersion: 1,
    id: input.id,
    originalPath: sourceExists ? sourcePath : null,
    quarantinePath,
    status: "pending",
    requestedAt,
    updatedAt: requestedAt,
  };
  // Write intent before moving source bytes. A crash at any later boundary
  // leaves a recoverable record instead of silently deleting user audio.
  deletionStore.write([...existingDeletions, pending]);
  try {
    if (quarantinePath) fs.renameSync(sourcePath, quarantinePath);
  } catch (error) {
    deletionStore.write(existingDeletions);
    throw error;
  }

  const nextLibrary = library.filter((_, entryIndex) => entryIndex !== index);
  try {
    store.write(nextLibrary);
  } catch (error) {
    if (quarantinePath && fs.existsSync(quarantinePath)) {
      fs.renameSync(quarantinePath, sourcePath);
    }
    deletionStore.write(existingDeletions);
    throw error;
  }

  const quarantined: LibraryDeletionRecord = {
    ...pending,
    status: "quarantined",
    updatedAt: now(),
  };
  try {
    deletionStore.write([...existingDeletions, quarantined]);
  } catch {
    // The pending intent and quarantined source are both retained. Startup
    // reconciliation can safely classify this as a recoverable deletion.
  }

  return { deleted: true, quarantinePath };
}
