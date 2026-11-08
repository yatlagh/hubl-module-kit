#!/usr/bin/env node
'use strict';

/*
  Static checks for the theme, run with `npm test`. No HubSpot account needed.

  1. Every module folder has module.html, fields.json, meta.json and module.css,
     and meta.json carries the keys HubSpot requires.
  2. Every fields.json (theme and modules) is well formed: known field types,
     snake_case unique names per level, choices present, defaults that match
     the declared type, repeater groups with an occurrence block.
  3. Every module.html references only declared fields: `module.x`,
     `module.group.child`, loop variables over repeater groups, and the
     sub-properties a field type actually exposes (link.url.href, image.src...).
  4. Template dnd_module tags point at existing modules and pass only
     declared field names.
  5. No CSS outside the :root token block in css/main.css hardcodes a colour.
     Modules must use the theme's custom properties.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEME = path.join(ROOT, 'src', 'theme');
const MODULES_DIR = path.join(THEME, 'modules');

const FIELD_TYPES = new Set([
  'text', 'richtext', 'textarea', 'html', 'number', 'boolean', 'choice', 'color', 'font', 'spacing',
  'image', 'link', 'url', 'icon', 'file', 'video', 'cta', 'form', 'menu', 'page', 'blog', 'hubdbtable',
  'hubdbrow', 'tag', 'group', 'alignment', 'gradient', 'border', 'backgroundimage', 'date', 'datetime',
  'email', 'followupemail', 'simplemenu', 'embed', 'logo', 'sfdccampaign', 'crmobject', 'crmobjectproperty',
  'payment', 'survey', 'meeting', 'workflow'
]);

/* Sub-properties each field type exposes in HubL. */
const TYPE_PROPS = {
  link: { url: ['href', 'type', 'content_id'], open_in_new_tab: null, no_follow: null, rel: null, sponsored: null, user_generated_content: null },
  image: { src: null, alt: null, width: null, height: null, loading: null, size_type: null, max_width: null, max_height: null },
  color: { color: null, opacity: null, css: null, rgb: null, rgba: null, hex: null },
  font: { font: null, fallback: null, size: null, size_unit: null, color: null, styles: ['font_weight', 'font_style', 'text_decoration'], css: null, font_set: null, variant: null },
  spacing: { padding: ['top', 'right', 'bottom', 'left'], margin: ['top', 'right', 'bottom', 'left'], css: null },
  cta: { guid: null },
  url: { href: null, type: null, content_id: null },
  hubdbtable: {}
};

const DEFAULT_TYPE_CHECK = {
  text: (v) => typeof v === 'string',
  richtext: (v) => typeof v === 'string',
  textarea: (v) => typeof v === 'string',
  html: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  choice: (v, f) => f.multiple ? Array.isArray(v) : (typeof v === 'string' || typeof v === 'number'),
  color: (v) => v && typeof v === 'object' && typeof v.color === 'string',
  font: (v) => v && typeof v === 'object' && typeof v.font === 'string',
  spacing: (v) => v && typeof v === 'object',
  image: (v) => v && typeof v === 'object' && 'src' in v,
  link: (v) => v && typeof v === 'object' && v.url && typeof v.url === 'object',
  url: (v) => v && typeof v === 'object' && 'href' in v
};

const COLOR_NAMES = ['white', 'black', 'red', 'blue', 'green', 'orange', 'yellow', 'purple', 'pink', 'gray', 'grey', 'navy', 'teal', 'beige', 'ivory', 'gold', 'silver'];
const COLOR_PATTERNS = [
  { re: /#[0-9a-f]{3,8}\b/gi, label: 'hex colour' },
  { re: /\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/gi, label: 'colour function' },
  { re: new RegExp(`(?<![-\\w])(?:${COLOR_NAMES.join('|')})(?![-\\w])`, 'gi'), label: 'named colour' }
];

/* ---------- reporting ---------- */

const problems = [];
let checksRun = 0;

function fail(file, message) {
  problems.push(`${path.relative(ROOT, file)}: ${message}`);
}

function check(label, fn) {
  checksRun++;
  const before = problems.length;
  fn();
  const count = problems.length - before;
  console.log(`${count ? 'FAIL' : ' ok '}  ${label}${count ? ` (${count})` : ''}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(file, `invalid JSON (${err.message})`);
    return null;
  }
}

/* ---------- 1. module folders and meta.json ---------- */

const moduleDirs = fs.existsSync(MODULES_DIR)
  ? fs.readdirSync(MODULES_DIR).filter((d) => d.endsWith('.module')).map((d) => path.join(MODULES_DIR, d))
  : [];

check('module folders are complete', () => {
  if (!moduleDirs.length) fail(MODULES_DIR, 'no *.module folders found');
  for (const dir of moduleDirs) {
    for (const f of ['module.html', 'fields.json', 'meta.json', 'module.css']) {
      if (!fs.existsSync(path.join(dir, f))) fail(dir, `missing ${f}`);
    }
    const metaFile = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaFile)) continue;
    const meta = readJson(metaFile);
    if (!meta) continue;
    if (typeof meta.label !== 'string' || !meta.label.trim()) fail(metaFile, 'meta.json needs a non-empty "label"');
    if (!Array.isArray(meta.host_template_types) && !Array.isArray(meta.content_types)) {
      fail(metaFile, 'meta.json needs "host_template_types" or "content_types"');
    }
    for (const key of ['css_assets', 'js_assets', 'external_js', 'other_assets']) {
      if (key in meta && !Array.isArray(meta[key])) fail(metaFile, `"${key}" must be an array`);
    }
    if ('global' in meta && typeof meta.global !== 'boolean') fail(metaFile, '"global" must be a boolean');
  }
});

/* ---------- 2. fields.json validation ---------- */

function validateFields(fields, file, scope = '') {
  if (!Array.isArray(fields)) {
    fail(file, `${scope || 'root'}: fields must be an array`);
    return;
  }
  const seen = new Set();
  for (const f of fields) {
    const where = `${scope}${f && f.name ? f.name : '<unnamed>'}`;
    if (!f || typeof f !== 'object') { fail(file, `${where}: field must be an object`); continue; }
    if (typeof f.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(f.name)) fail(file, `${where}: "name" must be snake_case`);
    if (seen.has(f.name)) fail(file, `${where}: duplicate field name`);
    seen.add(f.name);
    if (typeof f.label !== 'string' || !f.label.trim()) fail(file, `${where}: missing "label"`);
    if (!FIELD_TYPES.has(f.type)) fail(file, `${where}: unknown type "${f.type}"`);

    if (f.type === 'choice') {
      if (!Array.isArray(f.choices) || !f.choices.length) fail(file, `${where}: choice field needs "choices"`);
      else if (f.default !== undefined && !f.multiple) {
        const values = f.choices.map((c) => (Array.isArray(c) ? c[0] : c));
        if (!values.includes(f.default)) fail(file, `${where}: default "${f.default}" is not one of the choices`);
      }
    }

    if (f.type === 'group') {
      if (!Array.isArray(f.children) || !f.children.length) fail(file, `${where}: group needs "children"`);
      else validateFields(f.children, file, `${where}.`);
      if (f.occurrence) {
        if (typeof f.occurrence !== 'object') fail(file, `${where}: "occurrence" must be an object`);
        if (f.default !== undefined && !Array.isArray(f.default)) fail(file, `${where}: repeater default must be an array`);
        if (Array.isArray(f.default) && f.children) {
          const childNames = new Set(f.children.map((c) => c.name));
          f.default.forEach((row, i) => {
            for (const key of Object.keys(row || {})) {
              if (!childNames.has(key)) fail(file, `${where}: default row ${i + 1} has unknown key "${key}"`);
            }
          });
        }
      }
      continue;
    }

    if (f.default !== undefined && f.default !== null && DEFAULT_TYPE_CHECK[f.type] && !DEFAULT_TYPE_CHECK[f.type](f.default, f)) {
      fail(file, `${where}: default does not match type "${f.type}"`);
    }
    if (f.required && (f.default === undefined || f.default === '')) {
      fail(file, `${where}: required field should ship with a default so templates render`);
    }
    if (f.visibility && typeof f.visibility.controlling_field === 'string') {
      if (!fields.some((other) => other.name === f.visibility.controlling_field)) {
        fail(file, `${where}: visibility controlling_field "${f.visibility.controlling_field}" is not a sibling field`);
      }
    }
  }
}

const moduleFields = new Map();

check('fields.json files are well formed', () => {
  const themeFieldsFile = path.join(THEME, 'fields.json');
  const themeFields = readJson(themeFieldsFile);
  if (themeFields) validateFields(themeFields, themeFieldsFile);
  for (const dir of moduleDirs) {
    const file = path.join(dir, 'fields.json');
    if (!fs.existsSync(file)) continue;
    const fields = readJson(file);
    if (!fields) continue;
    validateFields(fields, file);
    moduleFields.set(dir, fields);
  }
});

/* ---------- 3. module.html references only declared fields ---------- */

function fieldByName(fields, name) {
  return (fields || []).find((f) => f.name === name);
}

/* Returns true if `segments` (after the field) is a valid path into field `f`. */
function validPath(f, segments) {
  if (!segments.length) return true;
  if (f.type === 'group') {
    if (f.occurrence) return false; // repeaters are iterated, not dotted into
    const child = fieldByName(f.children, segments[0]);
    return child ? validPath(child, segments.slice(1)) : false;
  }
  const props = TYPE_PROPS[f.type];
  if (!props) return false;
  const [first, second, ...rest] = segments;
  if (!(first in props)) return false;
  if (second === undefined) return true;
  const sub = props[first];
  return Array.isArray(sub) && sub.includes(second) && rest.length === 0;
}

function checkReferences(html, fields, file) {
  // Loop variables over repeater groups: {% for item in module.items %}
  const loops = new Map();
  for (const m of html.matchAll(/\{%-?\s*for\s+(\w+)\s+in\s+module\.(\w+)\s*-?%\}/g)) {
    const [, variable, groupName] = m;
    const group = fieldByName(fields, groupName);
    if (!group) fail(file, `loops over undeclared field "module.${groupName}"`);
    else if (group.type !== 'group' || !group.occurrence) fail(file, `"module.${groupName}" is not a repeater group but is iterated`);
    else loops.set(variable, group);
  }

  // Direct references: module.a.b.c
  for (const m of html.matchAll(/\bmodule((?:\.\w+)+)/g)) {
    const segments = m[1].slice(1).split('.');
    const field = fieldByName(fields, segments[0]);
    if (!field) { fail(file, `references undeclared field "module.${segments[0]}"`); continue; }
    if (!validPath(field, segments.slice(1))) fail(file, `"module${m[1]}" is not a property the "${field.type}" field "${segments[0]}" exposes`);
  }

  // Loop-variable references: item.title, item.link.url.href
  for (const [variable, group] of loops) {
    const re = new RegExp(`\\b${variable}((?:\\.\\w+)+)`, 'g');
    for (const m of html.matchAll(re)) {
      const segments = m[1].slice(1).split('.');
      const child = fieldByName(group.children, segments[0]);
      if (!child) { fail(file, `"${variable}.${segments[0]}" is not a child of repeater "${group.name}"`); continue; }
      if (!validPath(child, segments.slice(1))) fail(file, `"${variable}${m[1]}" is not a property the "${child.type}" field exposes`);
    }
  }
}

check('module.html files reference only declared fields', () => {
  for (const [dir, fields] of moduleFields) {
    const file = path.join(dir, 'module.html');
    if (!fs.existsSync(file)) continue;
    checkReferences(fs.readFileSync(file, 'utf8'), fields, file);
  }
});

/* ---------- 4. templates reference real modules and declared params ---------- */

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []
  );
}

const DND_MODULE_RESERVED = new Set(['path', 'label', 'horizontal_alignment', 'vertical_alignment', 'offset', 'width', 'flexbox_positioning']);

check('templates point at existing modules and pass declared fields', () => {
  for (const file of listFiles(path.join(THEME, 'templates'), '.html')) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\{%-?\s*dnd_module\s+([\s\S]*?)-?%\}/g)) {
      const params = m[1];
      const pathMatch = params.match(/\bpath\s*=\s*"([^"]+)"/);
      if (!pathMatch) { fail(file, 'dnd_module without a path'); continue; }
      const moduleDir = path.resolve(path.dirname(file), pathMatch[1]);
      if (!fs.existsSync(path.join(moduleDir, 'module.html'))) { fail(file, `dnd_module path "${pathMatch[1]}" does not resolve to a module`); continue; }
      const fields = moduleFields.get(moduleDir) || [];
      const names = new Set(fields.map((f) => f.name));
      for (const k of params.matchAll(/(?:^|[\s,])(\w+)\s*=/g)) {
        if (!DND_MODULE_RESERVED.has(k[1]) && !names.has(k[1])) fail(file, `dnd_module "${pathMatch[1]}" sets undeclared field "${k[1]}"`);
      }
    }
  }
});

/* ---------- 5. no hardcoded colours outside the token block ---------- */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

function stripRootBlock(css) {
  // Remove the body of every `:root { ... }` block; that is where tokens are defined.
  return css.replace(/:root\s*\{[^}]*\}/g, (block) => block.replace(/[^\n]/g, ' '));
}

check('CSS uses theme variables instead of hardcoded colours', () => {
  const files = [...listFiles(path.join(THEME, 'css'), '.css'), ...moduleDirs.map((d) => path.join(d, 'module.css')).filter(fs.existsSync)];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    // Blank HubL expressions first so their braces do not confuse the :root scan.
    const noHubl = stripComments(raw).replace(/\{\{[\s\S]*?\}\}/g, (s) => s.replace(/[^\n]/g, ' '));
    const lines = stripRootBlock(noHubl).split('\n');
    lines.forEach((line, i) => {
      for (const { re, label } of COLOR_PATTERNS) {
        re.lastIndex = 0;
        const hit = re.exec(line);
        if (hit) fail(file, `line ${i + 1}: ${label} "${hit[0]}" (use a --nw-* variable)`);
      }
    });
  }
});

/* ---------- summary ---------- */

console.log('');
if (problems.length) {
  for (const p of problems) console.log(`  - ${p}`);
  console.log(`\n${problems.length} problem(s) across ${checksRun} checks.`);
  process.exit(1);
} else {
  console.log(`All ${checksRun} checks passed for ${moduleDirs.length} modules.`);
}
