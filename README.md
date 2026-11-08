# hubl-module-kit

A small HubSpot CMS theme ("Northwind") with five drag-and-drop HubL modules on one brand stylesheet, plus the two things I always end up needing around a theme: a local preview that works without a HubSpot account, and some checks that run before `hs upload`.

The idea is simple: theme settings feed CSS custom properties, modules only use those properties, so marketers can build pages in the editor and nothing drifts off brand. I maintain a much larger version of this for a marketing team; this one is generic.

![](docs/preview.png)

## Modules

`src/theme/modules/`, standard layout (`module.html`, `fields.json`, `meta.json`, `module.css`).

- **hero** – eyebrow, heading (H1/H2 choice), body, two buttons, optional image. Split or centered.
- **accordion** – FAQ list, `aria-expanded`/`aria-controls`, works without JS.
- **tabs** – WAI-ARIA tabs with arrow keys; stacked sections when JS is off.
- **card-grid** – 2–4 columns from a repeater group, or from a HubDB table (`source` field switches; same macro renders both). HubDB columns: `title`, `description`, `image`, `link`, `tag`.
- **cta-band** – closing strip, three background tones.

Each module has a heading-level field so the page outline stays sane. Focus rings use one shared token. `prefers-reduced-motion` turns transitions off.

## Local preview

```
npm install
npm run preview      # renders the real landing-page template and opens it on :4173
```

HubL is Jinja underneath, so `preview/lib/hubl.js` runs the templates through Nunjucks and adds the HubSpot bits this theme uses: the `dnd_*` tags, module rendering with `fields.json` defaults, and stubs for `require_css`, `get_asset_url`, `hubdb_table_rows` etc. Theme field defaults become the `theme` object, so `{{ theme.colors.primary.color }}` resolves like on HubSpot. `preview/sample-data/*.json` fakes what a marketer would type.

It's a subset. No `{% module %}` tag, no global modules, only a few filters, `hubdb_table_rows` ignores the query. Good enough to see the modules and catch markup mistakes; anything subtle still needs a sandbox portal.

## Checks

```
npm test
```

`scripts/check-modules.js`, no dependencies:

1. every module has all four files and a valid `meta.json`
2. every `fields.json` is well formed (types, snake_case unique names, choice defaults, repeater occurrence)
3. `module.html` only references declared fields (including group children and the sub-properties a type actually has, e.g. `link.url.href`)
4. templates only `dnd_module` real modules and pass declared fields
5. no hardcoded colours outside the `:root` block in `css/main.css`

Number 5 is the one that pays for itself: it's how the "nothing drifts off brand" promise is kept.

## Theme fields → CSS

`css/main.css` is processed as HubL, so the top of it is:

```css
:root {
  --nw-color-primary: {{ theme.colors.primary.color }};
  --nw-font-heading: "{{ theme.typography.heading.font }}", {{ theme.typography.heading.fallback }};
  --nw-radius: {{ theme.spacing.radius }}px;
}
```

Modules use `var(--nw-*)` and nothing else.

## Upload

```
npm install -g @hubspot/cli
hs init
npm test
npm run upload       # hs upload src/theme northwind-theme
```

## TODO

- blog listing module
- a `{% module %}` tag in the preview renderer
- visual regression on the preview page

MIT.
