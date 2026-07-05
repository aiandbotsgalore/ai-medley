import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LOCAL_ANALYZER_VERSION,
  LOCAL_ANALYSIS_HASH_ALGORITHM,
  LOCAL_ANALYSIS_SCHEMA_VERSION,
  assertValidLocalAnalysis,
  buildLocalAnalysisCacheKey,
  hashAnalysisSource,
  isReusableLocalAnalysis,
} from "./analysisContract";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-analysis-contract-"));
try {
  const source = path.join(root, "source.bin");
  fs.writeFileSync(source, "first bytes");
  const fileHash = hashAnalysisSource(source);
  const valid: any = {
    duration: 10,
    sampleRate: 48000,
    localAnalysisV2: {
      schemaVersion: LOCAL_ANALYSIS_SCHEMA_VERSION,
      baseAnalyzerVersion: LOCAL_ANALYZER_VERSION,
      analyzerVersion: LOCAL_ANALYZER_VERSION,
      fileHash,
      fileHashAlgorithm: LOCAL_ANALYSIS_HASH_ALGORITHM,
      cacheKey: buildLocalAnalysisCacheKey(fileHash),
      advancedAnalysisAvailable: true,
      fallbackUsed: false,
      segments: [{ startSec: 0, endSec: 10 }],
    },
  };
  assertValidLocalAnalysis(valid, fileHash);
  assert.equal(isReusableLocalAnalysis(valid, fileHash), true);

  fs.writeFileSync(source, "changed bytes");
  assert.equal(isReusableLocalAnalysis(valid, hashAnalysisSource(source)), false);
  assert.equal(
    isReusableLocalAnalysis(
      {
        ...valid,
        localAnalysisV2: {
          ...valid.localAnalysisV2,
          baseAnalyzerVersion: "old-analyzer",
        },
      },
      fileHash,
    ),
    false,
  );
  assert.throws(
    () => assertValidLocalAnalysis({ ...valid, duration: 0 }, fileHash),
    /duration/,
  );
  assert.throws(
    () =>
      assertValidLocalAnalysis(
        {
          ...valid,
          localAnalysisV2: {
            ...valid.localAnalysisV2,
            segments: [{ startSec: 0, endSec: Number.NaN }],
          },
        },
        fileHash,
      ),
    /section|NaN/,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("analysisContract tests passed");
