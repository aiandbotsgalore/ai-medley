import assert from "node:assert/strict";
import {
  MAX_UPLOAD_FILE_BYTES,
  assertUploadCapacity,
  findDuplicateUpload,
  validateAudioProbe,
  validateUploadMetadata,
} from "./uploadPolicy";

assert.doesNotThrow(() => validateUploadMetadata({ originalname: "song.mp3", size: 10 }));
assert.throws(() => validateUploadMetadata({ originalname: "song.exe", size: 10 }), /extension/i);
assert.throws(() => validateUploadMetadata({ originalname: "song.wav", size: 0 }), /empty/i);
assert.throws(
  () => validateUploadMetadata({ originalname: "song.wav", size: MAX_UPLOAD_FILE_BYTES + 1 }),
  /size limit/i,
);
assert.doesNotThrow(() => validateAudioProbe({ durationSec: 120, audioStreams: 1, channels: 2 }));
assert.throws(() => validateAudioProbe({ durationSec: 0, audioStreams: 1, channels: 2 }), /duration/i);
assert.throws(() => validateAudioProbe({ durationSec: 120, audioStreams: 0, channels: 0 }), /audio stream/i);
assert.doesNotThrow(() => assertUploadCapacity({ availableBytes: 2 * 1024 ** 3, incomingBytes: 10 }));
assert.throws(() => assertUploadCapacity({ availableBytes: 1024 ** 3, incomingBytes: 1 }), /reserve/i);
assert.ok(findDuplicateUpload("abc", [{ sha256: "abc" }]));
assert.equal(findDuplicateUpload("abc", [{ sha256: "def" }]), null);

console.log("uploadPolicy tests passed");
