# AI Medley Payload Optimization Plan

**Goal:** Determine the true causes of payload inefficiency, token waste, rate-limit pressure, and medley-planning degradation in AI Medley. Implement the highest-leverage verified improvements. Validate functionality. Benchmark results. Produce a final evidence-based report.

**Status:** Active Execution  
**Last Updated:** 2026-06-01  
**Branch:** payload-optimization  
**Approach:** Truth-first, measurement-driven, quality-preserving. No optimization without evidence.

---

## Core Principles (Non-Negotiable)

1. **Truth-First Reasoning**: Every hypothesis is tested. VERDICT format for conclusions. Follow evidence even if it contradicts prior assumptions.
2. **Measurement Before Action**: Do not optimize what has not been measured.
3. **Quality > Size**: Preserve or improve medley quality.
4. **Safe Optimization Layer**: `compactMedleyIntelligence()` wrapper — original data untouched. Toggleable.
5. **Observability First**: Full instrumentation before any changes.
6. **Golden Dataset**: 10-20 high-quality medleys for regression testing.
7. **Schema & Density Optimization**: Abbreviation + minification first.
8. **Dynamic Metadata**: Use aggregates for MEDIUM/LOW localFacts.
9. **Watch for "Less is More"**: Reduction may improve reasoning quality.

## Success Criteria

(See full version in previous chat or ask Grok to expand. Core ones preserved + GitHub automation added.)

## Phase Plan

### Phase 0: Setup (Current)
- This repo structure is now live.
- Next: Run diagnostics on your local machine.

### Phase 1: Instrumentation
- Grok will provide ready-to-run diagnostic script.
- You run it and commit results to `measurements/`.

Full detailed phases are maintained in the master PLAN.md. Ask Grok to update or expand any section.