export function splitCodeLines(content) {
  const raw = String(content || '').replace(/\r/g, '');
  const lines = raw.split('\n');
  return lines.length ? lines : [''];
}

export function renderCodeBlock(block, context) {
  const { React, Text, View, styles } = context;
  const lines = splitCodeLines(block?.content || '');
  const language = String(block?.language || '').trim();
  const showLineNumbers = block?.showLineNumbers !== false;

  return React.createElement(
    View,
    { style: styles.codeBlock, key: block.__key || undefined, wrap: true },
    [
      language
        ? React.createElement(
            Text,
            { style: styles.codeLanguage, key: 'code-lang' },
            language.toUpperCase()
          )
        : null,
      ...lines.map((line, index) =>
        React.createElement(
          Text,
          { style: styles.codeText, key: `code-line-${index}` },
          showLineNumbers ? `${String(index + 1).padStart(3, ' ')}  ${line}` : line
        )
      )
    ].filter(Boolean)
  );
}
