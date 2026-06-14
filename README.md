<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AI Medley Architect

AI Medley Architect analyzes local audio, plans transitions with specialist AI models, and renders deterministic MP3 medleys with FFmpeg.

## Model Modes

- **Automatic Specialist Team:** OpenRouter only. Nemotron 3 Super creates the project brief, Nemotron 3 Ultra handles arrangement and review, and Nex-N2-Pro executes transitions and finalization.
- **Manual Model:** Preserves the existing Gemini and OpenRouter model choices, including custom OpenRouter model IDs.

Automatic mode analyzes audio locally and requires an OpenRouter API key before a run can start.

## Run Locally

Prerequisites: Node.js and FFmpeg support provided by the project dependencies.

1. Run `npm install`.
2. Optionally create `.env.local` with `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY`. Keys can also be entered in the app configuration.
3. Run `npm run dev`.
4. Open [http://localhost:3000](http://localhost:3000).

## Verification

- `npm test`
- `npm run lint`
- `npm run build`

Automatic sessions use version-3 checkpoints and immutable candidate manifests under `workdir/<sessionId>/`. Older version-2 checkpoints continue through the legacy manual workflow.
