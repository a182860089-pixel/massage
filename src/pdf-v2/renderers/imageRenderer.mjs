function normalizeSize(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

export function normalizeImagePayload(block) {
  return {
    renderMode: block?.renderMode === 'embedded' ? 'embedded' : 'link',
    src: String(block?.src || ''),
    alt: String(block?.alt || 'Image'),
    width: normalizeSize(block?.width, 480),
    height: normalizeSize(block?.height, 240)
  };
}

export function renderImageBlock(block, context) {
  const { React, Text, View, Link, Image, styles } = context;
  const image = normalizeImagePayload(block);

  if (!image.src) {
    return React.createElement(
      View,
      { style: styles.imageFallback, key: block.__key || undefined, wrap: false },
      React.createElement(Text, { style: styles.imageFallbackText }, '[图片为空]')
    );
  }

  if (image.renderMode !== 'embedded') {
    return React.createElement(
      View,
      { style: styles.imageFallback, key: block.__key || undefined, wrap: false },
      [
        React.createElement(Text, { style: styles.imageFallbackText, key: 'label' }, `[图片链接] ${image.alt}`),
        React.createElement(
          Link,
          { src: image.src, style: styles.linkText, key: 'link' },
          image.src
        )
      ]
    );
  }

  return React.createElement(
    View,
    { style: styles.imageWrap, key: block.__key || undefined, wrap: false },
    [
      React.createElement(Image, {
        src: image.src,
        style: {
          width: Math.min(480, image.width),
          height: Math.min(320, image.height),
          objectFit: 'contain'
        },
        key: 'img'
      }),
      React.createElement(Text, { style: styles.imageCaption, key: 'caption' }, image.alt)
    ]
  );
}
