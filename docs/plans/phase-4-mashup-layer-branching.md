# Phase 4: Mashup Layer Branching in Final Render

**Date:** 2026-05
**Status:** Starting implementation
**Phase:** Moving beyond pure-sequential MVP

## Context

After stabilizing the pure-clean sequential finalize_medley (Phase 3 / MVP), we now have a reliable single-pass renderer for standard crossfade transitions.

The agent already supports `mashup_layer` as a transition style during BUILD (special EQ carving in `apply_musical_transition`).

However, the final render in `finalize_medley` currently ignores `style` entirely and always produces a strictly linear sequential acrossfade chain.

## Goal

Enable the final medley render to support **simultaneous layering** (mashup_layer style) by generating branched filter graphs when a transition specifies `style: 'mashup_layer'`.

This allows creative overlapping where two (or more) musical elements play at the same time with appropriate frequency carving and mixing, rather than a clean handoff.

## Hook Points in Current Architecture

1. **Transition objects in designPlan** already carry (or can carry) a `style` field from the agent's `apply_musical_transition` calls.
2. `apply_musical_transition` already does style-specific processing for previews (extra EQ for mashup_layer).
3. The enrichment step in `/api/apply-transition` can be extended to persist the `style`.
4. `finalize_medley` is the single place that builds the authoritative final filter graph from the locked designPlan.

## Design Decisions

- **Keep preview path unchanged**: `apply_musical_transition` continues to produce short preview files for auditioning.
- **Final render branching**: When `finalize_medley` sees `style === 'mashup_layer'` between two segments, it generates a branched subgraph instead of a simple `acrossfade`.
- **Simple initial branching model** (MVP for Phase 4):
  - Identify the overlap region for the mashup.
  - Create parallel processed streams from both source segments during the mashup window.
  - Use `amix` (or `acrossfade` + side processing) to layer them.
  - Apply the style-specific EQ carving (similar to what apply-transition already does for previews).
  - Return to the main sequential chain after the mashup layer ends.
- Use deterministic labels (e.g. `mash_layer_0`, `layer_main`, `layer_side`).
- Still write everything via `-filter_complex_script`.
- Hard validation still applies (missing timings etc.).

## Implementation Steps

1. Ensure `style` is persisted on transitions during enrichment in apply-transition.
2. In finalize_medley, when iterating transitions, read `t.style`.
3. Refactor the graph builder to support "join modes":
   - `crossfade` (default sequential)
   - `mashup_layer` (branched simultaneous mix)
4. For mashup_layer joins, generate the appropriate branched filter lines.
5. Update success/error logging to clearly indicate when layered branching was used.
6. Add basic tests / manual verification path.

## Risks / Scope Control

- Do not turn this into a full general Graph DSL yet.
- Start with support for `mashup_layer` only.
- Keep the linear path as the default for all other styles.
- Maintain the "original sources only + single pass" guarantee.

## Success Criteria

- Agent can specify `style: 'mashup_layer'` on one or more transitions.
- Final render produces a valid filter graph that layers the two tracks simultaneously for that section with EQ carving.
- Output is gap-free and the layered section is audible as intended.
- The three debug artifacts clearly document the branching that occurred.
- No regression on normal sequential crossfade renders.

## Next After This Phase

- Style plugin system (pluggable per-style graph fragments)
- Automation curves on layers
- Full multi-layer mashups (more than two sources)
