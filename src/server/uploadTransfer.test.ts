import assert from "node:assert/strict";
import { moveUploadedAudioFile } from "./uploadTransfer";

const calls: string[] = [];
moveUploadedAudioFile(
  "C:/temp/upload.mp3",
  "G:/library/audio/upload.mp3",
  {
    constants: { COPYFILE_EXCL: 1 },
    renameSync: (source, destination) => {
      if (source.endsWith(".staging")) {
        calls.push(`publish:${source}:${destination}`);
        return;
      }
      const error = new Error("cross-device link") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    },
    copyFileSync: (source, destination, mode) =>
      calls.push(`copy:${source}:${destination}:${mode}`),
    rmSync: (filePath) => calls.push(`remove:${filePath}`),
  },
  (destination) => `${destination}.staging`,
);
assert.deepEqual(calls, [
  "copy:C:/temp/upload.mp3:G:/library/audio/upload.mp3.staging:1",
  "publish:G:/library/audio/upload.mp3.staging:G:/library/audio/upload.mp3",
  "remove:C:/temp/upload.mp3",
]);

const copyFailureCleanup: string[] = [];
assert.throws(
  () =>
    moveUploadedAudioFile(
      "C:/temp/upload.mp3",
      "G:/library/audio/upload.mp3",
      {
        constants: { COPYFILE_EXCL: 1 },
        renameSync: () => {
          const error = new Error("cross-device link") as NodeJS.ErrnoException;
          error.code = "EXDEV";
          throw error;
        },
        copyFileSync: () => {
          throw new Error("copy failed");
        },
        rmSync: (filePath) => copyFailureCleanup.push(filePath),
      },
      (destination) => `${destination}.staging`,
    ),
  /copy failed/,
);
assert.deepEqual(copyFailureCleanup, ["G:/library/audio/upload.mp3.staging"]);

const ordinaryFailure = new Error("permission denied") as NodeJS.ErrnoException;
ordinaryFailure.code = "EACCES";
assert.throws(
  () =>
    moveUploadedAudioFile("source", "destination", {
      constants: { COPYFILE_EXCL: 1 },
      renameSync: () => {
        throw ordinaryFailure;
      },
      copyFileSync: () => assert.fail("copy must not run for ordinary errors"),
      rmSync: () => assert.fail("remove must not run for ordinary errors"),
    }),
  /permission denied/,
);

console.log("uploadTransfer tests passed");
