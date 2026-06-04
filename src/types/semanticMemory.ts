export interface SemanticMemory {
  // Decisions the model has locked in (e.g. track order, confirmed transitions)
  lockedDecisions: string[];

  // Approaches tried and abandoned this session
  rejectedApproaches: string[];

  // Style constraints active for this session
  stylisticConstraints: string[];

  // Problems the model flagged as unresolved
  unresolvedProblems: string[];

  // Transition pairs that rendered successfully
  successfulTransitions: string[];

  // Transition pairs that failed or were rejected
  failedTransitions: string[];

  // Timing constraints derived from apply_musical_transition results
  timingConstraints: string[];

  // Compact rolling narrative for fallback model continuity
  // Updated on every model switch
  recoveryNarrative: string;
}

export function updateSemanticMemoryOnToolResult(
  memory: SemanticMemory,
  toolName: string,
  toolArgs: Record<string, any>,
  toolResult: Record<string, any>
): SemanticMemory {
  const updated = { ...memory };

  if (toolName === 'set_design_plan' && toolResult.success) {
    updated.lockedDecisions = [
      ...updated.lockedDecisions,
      `Design plan locked: ${toolArgs.transitions?.length ?? 0} transitions`
    ];
  }

  if (toolName === 'apply_musical_transition' && toolResult.success) {
    const key = `${toolArgs.fromSectionId}→${toolArgs.toSectionId}`;
    if (!updated.successfulTransitions.includes(key)) {
      updated.successfulTransitions = [...updated.successfulTransitions, key];
    }
    if (toolResult.actualFromExitSec != null && toolResult.actualToEntrySec != null) {
      updated.timingConstraints = [
        ...updated.timingConstraints,
        `${key}: exit=${toolResult.actualFromExitSec}s entry=${toolResult.actualToEntrySec}s`
      ];
    }
  }

  if (toolName === 'apply_musical_transition' && !toolResult.success) {
    const key = `${toolArgs.fromSectionId}→${toolArgs.toSectionId}`;
    if (!updated.failedTransitions.includes(key)) {
      updated.failedTransitions = [...updated.failedTransitions, key];
    }
  }

  return updated;
}

export function buildRecoveryNarrative(
  memory: SemanticMemory,
  iteration: number,
  phase: string
): string {
  const parts: string[] = [
    `Session interrupted at iteration ${iteration} during ${phase} phase.`,
  ];
  if (memory.lockedDecisions.length > 0) {
    parts.push(`Locked decisions: ${memory.lockedDecisions.join('; ')}.`);
  }
  if (memory.successfulTransitions.length > 0) {
    parts.push(`Successful transitions: ${memory.successfulTransitions.join(', ')}.`);
  }
  if (memory.failedTransitions.length > 0) {
    parts.push(`Failed/rejected transitions: ${memory.failedTransitions.join(', ')}.`);
  }
  if (memory.unresolvedProblems.length > 0) {
    parts.push(`Unresolved problems: ${memory.unresolvedProblems.join('; ')}.`);
  }
  return parts.join(' ');
}
