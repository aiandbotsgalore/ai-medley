import {
  ArrangementPlanSchema,
  type ArrangementPlan,
} from "../types/specialistWorkflow";

export const CORRECTION_POLICY_VERSION = 1 as const;

const SAFE_CORRECTION_STYLES = [
  "smooth_blend",
  "beat_aligned",
  "harmonic_blend",
  "energy_ramp",
  "dramatic_cut",
  "reset_moment",
] as const;

/** The server, not the provider, owns the bounded correction catalog. */
export function bindAutomaticCorrectionPolicy(plan: ArrangementPlan) {
  return ArrangementPlanSchema.parse({
    ...plan,
    transitions: plan.transitions.map((transition) => ({
      ...transition,
      executionPermissions: {
        styleMutable: true,
        allowedStyles: [...new Set([transition.style, ...SAFE_CORRECTION_STYLES])],
        durationMutable: true,
        minDuration: Math.max(1, Number((transition.duration - 1).toFixed(3))),
        maxDuration: Math.min(30, Number((transition.duration + 1).toFixed(3))),
        beatAlignMutable: false,
      },
    })),
  });
}

export function getAllowedCorrectionPresets(
  transition: Pick<
    ArrangementPlan["transitions"][number],
    "duration" | "style" | "executionPermissions"
  >,
) {
  const permissions = transition.executionPermissions;
  const presets: Array<
    | "shorter_crossfade"
    | "longer_crossfade"
    | "smooth_blend"
    | "beat_aligned"
    | "energy_ramp"
    | "harmonic_blend"
    | "dramatic_cut"
    | "reset_moment"
    | "mashup_layer"
  > = [];
  if (
    permissions?.durationMutable &&
    transition.duration - 0.5 >= (permissions.minDuration ?? transition.duration)
  ) presets.push("shorter_crossfade");
  if (
    permissions?.durationMutable &&
    transition.duration + 0.5 <= (permissions.maxDuration ?? transition.duration)
  ) presets.push("longer_crossfade");
  if (permissions?.styleMutable) {
    presets.push(
      ...(permissions.allowedStyles ?? []).filter(
        (style) => style !== transition.style && style !== "mashup_layer",
      ),
    );
  }
  return [...new Set(presets)];
}
