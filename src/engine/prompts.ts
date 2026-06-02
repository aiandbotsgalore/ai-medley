import { Type } from '@google/genai';
import type { MedleyConfig } from '../components/ConfigPanel';
import type { LibraryFile } from '../components/LibrarySidebar';
import type { MedleyDesignPayload } from './medleyIntelligence';
import { diagnosePayload } from '../utils/payloadDiagnostics';

// ... existing code ...

export function buildSystemPrompt(
  lib: LibraryFile[],
  config: MedleyConfig,
  medleyDesign?: MedleyDesignPayload | null,
  sessionId?: string
): string {
  // === NEW: Payload Diagnostics ===
  if (medleyDesign) {
    diagnosePayload(medleyDesign, 'MedleyDesignPayload');
  }

  const styleInstructions: Record<string, string> = {
    'dj-set': `STYLE: DJ Set Mode`,
    'smooth-transitions': `STYLE: Smooth Transitions`,
    'mashup': `STYLE: Mashup`,
    'acoustic': `STYLE: Acoustic`,
    'custom': `STYLE: Custom`
  };

  const medleyDesignBlock = medleyDesign
    ? `# Medley Design JSON\n${JSON.stringify(medleyDesign, null, 2)}`
    : '# Medley Design JSON\nUnavailable.';

  return `You are AI Medley Architect.\n\n${styleInstructions[config.style] || styleInstructions['smooth-transitions']}\n\n${sessionId ? `Session ID: ${sessionId}\n` : ''}\n\n${medleyDesignBlock}\n\n# FINAL DESIGN GUIDANCE...\n\n# Library\n${lib.map(f => `${f.id} - ${f.originalName}`).join('\n')}
`;
}

// ... rest of file ...