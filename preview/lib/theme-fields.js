'use strict';

/*
  Builds the `theme` object a HubL template sees, from src/theme/fields.json.

  HubSpot resolves theme fields to rich objects (a font field exposes .font,
  .fallback, .styles, .css; a color field exposes .color and .opacity, and so
  on). This module reproduces the subset of those shapes that css/main.css
  relies on, using each field's default value.
*/

const FONT_FALLBACKS = {
  Fraunces: 'Georgia, "Times New Roman", serif',
  Inter: 'system-ui, -apple-system, "Segoe UI", sans-serif'
};

function fontStyles(variant) {
  const v = String(variant || '400');
  const italic = /italic/i.test(v);
  const weight = parseInt(v, 10) || (/bold/i.test(v) ? 700 : 400);
  return { font_weight: weight, font_style: italic ? 'italic' : 'normal' };
}

function resolveField(field) {
  const d = field.default;
  switch (field.type) {
    case 'group': {
      const out = {};
      for (const child of field.children || []) out[child.name] = resolveField(child);
      return out;
    }
    case 'color':
      return {
        color: d && d.color,
        opacity: d && d.opacity != null ? d.opacity : 100,
        css: d && d.color
      };
    case 'font': {
      const styles = fontStyles(d && d.variant);
      const fallback = FONT_FALLBACKS[d && d.font] || 'sans-serif';
      return {
        font: d && d.font,
        font_set: d && d.font_set,
        variant: d && d.variant,
        size: d && d.size,
        size_unit: (d && d.size_unit) || 'px',
        color: d && d.color,
        fallback,
        styles,
        css: `font-family: "${d && d.font}", ${fallback}; font-weight: ${styles.font_weight}; font-style: ${styles.font_style};`
      };
    }
    case 'spacing': {
      const padding = (d && d.padding) || {};
      const css = Object.entries(padding)
        .map(([side, v]) => `padding-${side}: ${v.value}${v.units};`)
        .join(' ');
      return { padding, css };
    }
    default:
      return d;
  }
}

function buildThemeContext(fields) {
  const theme = {};
  for (const field of fields) theme[field.name] = resolveField(field);
  return theme;
}

/* Google Fonts URL for every font field with load_external_fonts: true. */
function googleFontsUrl(fields) {
  const families = [];
  (function walk(list) {
    for (const f of list) {
      if (f.type === 'group') walk(f.children || []);
      if (f.type === 'font' && f.load_external_fonts && f.default && f.default.font_set === 'GOOGLE') {
        const weight = fontStyles(f.default.variant).font_weight;
        families.push(`family=${encodeURIComponent(f.default.font)}:wght@${weight}`);
      }
    }
  })(fields);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null;
}

module.exports = { buildThemeContext, googleFontsUrl, resolveField };
