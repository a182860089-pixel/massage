# Implementation Plan

- [x] 1. Set up testing infrastructure
  - Install vitest and fast-check as dev dependencies
  - Create vitest.config.js with ESM support
  - Create tests/ directory
  - _Requirements: All_

- [x] 2. Implement JSON Exporter and Summary Generator
  - [x] 2.1 Create `src/utils/jsonExporter.js` with export(), serialize(), deserialize()
    - Build JSON with: title, workspace, createdAt, url, messageCount, summary, messages[]
    - Each message: {index, role, content, textContent, timestamp}
    - serialize() uses JSON.stringify(data, null, 2), deserialize() uses JSON.parse
    - _Requirements: 1.1, 1.2, 6.1, 6.2_

  - [x] 2.2 Implement Summary Generator within jsonExporter.js
    - Empty → "", <10 → all, 10-30 → first 3 user + last 3 assistant, >30 → first 5 user + last 5 assistant
    - Format with "Key Questions" and "Recent Answers" sections
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Write property test: JSON output structure completeness
    - **Property 1: JSON output structure completeness**
    - **Validates: Requirements 1.1, 1.3**

  - [x] 2.4 Write property test: JSON serialization round-trip
    - **Property 2: JSON serialization round-trip**
    - **Validates: Requirements 1.2, 6.2**

  - [x] 2.5 Write property test: Summary content correctness
    - **Property 3: Summary content correctness by conversation length**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 2.6 Write property test: Summary format sections
    - **Property 4: Summary format contains required sections**
    - **Validates: Requirements 2.4**

  - [x] 2.7 Write unit tests for JSON Exporter edge cases
    - Test empty conversation, exactly 10/30/31 messages, special characters
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.5_

- [x] 3. Integrate JSON export into pipeline
  - [x] 3.1 Update exporter.js to call JSON Exporter when formats.json enabled
    - _Requirements: 1.1, 1.5_
  - [x] 3.2 Update fileSystem.js to create json/ subfolder
    - _Requirements: 1.5_
  - [x] 3.3 Update popup.html and popup.js for JSON checkbox
    - _Requirements: 1.4_
  - [x] 3.4 Update manifest.json to include jsonExporter.js
    - _Requirements: 1.1_

- [x] 4. Checkpoint
  - All tests pass.

- [x] 5. Implement Token Estimator
  - [x] 5.1 Create `src/utils/tokenEstimator.js`
    - estimateTokens(): English words×1.3 + Chinese chars×1.5, ceil
    - getWorkspaceStats(), recordUsage(), serialize(), deserialize()
    - Persist to chrome.storage.local keyed by workspace
    - _Requirements: 3.1, 3.5, 3.6_
  - [x] 5.2 Write property test: Token estimation monotonicity
    - **Property 5: Token estimation produces positive values proportional to input**
    - **Validates: Requirements 3.1**
  - [x] 5.3 Write property test: Workspace token data round-trip
    - **Property 6: Workspace token data serialization round-trip**
    - **Validates: Requirements 3.6**
  - [x] 5.4 Write unit tests for Token Estimator
    - Empty string, pure English, pure Chinese, mixed
    - _Requirements: 3.1_

- [x] 6. Integrate Token Estimator into Popup
  - [x] 6.1 Update popup.html with Token Budget card
    - _Requirements: 3.2_
  - [x] 6.2 Update popup.js to load/display workspace token data
    - _Requirements: 3.2, 3.3, 3.4_
  - [x] 6.3 Update content.js to record token usage on auto-save
    - _Requirements: 3.5_
  - [x] 6.4 Update manifest.json to include tokenEstimator.js
    - _Requirements: 3.1_

- [x] 7. Checkpoint
  - All tests pass.

- [x] 8. Enhance PDF with segmentation fallback
  - [x] 8.1 Add exportSegmented() to pdfExporter.js
    - _Requirements: 4.3_
  - [x] 8.2 Add detectPageGaps() to pdfExporter.js
    - _Requirements: 4.1_
  - [x] 8.3 Add exportWithFallback() to pdfExporter.js
    - Enhanced: detects page gaps via detectPageGaps(), auto-retries with segmented mode
    - _Requirements: 4.4, 4.5_
  - [x] 8.4 Write unit tests for PDF fallback logic
    - _Requirements: 4.1, 4.4, 4.5_

- [x] 9. Synchronize to core.js
  - [x] 9.1 Add JSON Exporter to core.js
    - JSONExporter + SummaryGenerator modules, JSON format button, JSON saving in folder/download modes
    - _Requirements: 5.1_
  - [x] 9.2 Add Token Estimator to core.js
    - TokenEstimator with GM_setValue/GM_getValue, workspace-level tracking, auto-record on save
    - _Requirements: 5.2_
  - [x] 9.3 Add PDF segmentation fallback to core.js
    - detectPageGaps(), exportSegmented(), exportWithFallback()
    - _Requirements: 5.3_

- [x] 10. Final Checkpoint
  - All 26 tests pass. All features synchronized to core.js.
