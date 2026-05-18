# Requirements Document

## Introduction

V2 enhancements for ChatGPT Saver: (1) PDF streaming renderer to fix long conversation freezing, (2) selective message export, (3) full-text search via IndexedDB, (4) prompt template library with variable placeholders. All features in both `src/` Chrome extension and `extension/content/core.js`.

## Glossary

- **ChatGPT Saver**: Browser extension/userscript that auto-saves ChatGPT conversations
- **PDF Slicer**: PDF pagination algorithm module
- **Stream Renderer**: Batch-based renderer processing messages in small groups to avoid memory overflow
- **Selection Mode**: Export mode allowing users to pick specific messages
- **Search Index**: IndexedDB-based full-text search index
- **Prompt Template**: Reusable prompt with `{{variable}}` placeholders
- **Conversation Fragment**: User-selected subset of messages
- **Progress Indicator**: Export progress display

## Requirements

### Requirement 1: PDF 流式分页渲染
**User Story:** As a ChatGPT user, I want to export long conversations to PDF without browser freezing, so that I can save important discussions reliably.

#### Acceptance Criteria
1. WHEN a user exports a conversation with more than 50 messages to PDF, THE Stream Renderer SHALL render messages in batches of 3-5 messages per iteration to prevent main thread blocking
2. WHEN the Stream Renderer processes a batch, THE Stream Renderer SHALL yield control to the browser event loop between batches using requestAnimationFrame or setTimeout
3. WHEN PDF export begins, THE Progress Indicator SHALL display the current progress as "正在导出 X/Y 条消息"
4. WHEN the Stream Renderer completes all batches, THE PDF Slicer SHALL assemble the per-batch canvases into a multi-page PDF document
5. WHEN a conversation of 200 messages is exported, THE PDF Slicer SHALL complete the export within 60 seconds
6. IF the Stream Renderer encounters a memory error during batch rendering, THEN THE PDF Slicer SHALL skip the failed batch, log the error, and continue with remaining batches

### Requirement 2: 选择性导出
**User Story:** As a ChatGPT user, I want to select specific messages from a conversation for export, so that I can save only the relevant parts.

#### Acceptance Criteria
1. WHEN a user activates Selection Mode, THE ChatGPT Saver SHALL display a checkbox overlay next to each message element in the conversation
2. WHEN a user clicks a message checkbox, THE ChatGPT Saver SHALL toggle that message's selected state and update the visual indicator
3. WHEN a user holds Shift and clicks a second checkbox, THE ChatGPT Saver SHALL select all messages between the last clicked checkbox and the current one
4. WHEN a user clicks "导出选中" with selected messages, THE ChatGPT Saver SHALL export only the selected messages using the chosen format
5. WHEN a user exports a Conversation Fragment, THE exported content SHALL contain only the messages that were selected, preserving their original order
6. WHEN Selection Mode is active and no messages are selected, THE "导出选中" button SHALL be disabled

### Requirement 3: 对话全文搜索
**User Story:** As a ChatGPT user, I want to search across all my saved conversations by keyword, so that I can quickly find previously discussed topics.

#### Acceptance Criteria
1. WHEN a conversation is auto-saved, THE Search Index SHALL store the conversation title, message text content, workspace name, URL, and timestamp in IndexedDB
2. WHEN a user types a search query in the search input, THE Search Index SHALL return matching conversations within 500 milliseconds for up to 1000 indexed conversations
3. WHEN search results are displayed, THE ChatGPT Saver SHALL show conversation title, workspace name, and a text snippet containing the matched keyword with surrounding context
4. WHEN a user clicks a search result, THE ChatGPT Saver SHALL open the corresponding ChatGPT conversation URL in a new tab
5. WHEN a user searches with Chinese characters, THE Search Index SHALL match against Chinese text content without requiring word segmentation
6. WHEN the Search Index contains stale entries for deleted conversations, THE Search Index SHALL provide a manual cleanup function accessible from the search panel

### Requirement 4: Prompt 模板库
**User Story:** As a ChatGPT user, I want to save and reuse prompt templates with variable placeholders, so that I can quickly start common types of conversations.

#### Acceptance Criteria
1. WHEN a user saves a prompt template, THE ChatGPT Saver SHALL store the template name, content, and creation timestamp in chrome.storage.local
2. WHEN a template contains `{{variable_name}}` placeholders, THE ChatGPT Saver SHALL detect and list all unique variable names
3. WHEN a user selects a template for use, THE ChatGPT Saver SHALL display a form with input fields for each detected variable placeholder
4. WHEN a user fills in variable values and confirms, THE ChatGPT Saver SHALL replace all `{{variable_name}}` occurrences with the provided values and insert the result into the ChatGPT input field
5. WHEN a user edits an existing template, THE ChatGPT Saver SHALL update the stored template content and preserve the original creation timestamp
6. WHEN a user deletes a template, THE ChatGPT Saver SHALL remove the template from storage and update the template list display

### Requirement 5: Prompt 模板序列化
**User Story:** As a developer, I want a pretty-printer for prompt template data for round-trip validation.

#### Acceptance Criteria
1. WHEN the Prompt Template module serializes template data, THE serializer SHALL produce valid JSON with 2-space indentation
2. WHEN the serializer produces JSON and the deserializer parses it back, THE result SHALL deeply equal the original template data
