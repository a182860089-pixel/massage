export function normalizeFormulaText(block) {
  const latex = String(block?.latex || '').trim();
  if (latex) return latex;
  return String(block?.text || '').trim();
}

export function renderFormulaBlock(block, context) {
  const { React, Text, View, styles } = context;
  const formula = normalizeFormulaText(block);
  const output = formula || '[公式]';

  return React.createElement(
    View,
    { style: styles.formulaBlock, key: block.__key || undefined, wrap: false },
    [
      React.createElement(Text, { style: styles.formulaLabel, key: 'formula-label' }, 'Formula'),
      React.createElement(Text, { style: styles.formulaText, key: 'formula-body' }, output)
    ]
  );
}
