# Feature Design: ChatGPT Saver V2

## Overview

V2 enhancements: (1) PDF streaming renderer, (2) selective message export, (3) IndexedDB full-text search, (4) prompt template library. All synced to `src/` and `extension/content/core.js`.

## Architecture

New modules: `src/utils/searchIndex.js`, `src/utils/templateManager.js`. Enhanced: `src/utils/pdfExporter.js`, `src/utils/exporter.js`, `src/content/content.js`.

## Components and Interfaces

### PDF Stream Renderer (enhanced `pdfExporter.js`)
- `exportStreamed(options)` → Promise<Blob> — batch rendering with progress callback
- `renderBatch(messages, startIdx, batchSize)` → Promise<Canvas>
- `assemblePDF(canvases, title)` → Blob

### Selection Manager (new in `content.js`)
- `activate()`, `deactivate()`, `toggle(index)`, `shiftSelect(index)`
- `getSelectedMessages(allMessages)` → Message[]
- `clear()`

### Search Index (`src/utils/searchIndex.js`)
- `indexConversation(entry)` → Promise<void>
- `search(query)` → Promise<SearchResult[]>
- `extractSnippet(text, keyword, contextLength)` → string
- `removeEntry(id)`, `cleanup()`

### Template Manager (`src/utils/templateManager.js`)
- `getAll()`, `save(template)`, `update(id, changes)`, `remove(id)`
- `extractVariables(content)` → string[]
- `applyTemplate(content, variables)` → string
- `serialize(data)` / `deserialize(json)`

## Data Models

### Search Index Entry
```json
{"id":"","title":"","workspace":"","url":"","timestamp":"","textContent":"","messageCount":0}
```

### Prompt Template
```json
{"id":"","name":"","content":"","createdAt":"","updatedAt":""}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Batch count covers all messages
*For any* conversation with N messages and batch size B, the Stream Renderer SHALL produce exactly ceil(N/B) batches, and the union of all batch ranges SHALL cover indices 0 through N-1.
**Validates: Requirements 1.1**

### Property 2: Selection toggle is an involution
*For any* selection state and any message index, toggling the index twice SHALL return the selection to its original state.
**Validates: Requirements 2.2**

### Property 3: Shift-select produces contiguous range
*For any* two message indices i and j (where i ≤ j), shift-selecting from i to j SHALL result in all indices from i to j inclusive being selected.
**Validates: Requirements 2.3**

### Property 4: Fragment export preserves order and content
*For any* list of messages and any subset of selected indices, `getSelectedMessages` SHALL return exactly the messages at those indices, in their original order.
**Validates: Requirements 2.4, 2.5**

### Property 5: Search index entry contains all required fields
*For any* conversation data, the index entry SHALL contain non-empty values for id, title, workspace, url, timestamp, and textContent.
**Validates: Requirements 3.1**

### Property 6: Snippet extraction contains keyword
*For any* text and any keyword substring, `extractSnippet` SHALL return a string containing the keyword.
**Validates: Requirements 3.3**

### Property 7: Chinese substring search matches
*For any* Chinese text and any contiguous substring used as query, the search SHALL return a match.
**Validates: Requirements 3.5**

### Property 8: Variable extraction finds all placeholders
*For any* string with N unique `{{variable_name}}` patterns, `extractVariables` SHALL return exactly N unique names.
**Validates: Requirements 4.2**

### Property 9: Template variable replacement is complete
*For any* template with `{{var}}` placeholders and a complete variable mapping, `applyTemplate` SHALL produce a string with zero `{{...}}` patterns.
**Validates: Requirements 4.4**

### Property 10: Template edit preserves creation timestamp
*For any* template, updating content SHALL not change createdAt.
**Validates: Requirements 4.5**

### Property 11: Template delete removes exactly one
*For any* list of N templates and valid id, deleting SHALL result in N-1 templates without that id.
**Validates: Requirements 4.6**

### Property 12: Template data serialization round-trip
*For any* valid template data, `deserialize(serialize(data))` SHALL deeply equal original.
**Validates: Requirements 5.1, 5.2**

## Error Handling

- PDF batch failure → skip batch, log, continue
- IndexedDB unavailable → search disabled with message
- Empty search query → empty results
- Incomplete variable mapping → preserve unmatched `{{var}}`
- Storage write failure → error toast
- DOM change during selection → auto-exit selection mode

## Testing Strategy

- PBT library: **fast-check**
- Test runner: **vitest**
- Each property = one PBT with 100+ iterations
- Tag format: `**Feature: chatgpt-saver-v2, Property N: text**`
- Test files: `tests/pdfStreamRenderer.test.mjs`, `tests/selectionManager.test.mjs`, `tests/searchIndex.test.mjs`, `tests/templateManager.test.mjs`
