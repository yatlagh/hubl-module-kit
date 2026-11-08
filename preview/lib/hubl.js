'use strict';

/*
  A HubL-subset renderer built on Nunjucks.

  HubL is a Jinja dialect, and Nunjucks implements most of the same core
  syntax (if/for/set/macro/extends/block, filters, loop.*, inline if). What
  HubSpot adds on top is reproduced here only as far as this theme needs:

    - drag-and-drop tags: dnd_area, dnd_section, dnd_column, dnd_row, dnd_module
    - module rendering: fields.json defaults merged with template params
      and preview sample data, exposed as `module` with a unique `name`
    - a handful of globals: require_css, require_js, get_asset_url,
      hubdb_table_rows (stubbed with sample rows), standard_*_includes

  See README "Local preview" for what is intentionally not supported.
*/

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const HEADER_PLACEHOLDER = '<!--nw:standard_header_includes-->';

/* ---------- fields.json helpers ---------- */

function fieldDefaults(fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'group') {
      if (f.occurrence) {
        out[f.name] = Array.isArray(f.default) ? f.default.map(clone) : [];
      } else {
        out[f.name] = fieldDefaults(f.children || []);
      }
    } else {
      out[f.name] = f.default !== undefined ? clone(f.default) : null;
    }
  }
  return out;
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : clone(patch);
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

/* ---------- HubL to Nunjucks source adjustments ---------- */

/*
  HubL lets dnd tag parameters be separated by spaces as well as commas:
  `{% dnd_area "name" class="x", label="y" %}` or `{% dnd_column width=6 offset=0 %}`.
  Nunjucks' signature parser wants commas, so insert them where a top-level
  whitespace run is followed by another `key=` pair.
*/
function adaptDndTag(inner) {
  let out = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      out += ch;
      if (ch === quote && inner[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (depth === 0 && /\s/.test(ch)) {
      const rest = inner.slice(i);
      const ws = rest.match(/^\s+/)[0];
      const after = rest.slice(ws.length);
      const prev = out.trimEnd();
      const prevIsTagName = /^\s*dnd_\w+$/.test(prev);
      if (/^\w+\s*=/.test(after) && !prevIsTagName && !prev.endsWith(',')) {
        out += ',' + ws;
      } else {
        out += ws;
      }
      i += ws.length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function adaptSource(src) {
  return src.replace(/\{%(-?)(\s*dnd_\w+[\s\S]*?)(-?)%\}/g, (m, l, inner, r) => `{%${l}${adaptDndTag(inner)}${r}%}`);
}

/* ---------- Drag-and-drop tag extensions ---------- */

function splitArgs(args) {
  const positional = [];
  let kwargs = {};
  for (const a of args) {
    if (isPlainObject(a) && a.__keywords) {
      kwargs = { ...a };
      delete kwargs.__keywords;
    } else {
      positional.push(a);
    }
  }
  return { positional, kwargs };
}

function makeBlockTag(renderer, tagName, endTag) {
  function Tag() {
    this.tags = [tagName];
    this.parse = function (parser, nodes) {
      const tok = parser.nextToken();
      const args = parser.parseSignature(null, true);
      parser.advanceAfterBlockEnd(tok.value);
      const body = parser.parseUntilBlocks(endTag);
      parser.advanceAfterBlockEnd();
      return new nodes.CallExtension(this, 'run', args, [body]);
    };
    this.run = function (context, ...rest) {
      const body = rest.pop();
      const { positional, kwargs } = splitArgs(rest);
      const html = renderer.renderDndTag(tagName, positional, kwargs, body(), context);
      return new nunjucks.runtime.SafeString(html);
    };
  }
  return new Tag();
}

function rgba(c) {
  if (!c) return null;
  if (typeof c === 'string') return c;
  const a = c.a == null ? 1 : c.a;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/* ---------- Renderer ---------- */

class HublRenderer {
  constructor({ themeRoot, sampleDataDir, themeContext, headerIncludes = [] }) {
    this.themeRoot = themeRoot;
    this.sampleDataDir = sampleDataDir;
    this.theme = themeContext;
    this.headerIncludes = headerIncludes;
    this.usedModules = new Set();
    this.instanceCounter = 0;

    const loader = new nunjucks.FileSystemLoader(themeRoot, { noCache: true });
    const originalGetSource = loader.getSource.bind(loader);
    loader.getSource = (name) => {
      const result = originalGetSource(name);
      if (result) result.src = adaptSource(result.src);
      return result;
    };

    this.env = new nunjucks.Environment(loader, { autoescape: false, trimBlocks: false, lstripBlocks: false });

    for (const [tag, end] of [
      ['dnd_area', 'end_dnd_area'],
      ['dnd_section', 'end_dnd_section'],
      ['dnd_column', 'end_dnd_column'],
      ['dnd_row', 'end_dnd_row'],
      ['dnd_module', 'end_dnd_module']
    ]) {
      this.env.addExtension(tag, makeBlockTag(this, tag, end));
    }

    this.installGlobals();
    this.installFilters();
  }

  installGlobals() {
    const env = this.env;
    env.addGlobal('theme', this.theme);
    env.addGlobal('html_lang', 'en');
    env.addGlobal('html_lang_dir', 'dir="ltr"');
    env.addGlobal('builtin_body_classes', 'hs-content-id-preview hs-landing-page');
    env.addGlobal('page_meta', {
      html_title: 'Northwind theme preview',
      meta_description: 'Local preview of the Northwind HubSpot CMS theme.'
    });
    env.addGlobal('standard_header_includes', new nunjucks.runtime.SafeString(HEADER_PLACEHOLDER));
    env.addGlobal('standard_footer_includes', '');
    env.addGlobal('get_asset_url', (p) => String(p).replace(/^(\.\.\/)+/, ''));
    env.addGlobal('require_css', (href) => new nunjucks.runtime.SafeString(`<link rel="stylesheet" href="${href}">`));
    env.addGlobal('require_js', (src) => new nunjucks.runtime.SafeString(`<script src="${src}" defer></script>`));
    env.addGlobal('hubdb_table_rows', () => this.readSample('hubdb-rows') || []);
  }

  installFilters() {
    const env = this.env;
    env.addFilter('striptags', (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, ''));
    env.addFilter('escape_html', (s) => nunjucks.lib.escape(String(s == null ? '' : s)));
    env.addFilter('tojson', (v) => JSON.stringify(v));
    env.addFilter('default', (v, d) => (v === undefined || v === null || v === '' ? d : v));
  }

  readSample(baseName) {
    if (!this.sampleDataDir) return null;
    const file = path.join(this.sampleDataDir, `${baseName}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }

  /* Render one module folder with field values; mirrors what HubSpot does for a dnd_module. */
  renderModule(modulePath, params = {}) {
    const moduleDir = path.resolve(this.themeRoot, 'templates', modulePath);
    const moduleName = path.basename(moduleDir).replace(/\.module$/, '');
    const fields = JSON.parse(fs.readFileSync(path.join(moduleDir, 'fields.json'), 'utf8'));

    let values = fieldDefaults(fields);
    values = deepMerge(values, params);
    values = deepMerge(values, this.readSample(moduleName) || {});

    this.usedModules.add(moduleName);
    const instance = `module_${++this.instanceCounter}_${moduleName.replace(/-/g, '_')}`;
    const relTemplate = path.relative(this.themeRoot, path.join(moduleDir, 'module.html'));

    const html = this.env.render(relTemplate, { module: values, name: instance });
    return `<div id="hs_cos_wrapper_${instance}" class="hs_cos_wrapper hs_cos_wrapper_widget" data-hs-cos-type="module">\n${html}\n</div>`;
  }

  renderDndTag(tag, positional, kwargs, body, context) {
    switch (tag) {
      case 'dnd_area': {
        const cls = ['container-fluid', kwargs.class].filter(Boolean).join(' ');
        return `<div class="${cls}" data-dnd-area="${positional[0] || 'dnd_area'}">\n<div class="row-fluid-wrapper"><div class="row-fluid">${body}</div></div>\n</div>`;
      }
      case 'dnd_section': {
        const style = [];
        if (kwargs.padding) {
          for (const side of ['top', 'right', 'bottom', 'left']) {
            if (kwargs.padding[side] !== undefined) style.push(`padding-${side}: ${kwargs.padding[side]}px`);
          }
        }
        const bg = rgba(kwargs.background_color);
        if (bg) style.push(`background-color: ${bg}`);
        if (kwargs.max_width) style.push(`--dnd-max-width: ${kwargs.max_width}px`);
        const styleAttr = style.length ? ` style="${style.join('; ')}"` : '';
        return `<div class="row-fluid-wrapper row-depth-1 dnd-section"${styleAttr}>\n<div class="row-fluid">${body}</div>\n</div>`;
      }
      case 'dnd_column': {
        const width = kwargs.width || 12;
        return `<div class="span${width} dnd-column">${body}</div>`;
      }
      case 'dnd_row':
        return `<div class="row-fluid-wrapper dnd-row"><div class="row-fluid">${body}</div></div>`;
      case 'dnd_module': {
        const { path: modulePath, label, ...params } = kwargs;
        if (!modulePath) throw new Error('dnd_module requires a path');
        return `<div class="span12 dnd-module">${this.renderModule(modulePath, params)}</div>`;
      }
      default:
        return body;
    }
  }

  /* Render a template, then fill in the header includes HubSpot would inject. */
  renderTemplate(relTemplate, context = {}) {
    this.usedModules.clear();
    this.instanceCounter = 0;
    let html = this.env.render(relTemplate, context);
    const includes = [
      ...this.headerIncludes,
      ...[...this.usedModules].map((m) => `<link rel="stylesheet" href="modules/${m}.module/module.css">`)
    ].join('\n  ');
    html = html.replace(HEADER_PLACEHOLDER, includes);
    return html;
  }

  /* Render a raw HubL string (used for css/main.css). */
  renderString(src, context = {}) {
    return this.env.renderString(adaptSource(src), context);
  }
}

module.exports = { HublRenderer, fieldDefaults, deepMerge, adaptSource };
