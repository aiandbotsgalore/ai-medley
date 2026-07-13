import fs from "node:fs";
import path from "node:path";
import type { LibraryEntry, LibraryStoreOperations } from "./libraryPersistence";

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
};

export function recoverOrphanedLibraryAudio(input: {
  audioDir: string;
  store: LibraryStoreOperations;
}) {
  const library = input.store.read();
  const registeredFilenames = new Set(library.map((entry) => String(entry.filename || "")));
  const recovered: LibraryEntry[] = [];
  for (const entry of fs.readdirSync(input.audioDir, { withFileTypes: true })) {
    if (!entry.isFile() || registeredFilenames.has(entry.name)) continue;
    const extension = path.extname(entry.name).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) continue;
    const sourcePath = path.join(input.audioDir, entry.name);
    const stat = fs.statSync(sourcePath);
    recovered.push({
      id: path.basename(entry.name, extension),
      originalName: `Recovered ${entry.name}`,
      filename: entry.name,
      path: sourcePath,
      size: stat.size,
      mimeType,
      uploadedAt: stat.birthtime.toISOString(),
      recovered: true,
    });
  }
  if (recovered.length) input.store.write([...library, ...recovered]);
  return recovered;
}
