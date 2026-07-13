import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  commitUploadedFiles,
  deleteLibraryEntryTransactional,
  type LibraryStoreOperations,
} from "./libraryPersistence";

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "ai-medley-library-persistence-"),
);

function stagedFile(name: string, contents = name) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, contents, "utf8");
  return {
    filename: name,
    originalname: name,
    path: filePath,
    size: Buffer.byteLength(contents),
    mimetype: "audio/mpeg",
  };
}

try {
  const upload = stagedFile("upload.mp3");
  let uploadWriteCalled = false;
  const uploadFailureStore: LibraryStoreOperations = {
    read: () => [],
    write: () => {
      uploadWriteCalled = true;
      throw new Error("disk unavailable");
    },
  };
  assert.throws(
    () =>
      commitUploadedFiles({
        files: [upload],
        store: uploadFailureStore,
        now: () => "2026-07-04T00:00:00.000Z",
      }),
    /disk unavailable/,
  );
  assert.equal(uploadWriteCalled, true);
  assert.equal(
    fs.existsSync(upload.path),
    false,
    "A failed library commit must remove its unregistered staged upload",
  );

  const source = stagedFile("source.mp3", "protected source bytes");
  const originalLibrary = [
    {
      id: "source",
      originalName: "source.mp3",
      filename: "source.mp3",
      path: source.path,
      size: source.size,
      mimeType: source.mimetype,
      uploadedAt: "2026-07-04T00:00:00.000Z",
      unknownField: { preserve: true },
    },
  ];
  let deletionRecords: any[] = [];
  const deleteFailureStore: LibraryStoreOperations = {
    read: () => structuredClone(originalLibrary),
    write: () => {
      throw new Error("database write failed");
    },
  };
  assert.throws(
    () =>
      deleteLibraryEntryTransactional({
        id: "source",
        store: deleteFailureStore,
        deletionStore: {
          read: () => structuredClone(deletionRecords),
          write: (records) => { deletionRecords = structuredClone(records); },
        },
      }),
    /database write failed/,
  );
  assert.equal(fs.readFileSync(source.path, "utf8"), "protected source bytes");
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.includes(".deleting-")),
    [],
    "A failed delete commit must restore the source filename",
  );
  assert.deepEqual(deletionRecords, []);

  let committedLibrary: unknown[] = [];
  const successfulDeleteStore: LibraryStoreOperations = {
    read: () => structuredClone(originalLibrary),
    write: (data) => {
      committedLibrary = structuredClone(data);
    },
  };
  const result = deleteLibraryEntryTransactional({
    id: "source",
    store: successfulDeleteStore,
    deletionStore: {
      read: () => structuredClone(deletionRecords),
      write: (records) => { deletionRecords = structuredClone(records); },
    },
    now: () => "2026-07-13T00:00:00.000Z",
  });
  assert.equal(result.deleted, true);
  assert.deepEqual(committedLibrary, []);
  assert.equal(fs.existsSync(source.path), false);
  assert.ok(result.quarantinePath);
  assert.equal(fs.readFileSync(result.quarantinePath!, "utf8"), "protected source bytes");
  assert.equal(deletionRecords.length, 1);
  assert.equal(deletionRecords[0].status, "quarantined");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("libraryPersistence tests passed");
