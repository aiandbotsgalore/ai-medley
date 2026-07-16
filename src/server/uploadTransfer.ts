import fs from "node:fs";
import { randomUUID } from "node:crypto";

type UploadTransferFileSystem = {
  constants: { COPYFILE_EXCL: number };
  renameSync: (source: string, destination: string) => void;
  copyFileSync: (source: string, destination: string, mode?: number) => void;
  rmSync: (path: string, options?: { force?: boolean }) => void;
};

/**
 * Moves a newly uploaded temporary file into the library. Windows cannot
 * rename across drives, so EXDEV falls back to copy-then-remove. The source is
 * removed only after the destination copy succeeds.
 */
export function moveUploadedAudioFile(
  source: string,
  destination: string,
  fileSystem: UploadTransferFileSystem = fs,
  makeStagingPath: (destinationPath: string) => string = (destinationPath) =>
    `${destinationPath}.uploading-${randomUUID()}`,
) {
  try {
    fileSystem.renameSync(source, destination);
  } catch (error: any) {
    if (error?.code !== "EXDEV") throw error;
    const stagingPath = makeStagingPath(destination);
    try {
      fileSystem.copyFileSync(
        source,
        stagingPath,
        fileSystem.constants.COPYFILE_EXCL,
      );
    } catch (copyError) {
      try {
        fileSystem.rmSync(stagingPath, { force: true });
      } catch {}
      throw copyError;
    }
    try {
      fileSystem.renameSync(stagingPath, destination);
    } catch (publishError) {
      try {
        fileSystem.rmSync(stagingPath, { force: true });
      } catch {}
      throw publishError;
    }
    try {
      fileSystem.rmSync(source, { force: true });
    } catch (removeError) {
      try {
        fileSystem.rmSync(destination, { force: true });
      } catch (rollbackError) {
        throw new AggregateError(
          [removeError, rollbackError],
          "Could not remove the temporary upload or roll back its library copy",
        );
      }
      throw removeError;
    }
  }
}
