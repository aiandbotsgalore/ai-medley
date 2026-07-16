export function shouldSendManualToolResponses(
  loopFinished: boolean,
  toolResponseCount: number,
) {
  return toolResponseCount > 0 && !loopFinished;
}

export function shouldResetManualToolFailure(batchHadFailure: boolean) {
  return !batchHadFailure;
}
