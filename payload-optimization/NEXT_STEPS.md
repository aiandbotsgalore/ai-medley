# Next Steps - Payload Optimization

## Immediate Goal
Start measuring actual Gemini payload sizes and composition.

## Step 1: Run Diagnostics
We need to instrument the code where Gemini requests are built.

**Action required from you:**
Tell me the file path where the Gemini request payload is assembled (usually something like `src/engine/medleyIntelligence.ts` or a prompt builder file).

Once you give me the file, I will:
1. Analyze it
2. Provide the exact diagnostic code to add
3. Tell you where to insert it

## Step 2: Capture Baseline
After diagnostics are added, we will run it on several medleys and record the results.

Please reply with the relevant file path(s) when ready.