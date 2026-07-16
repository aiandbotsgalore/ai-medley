# Automatic Workflow v4 Visual Guide

Automatic v4 owns one selected-track set for the lifetime of a session. Local
analysis and the deterministic design snapshot establish the authoritative
facts. OpenRouter may choose an arrangement from measured candidates and review
registered rendered audio, but it never produces a context brief, invents
timestamps, executes FFmpeg tools, or approves a final on the user's behalf.

```mermaid
flowchart LR
  U["Selected library tracks"] --> A["Local analysis"]
  A --> D["design-v4.json + designHash"]
  D --> P["OpenRouter constrained arrangement choice"]
  P --> R["arrangement-vN.json"]
  R --> X["Deterministic transition execution"]
  X --> C["Candidate MP3 + manifest evidence"]
  C --> T["Technical gate"]
  T -->|"passes"| M["OpenRouter listens to rendered audio"]
  T -->|"invalid but preserved"| V["Candidate Review"]
  M -->|"recommended"| O{"Distinct safe option available?"}
  O -->|"yes"| P
  O -->|"no or draft limit"| V
  M -->|"safe correction"| K["One bounded local correction"]
  K --> X
  M -->|"provider failure or no safe correction"| V
  V -->|"human chooses a valid draft"| H["Append-only human approval"]
  H --> F["Journaled final promotion"]
  V -->|"resume interrupted promotion"| F
  F --> Q["Byte identity + FFmpeg decode + completed journal"]
  Q --> Z["Verified final MP3"]
```

Every automatic mutation is serialized per session, revisioned, and can use an
idempotency key. Candidate technical, musical, human, and correction evidence
is append-only. A correction may only mutate permitted transition fields;
exhausted or non-actionable corrections enter manual review rather than repeat
the same render. The internal manual-review state opens Candidate Review with
all preserved drafts, one A/B player, review evidence, local paths, human
approval, and interrupted-finalization recovery. AI review is recommendation
evidence only. Completion is derived from the
verified finalization transaction, never from the presence of a candidate.
Manual Model mode is separate and retains its intentional expert shell/file-
access boundary when the user explicitly enables it.
