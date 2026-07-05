import type { AutomaticWorkflowCheckpoint } from "../types/specialistWorkflow";

export async function postAutomaticCheckpoint(
  checkpoint: AutomaticWorkflowCheckpoint,
  options: {
    isActive: () => boolean;
    fetchImpl?: typeof fetch;
  },
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!options.isActive()) {
    throw new DOMException("Superseded checkpoint", "AbortError");
  }
  const response = await fetchImpl("/api/checkpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(checkpoint),
  });
  const data = await response.json().catch(() => ({}));
  if (!options.isActive()) {
    throw new DOMException("Superseded checkpoint", "AbortError");
  }
  if (!response.ok || data?.ok !== true) {
    throw new Error(
      data?.error || `Checkpoint write failed (${response.status})`,
    );
  }
  if (data?.stale) {
    throw new Error("Checkpoint write was rejected as stale");
  }
  return data;
}
