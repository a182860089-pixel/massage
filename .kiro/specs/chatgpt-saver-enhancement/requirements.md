# Requirements Document

## Introduction

Enhancing the ChatGPT Saver extension with: structured JSON export with auto-summary, workspace-level token estimation with budget display, and PDF pagination stability. All features in both `src/` Chrome extension and `extension/content/core.js`.

## Glossary

- **ChatGPT Saver**: Browser extension/userscript that auto-saves ChatGPT conversations
- **JSON Exporter**: New export module outputting structured JSON
- **Token Estimator**: Module estimating token consumption via character heuristics
- **Workspace**: ChatGPT organizational unit from `parser.getWorkspaceName()`
- **Summary Block**: Auto-generated text excerpt of conversation
- **Model Quota**: Usage limits per model from plan config
- **PDF Slicer**: Pagination algorithm for PDF pages
- **Canvas Segmentation**: Per-message canvas rendering approach

## Requirements

### Requirement 1
**User Story:** As a user, I want to export conversations as structured JSON for AI model consumption.

#### Acceptance Criteria
1. WHEN a user enables JSON export, THE JSON Exporter SHALL produce JSON with fields: `title`, `workspace`, `createdAt`, `url`, `messageCount`, `messages[]` (each with `role`, `content`, `textContent`, `index`, `timestamp`)
2. WHEN the JSON Exporter serializes, THE JSON Exporter SHALL produce valid JSON that round-trips back to equivalent data
3. WHEN the JSON Exporter produces output, THE JSON Exporter SHALL include a `summary` field
4. WHEN JSON export is enabled, THE Popup SHALL display a JSON checkbox alongside HTML/MD/PDF
5. WHEN export triggers, THE Exporter SHALL save JSON to same folder structure (workspace/title/json/)

### Requirement 2
**User Story:** As a user, I want auto-generated summaries so I can quickly understand conversation context.

#### Acceptance Criteria
1. WHEN conversation has fewer than 10 messages, THE Summary Generator SHALL include all user questions and assistant responses
2. WHEN conversation has 10-30 messages, THE Summary Generator SHALL include first 3 user questions and last 3 assistant responses
3. WHEN conversation has more than 30 messages, THE Summary Generator SHALL include first 5 user questions and last 5 assistant responses
4. WHEN Summary Generator produces output, THE output SHALL have labeled sections "Key Questions" and "Recent Answers"
5. WHEN Summary Generator receives empty conversation, THE Summary Generator SHALL return empty string

### Requirement 3
**User Story:** As a user, I want to see estimated token consumption per workspace.

#### Acceptance Criteria
1. WHEN a conversation is displayed, THE Token Estimator SHALL estimate tokens: English words by whitespace, Chinese by character count
2. WHEN user views Popup, THE Popup SHALL display workspace name, consumed tokens, and model quota
3. WHEN user switches workspace, THE Popup SHALL display that workspace's token data from storage
4. WHEN user switches back to previous workspace, THE Popup SHALL show previously recorded data
5. WHEN token data is recorded, THE Token Estimator SHALL persist to storage keyed by workspace name
6. WHEN Token Estimator serializes workspace data, THE data SHALL round-trip back to equivalent structure

### Requirement 4
**User Story:** As a user, I want PDF export to handle long conversations without page break artifacts.

#### Acceptance Criteria
1. WHEN PDF Slicer generates multi-page PDF, THE pages SHALL have no visible gaps between consecutive content
2. WHEN conversation exceeds 20 messages, THE PDF Slicer SHALL complete without memory errors
3. WHEN canvas segmentation mode is selected, THE PDF Slicer SHALL render each message as separate canvas
4. WHEN PDF Slicer offers two modes, THE default SHALL be whole-canvas with segmentation as fallback
5. WHEN whole-canvas produces blank strips, THE PDF Slicer SHALL retry with canvas segmentation

### Requirement 5
**User Story:** As a user, I want all features in both Chrome extension and userscript versions.

#### Acceptance Criteria
1. WHEN JSON Exporter is in src/, THE core.js SHALL provide equivalent functionality
2. WHEN Token Estimator is in src/, THE core.js SHALL provide equivalent functionality with GM_setValue/GM_getValue
3. WHEN PDF improvements are in src/, THE core.js SHALL include same improvements

### Requirement 6
**User Story:** As a developer, I want JSON pretty-printer for round-trip validation.

#### Acceptance Criteria
1. WHEN JSON Exporter produces object, THE Pretty-Printer SHALL serialize with 2-space indentation
2. WHEN Pretty-Printer serializes and Exporter deserializes, THE result SHALL equal original input
