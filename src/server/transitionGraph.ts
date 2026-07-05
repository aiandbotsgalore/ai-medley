export const SUPPORTED_TRANSITION_STYLES = [
  "smooth_blend",
  "beat_aligned",
  "energy_ramp",
  "harmonic_blend",
  "dramatic_cut",
  "reset_moment",
] as const;

export type SupportedTransitionStyle =
  (typeof SUPPORTED_TRANSITION_STYLES)[number];

export type TransitionStyleConfig = {
  curve1: string;
  curve2: string;
  postJoinFilters: string;
};

export function getTransitionStyleConfig(
  style: string,
): TransitionStyleConfig {
  switch (style) {
    case "smooth_blend":
      return { curve1: "tri", curve2: "tri", postJoinFilters: "" };
    case "beat_aligned":
      return { curve1: "log", curve2: "log", postJoinFilters: "" };
    case "energy_ramp":
      return {
        curve1: "exp",
        curve2: "exp",
        postJoinFilters: ",highpass=f=80",
      };
    case "harmonic_blend":
      return {
        curve1: "tri",
        curve2: "tri",
        postJoinFilters: ",equalizer=f=200:width_type=h:width=1:g=-2",
      };
    case "dramatic_cut":
      return { curve1: "exp", curve2: "exp", postJoinFilters: "" };
    case "reset_moment":
      return { curve1: "log", curve2: "log", postJoinFilters: "" };
    case "mashup_layer":
      throw new Error(
        "mashup_layer is disabled until canonical timeline parity is implemented",
      );
    default:
      throw new Error(`Unsupported transition style: ${style}`);
  }
}

export function buildCanonicalAcrossfade(input: {
  leftLabel: string;
  rightLabel: string;
  outputLabel: string;
  duration: number;
  style: string;
}) {
  if (!(input.duration > 0 && input.duration <= 30)) {
    throw new Error("Transition duration must be greater than 0 and at most 30");
  }
  const config = getTransitionStyleConfig(input.style);
  return (
    `[${input.leftLabel}][${input.rightLabel}]` +
    `acrossfade=d=${input.duration}:curve1=${config.curve1}:curve2=${config.curve2}` +
    `${config.postJoinFilters}[${input.outputLabel}]`
  );
}
