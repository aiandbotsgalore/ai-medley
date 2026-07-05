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
}) {
  const store = resolveStore(input);
  const library = store.read();
  const index = library.findIndex((entry) => entry.id === input.id);
  if (index === -1) return { deleted: false };

  const entry = library[index];
  const sourcePath = String(entry.path || "");
  const sourceExists = Boolean(sourcePath) && fs.existsSync(sourcePath);
  const quarantinePath = sourceExists
    ? `${sourcePath}.deleting-${randomUUID()}`
    : null;
  if (quarantinePath) fs.renameSync(sourcePath, quarantinePath);

  const nextLibrary = library.filter((_, entryIndex) => entryIndex !== index);
  try {
    store.write(nextLibrary);
  } catch (error) {
    if (quarantinePath && fs.existsSync(quarantinePath)) {
      fs.renameSync(quarantinePath, sourcePath);
    }
    throw error;
  }

  if (quarantinePath) {
    try {
      fs.rmSync(quarantinePath, { force: true });
    } catch (deleteError) {
      try {
        if (fs.existsSync(quarantinePath)) {
          fs.renameSync(quarantinePath, sourcePath);
        }
        store.write(library);
      } catch (rollbackError) {
        throw new AggregateError(
          [deleteError, rollbackError],
          `Failed to delete or roll back library source ${sourcePath}`,
        );
      }
      throw deleteError;
    }
  }

  return { deleted: true };
}
