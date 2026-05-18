# Implementation Plan

- [x] 1. PDF 流式分页渲染





  - [ ] 1.1 Implement `exportStreamed()`, `renderBatch()`, and `assemblePDF()` in `src/utils/pdfExporter.js`
    - Add `exportStreamed(options)` that iterates messages in batches of configurable size (default 3)
    - Each batch: create temp container with batch messages, render via html2canvas, collect canvas
    - Yield between batches with `await new Promise(r => setTimeout(r, 0))`
    - Call `onProgress(currentIndex, totalMessages)` after each batch
    - `assemblePDF(canvases, title)` combines canvases into multi-page PDF with headers/footers


    - Update `exportWithFallback()` to use `exportStreamed()` as primary method
    - _Requirements: 1.1, 1.2, 1.4, 1.5_



  - [ ] 1.2 Write property test: Batch count covers all messages
    - **Property 1: Batch count covers all messages**

    - **Validates: Requirements 1.1**



  - [x] 1.3 Add progress indicator UI in `src/content/content.js`




    - Show "正在导出 X/Y 条消息..." in the log panel during streamed export
    - Update toast message with progress percentage
    - _Requirements: 1.3_

  - [x] 1.4 Add error recovery for failed batches


    - If html2canvas throws on a batch, skip it, log warning, continue with next batch
    - _Requirements: 1.6_


- [ ] 2. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 3. Selection Manager for selective export
  - [x] 3.1 Create SelectionManager module in `src/content/content.js`


    - Implement `activate()`, `deactivate()`, `toggle(index)`, `shiftSelect(index)`, `getSelectedMessages(allMessages)`, `clear()`
    - `toggle`: add index to Set if absent, remove if present
    - `shiftSelect`: select all indices between lastClickedIndex and current index
    - `getSelectedMessages`: filter allMessages by selectedIndices, preserve order
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_



  - [x] 3.2 Write property test: Selection toggle is an involution


    - **Property 2: Selection toggle is an involution**




    - **Validates: Requirements 2.2**

  - [ ] 3.3 Write property test: Shift-select produces contiguous range
    - **Property 3: Shift-select produces contiguous range**
    - **Validates: Requirements 2.3**

  - [x] 3.4 Write property test: Fragment export preserves order and content


    - **Property 4: Fragment export preserves order and content**
    - **Validates: Requirements 2.4, 2.5**


  - [ ] 3.5 Add Selection Mode UI in `src/content/content.js`
    - Add "选择导出" button in panel

    - When active, inject checkbox overlays next to each message element
    - Show "导出选中 (N)" button, disabled when selection is empty
    - "退出选择" button to deactivate


    - _Requirements: 2.1, 2.6_

  - [ ] 3.6 Wire selected export to Exporter
    - When "导出选中" clicked, call `SelectionManager.getSelectedMessages()` then pass to Exporter
    - Support all formats (HTML/MD/PDF/JSON)
    - _Requirements: 2.4, 2.5_





- [x] 4. Checkpoint




  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Full-text search with IndexedDB
  - [ ] 5.1 Create `src/utils/searchIndex.js` with IndexedDB operations
    - Open/create IndexedDB database `ChatGPTSaverSearchDB` with `conversations` object store
    - `indexConversation(entry)`: store entry with id, title, workspace, url, timestamp, textContent, messageCount
    - `search(query)`: iterate all entries, match query against title and textContent (case-insensitive substring match)
    - `extractSnippet(text, keyword, contextLength)`: return substring around first keyword occurrence with contextLength chars on each side
    - `removeEntry(id)`, `cleanup()`: delete entries


    - Export for both browser and Node.js test environments
    - _Requirements: 3.1, 3.2, 3.3, 3.5_


  - [ ] 5.2 Write property test: Search index entry contains all required fields
    - **Property 5: Search index entry contains all required fields**

    - **Validates: Requirements 3.1**

  - [x] 5.3 Write property test: Snippet extraction contains keyword

    - **Property 6: Snippet extraction contains keyword**
    - **Validates: Requirements 3.3**


  - [ ] 5.4 Write property test: Chinese substring search matches
    - **Property 7: Chinese substring search matches**
    - **Validates: Requirements 3.5**



  - [ ] 5.5 Add search UI tab in `src/content/content.js`
    - Add "🔍 搜索" tab in the floating panel
    - Search input with debounced query (300ms)
    - Results list showing title, workspace, snippet preview


    - Click result opens conversation URL in new tab




    - "清理索引" button for manual cleanup


    - _Requirements: 3.3, 3.4, 3.6_





  - [x] 5.6 Wire auto-save to search indexing


    - After successful auto-save in `content.js`, call `SearchIndex.indexConversation()` with conversation data
    - _Requirements: 3.1_




- [ ] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Prompt Template Library
  - [ ] 7.1 Create `src/utils/templateManager.js`
    - `getAll()`: read templates array from chrome.storage.local
    - `save(template)`: add template with id (uuid), name, content, createdAt, updatedAt
    - `update(id, changes)`: update content/name, set updatedAt, preserve createdAt
    - `remove(id)`: delete template by id
    - `extractVariables(content)`: regex match all `{{variable_name}}` patterns, return unique names
    - `applyTemplate(content, variables)`: replace all `{{var}}` with provided values
    - `serialize(data)` / `deserialize(json)`: JSON round-trip with 2-space indent
    - Export for both browser and Node.js test environments
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 5.1, 5.2_

  - [ ] 7.2 Write property test: Variable extraction finds all placeholders
    - **Property 8: Variable extraction finds all placeholders**
    - **Validates: Requirements 4.2**

  - [ ] 7.3 Write property test: Template variable replacement is complete
    - **Property 9: Template variable replacement is complete**
    - **Validates: Requirements 4.4**

  - [ ] 7.4 Write property test: Template edit preserves creation timestamp
    - **Property 10: Template edit preserves creation timestamp**
    - **Validates: Requirements 4.5**

  - [ ] 7.5 Write property test: Template delete removes exactly one
    - **Property 11: Template delete removes exactly one**
    - **Validates: Requirements 4.6**

  - [ ] 7.6 Write property test: Template data serialization round-trip
    - **Property 12: Template data serialization round-trip**
    - **Validates: Requirements 5.1, 5.2**

  - [ ] 7.7 Add template UI tab in `src/content/content.js`
    - Add "📋 模板" tab in the floating panel
    - Template list with name and preview
    - "保存当前输入为模板" button
    - Click template → show variable form → fill → insert into ChatGPT input
    - Edit/delete buttons per template
    - _Requirements: 4.1, 4.3, 4.5, 4.6_

- [ ] 8. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Sync to extension/content/core.js
  - [ ] 9.1 Add PDF Stream Renderer to core.js
    - Port exportStreamed(), renderBatch(), assemblePDF() with GM_* API compatibility
    - _Requirements: 1.1_
  - [ ] 9.2 Add Selection Manager to core.js
    - Port SelectionManager with UI integration
    - _Requirements: 2.1_
  - [ ] 9.3 Add Search Index to core.js
    - Port SearchIndex using IndexedDB (same API in userscript context)
    - _Requirements: 3.1_
  - [ ] 9.4 Add Template Manager to core.js
    - Port TemplateManager using GM_setValue/GM_getValue
    - _Requirements: 4.1_

- [ ] 10. Update manifest.json
  - Add searchIndex.js and templateManager.js to content_scripts
  - _Requirements: 3.1, 4.1_

- [ ] 11. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
