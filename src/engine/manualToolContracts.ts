import { Type } from "@google/genai";
import { z } from "zod";

export const MANUAL_TOOL_CONTRACT_VERSION = 1 as const;
const Version = z.literal(MANUAL_TOOL_CONTRACT_VERSION);
const Id = z.string().trim().min(1).max(200);
const PathText = z.string().trim().min(1).max(1_000);
const ShortText = z.string().trim().max(2_000);
const SupportedStyle = z.enum([
  "smooth_blend",
  "beat_aligned",
  "energy_ramp",
  "harmonic_blend",
  "dramatic_cut",
  "reset_moment",
]);

const ManualTransition = z.strictObject({
  fromTrackId: Id,
  fromSectionId: Id,
  toTrackId: Id,
  toSectionId: Id,
  fromExitSec: z.number().nonnegative().optional(),
  toEntrySec: z.number().nonnegative().optional(),
  style: SupportedStyle,
  duration: z.number().positive().max(30).optional(),
  intensity: z.number().min(0).max(1).optional(),
  beatAlign: z.boolean().optional(),
  notes: ShortText.optional(),
});

const schemas = {
  execute_shell_command: z.strictObject({
    contractVersion: Version,
    command: z.string().trim().min(1).max(4_000),
  }),
  listen_to_audio: z.strictObject({
    contractVersion: Version,
    filePath: PathText,
  }),
  evaluate_section_pair: z.strictObject({
    contractVersion: Version,
    fromTrackId: Id,
    fromSectionId: Id,
    toTrackId: Id,
    toSectionId: Id,
  }),
  set_design_plan: z.strictObject({
    contractVersion: Version,
    transitions: z.array(ManualTransition).min(1).max(99),
  }),
  apply_musical_transition: ManualTransition.extend({
    contractVersion: Version,
    duration: z.number().positive().max(30),
    beatAlign: z.boolean(),
  }),
  analyze_medley_quality: z.strictObject({
    contractVersion: Version,
    filePath: PathText,
  }),
  read_file: z.strictObject({
    contractVersion: Version,
    filePath: PathText,
  }),
  write_file: z.strictObject({
    contractVersion: Version,
    filePath: PathText,
    content: z.string().max(100_000),
  }),
  save_file_analysis: z.strictObject({
    contractVersion: Version,
    fileId: Id,
    analysisText: z.string().trim().min(1).max(20_000),
  }),
  report_progress: z.strictObject({
    contractVersion: Version,
    emotionalArc: z.number().int().min(0).max(100),
    transitionSmoothness: z.number().int().min(0).max(100),
    performerIdentity: z.number().int().min(0).max(100),
    overallScore: z.number().int().min(0).max(100),
    iteration: z.number().int().nonnegative().max(50),
    phase: z.enum(["ANALYZE", "DESIGN", "BUILD", "FINISH"]).optional(),
  }),
  finalize_medley: z.strictObject({
    contractVersion: Version,
    summary: ShortText,
  }),
} as const;

export type ManualToolName = keyof typeof schemas;

const descriptions: Record<ManualToolName, string> = {
  execute_shell_command:
    "Run a lightweight filesystem diagnostic in the current session. Audio rendering commands are rejected.",
  listen_to_audio: "Analyze an authorized audio file by path.",
  evaluate_section_pair: "Evaluate one current server-issued section pair.",
  set_design_plan: "Lock a versioned manual transition plan.",
  apply_musical_transition:
    "Render a preview for one supported manual transition. mashup_layer is unavailable.",
  analyze_medley_quality: "Measure local quality for an authorized medley file.",
  read_file: "Read an authorized session file.",
  write_file: "Write an authorized session file.",
  save_file_analysis: "Save bounded analysis text for a library file.",
  report_progress: "Report integer 0-100 progress metrics.",
  finalize_medley: "Render and promote the final candidate. The server owns output paths.",
};

function toGeminiSchema(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  const output: Record<string, unknown> = {};
  if (value.type === "object") output.type = Type.OBJECT;
  else if (value.type === "array") output.type = Type.ARRAY;
  else if (value.type === "number" || value.type === "integer")
    output.type = Type.NUMBER;
  else if (value.type === "boolean") output.type = Type.BOOLEAN;
  else output.type = Type.STRING;
  for (const key of ["description", "enum", "minimum", "maximum"] as const) {
    if (value[key] !== undefined) output[key] = value[key];
  }
  if (value.required) output.required = value.required;
  if (value.items) output.items = toGeminiSchema(value.items);
  if (value.properties) {
    output.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, child]) => [
        key,
        toGeminiSchema(child),
      ]),
    );
  }
  return output;
}

export function getOpenRouterManualTools() {
  return (Object.keys(schemas) as ManualToolName[]).map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: descriptions[name],
      parameters: z.toJSONSchema(schemas[name]),
    },
  }));
}

export function getGeminiManualToolDeclarations() {
  return getOpenRouterManualTools().map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: toGeminiSchema(tool.function.parameters),
  }));
}

export function parseManualToolCall(
  name: string,
  input: unknown,
  options: { allowLegacy?: boolean } = {},
): any {
  const canonicalName = name === "finish_medley" ? "finalize_medley" : name;
  const schema = schemas[canonicalName as ManualToolName];
  if (!schema) throw new Error(`Unknown manual tool: ${name}`);
  let candidate = input;
  if (options.allowLegacy && input && typeof input === "object") {
    const { sessionId: _sessionId, finalMp3Path: _finalPath, useCleanRender: _clean, ...rest } =
      input as Record<string, unknown>;
    candidate = { ...rest, contractVersion: MANUAL_TOOL_CONTRACT_VERSION };
  }
  const result = schema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ${canonicalName} contract: ${issues}`);
  }
  return result.data;
}
