function normalizedLength(text) {
  return Math.max(3, String(text || '').trim().length);
}

export function computeColumnWeights(headers = [], rows = []) {
  const columns = Math.max(
    headers.length,
    ...rows.map((row) => (Array.isArray(row) ? row.length : 0)),
    1
  );
  const weights = new Array(columns).fill(1);

  for (let c = 0; c < columns; c += 1) {
    const headerWeight = normalizedLength(headers[c] || '');
    let maxCell = headerWeight;
    rows.forEach((row) => {
      const cellWeight = normalizedLength((row || [])[c] || '');
      if (cellWeight > maxCell) maxCell = cellWeight;
    });
    weights[c] = Math.max(1, Math.min(6, maxCell));
  }

  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => w / total);
}

function renderRow(cells, isHeader, rowIndex, context, columnWeights) {
  const { React, Text, View, styles } = context;
  return React.createElement(
    View,
    {
      style: [styles.tableRow, isHeader ? styles.tableHeaderRow : null],
      key: `table-row-${rowIndex}`,
      wrap: false
    },
    columnWeights.map((weight, colIdx) =>
      React.createElement(
        View,
        {
          style: [styles.tableCell, { width: `${(weight * 100).toFixed(2)}%` }, isHeader ? styles.tableHeaderCell : null],
          key: `table-cell-${rowIndex}-${colIdx}`
        },
        React.createElement(
          Text,
          { style: isHeader ? styles.tableHeaderText : styles.tableCellText },
          String((cells || [])[colIdx] || '')
        )
      )
    )
  );
}

export function renderTableBlock(block, context) {
  const { React, Text, View, styles } = context;
  const headers = Array.isArray(block?.headers) ? block.headers : [];
  const rows = Array.isArray(block?.rows) ? block.rows : [];
  const columnWeights = computeColumnWeights(headers, rows);

  const nodes = [];
  if (headers.length) nodes.push(renderRow(headers, true, 0, context, columnWeights));
  rows.forEach((row, idx) => nodes.push(renderRow(row, false, idx + 1, context, columnWeights)));

  if (!nodes.length) {
    return React.createElement(
      View,
      { style: styles.tableWrap, key: block.__key || undefined },
      React.createElement(Text, { style: styles.paragraph }, '[空表格]')
    );
  }

  return React.createElement(
    View,
    { style: styles.tableWrap, key: block.__key || undefined, wrap: true },
    nodes
  );
}
