import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentPath = path.resolve(__dirname, '..', '..', 'src', 'content', 'content.js');
const source = readFileSync(contentPath, 'utf8');

const startMarker = '// ==================== 卡密验证模块 ====================';
const endMarker = '// ==================== 用量统计模块 ====================';
const startIdx = source.indexOf(startMarker);
const endIdx = source.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  throw new Error('Cannot locate CardKeyManager block markers in content.js');
}

const snippet = source.slice(startIdx, endIdx);

const moduleCode = `
  'use strict';
  ${snippet}
  return CardKeyManager;
`;

export function loadCardKeyManager({ AccessManager, UI, chrome, cryptoMock, windowMock } = {}) {
  const fakeAccess = AccessManager || {
    clearCardAccessFallback: async () => {},
    onCardActivated: async () => {}
  };
  const fakeUI = UI || { updateCardKeyBadge: () => {}, showCardKeyOverlay: () => {} };
  const fakeWindow = windowMock || { ChatGPTSaver: { UI: fakeUI } };

  const fn = new Function(
    'AccessManager',
    'UI',
    'chrome',
    'crypto',
    'window',
    moduleCode
  );

  return fn(fakeAccess, fakeUI, chrome, cryptoMock, fakeWindow);
}
