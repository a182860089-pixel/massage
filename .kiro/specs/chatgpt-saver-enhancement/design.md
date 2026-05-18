# Feature Design: ChatGPT Saver Enhancement

## Overview

Three enhancements: (1) JSON export with auto-summary, (2) workspace token estimation, (3) PDF pagination stability. All in both `src/` and `extension/content/core.js`.

## Architecture

New modules: `jsonExporter.js`, `tokenEstimator.js`. Enhanced: `pdfExporter.js`, `exporter.js`, `fileSystem.js`, `popup.js/html`.

## Components and Interfaces

### JSON Exporter (`src/utils/jsonExporter.js`)
- `export()` → Object (structured conversation data)
- `serialize(data)` → string (JSON.stringify with 2-space indent)
- `deserialize(jsonString)` → Object (JSON.parse)
- Embedded `SummaryGenerator.generate(messages)` → string

### Token Estimator (`src/utils/tokenEstimator.js`)
- `estimateTokens(text)` → number (English words×1.3 + Chinese chars×1.5, ceil)
- `getWorkspaceStats(workspaceName)` → Promise<{consumed, quota, model}>
- `recordUsage(workspaceName, tokens)` → Promise<void>
- `serialize(data)` / `deserialize(jsonString)` for storage round-trip

### PDF Slicer Enhancement
- `exportSegmented()` → per-message canvas rendering
- `detectPageGaps(canvas, pageHeight)` → boolean
- `exportWithFallback()` → tries whole-canvas, falls back to segmented

## Data Models

### JSON Export Schema
```json
{"title":"","workspace":"","createdAt":"","url":"","messageCount":0,"summary":"","messages":[{"index":0,"role":"","content":"","textContent":"","timestamp":""}]}
```

### Workspace Token Storage
```json
{"workspaceTokens":{"<name>":{"consumed":0,"conversations":{"<title>":{"tokens":0,"lastUpdated":""}},"lastUpdated":""}}}
```

## Correctness Properties

*Properties bridge human-readable specs and machine-verifiable correctness.*

### Property 1: JSON output structure completeness
*For any* valid conversation, JSON output SHALL contain all required fields (title, workspace, createdAt, url, messageCount, summary, messages) and each message SHALL have (index, role, content, textContent, timestamp).
**Validates: Requirements 1.1, 1.3**

### Property 2: JSON serialization round-trip
*For any* valid conversation data, `deserialize(serialize(data))` SHALL deeply equal original.
**Validates: Requirements 1.2, 6.2**

### Property 3: Summary content correctness by conversation length
*For any* conversation with N messages: <10 → all messages in summary; 10-30 → first 3 user + last 3 assistant; >30 → first 5 user + last 5 assistant.
**Validates: Requirements 2.1, 2.2, 2.3**

### Property 4: Summary format contains required sections
*For any* non-empty conversation, summary SHALL contain "Key Questions" and "Recent Answers".
**Validates: Requirements 2.4**

### Property 5: Token estimation monotonicity
*For any* non-empty text, `estimateTokens()` returns positive integer. For prefix A of B, `estimateTokens(A) <= estimateTokens(B)`.
**Validates: Requirements 3.1**

### Property 6: Workspace token data round-trip
*For any* valid workspace token data, `deserialize(serialize(data))` SHALL deeply equal original.
**Validates: Requirements 3.6**

## Error Handling

- Empty conversation → return null, skip file
- Empty string token estimation → return 0
- Storage write failure → log, continue without persist
- PDF whole-canvas gaps → auto-retry with segmented mode
- Canvas memory limit → catch, fall back to segmented

## Testing Strategy

- PBT library: **fast-check**
- Test runner: **vitest**
- Each property = one PBT with 100+ iterations
- Tag format: `**Feature: chatgpt-saver-enhancement, Property N: text**`
- Test files: `tests/jsonExporter.test.js`, `tests/summaryGenerator.test.js`, `tests/tokenEstimator.test.js`, `tests/pdfExporter.test.js`
