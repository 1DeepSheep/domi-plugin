---
name: asr-refine
description: "Refine raw ASR transcripts into accurate, publication-ready records using a strict two-stage workflow: (1) identify and web-verify names, companies, products, and technical terms, then (2) correct factual errors and rewrite for clarity while preserving full speaker structure and timeline. Use for interview transcripts, meeting recordings, podcast drafts, and any noisy speech-to-text output that needs high-accuracy correction instead of summarization."
---

# ASR Refine

## Goal

Transform noisy ASR text into accurate and readable transcript-style documents.
Never summarize by default; keep complete content and dialogue flow.

## Workflow

### Stage 1: Context Analysis and Mandatory Verification

1. Read the full source transcript first.
2. Extract key entities and suspect errors:
- People names
- Company and product names
- Domain terminology and abbreviations
- Obvious homophone/ASR corruption candidates
3. Use available web search tools to verify uncertain spellings and identities.
4. Build an internal correction map:
- `wrong_term -> correct_term`
- person/company/term canonical forms

Rules:
- Do not guess when confidence is low.
- Prefer verified and current spellings for names, products, and technologies.
- Keep a short list of high-impact corrections for user-visible reporting.

### Stage 2: Full Transcript Refinement

Rewrite the transcript end to end using the verified context.

Apply all rules:
1. Replace incorrect entities/terms with verified forms.
2. Remove verbal fillers and ASR noise while preserving meaning.
3. Fix grammar and word order for clear written language.
4. Preserve structure:
- Keep all speaker turns
- Keep timestamps if present
- Do not merge or delete dialogue blocks unless user asks
5. For unreadable fragments, infer conservatively from local context and verified terms.

## Output Requirements

1. Start with `核心修正项` (3-5 important corrections, if available).
2. Then output the complete refined transcript.
3. For long outputs, write to a Markdown file such as `<basename>-refined.md`.

## Guardrails

- Do not convert transcript tasks into summary tasks unless explicitly requested.
- Do not silently drop uncertain content; either repair with clear confidence or preserve wording.
- If user provides custom terminology, treat it as highest-priority reference.
