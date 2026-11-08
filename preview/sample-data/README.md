# Sample data

Each `<module>.json` file here is deep-merged over the module's `fields.json`
defaults (and over any values the template passes to `dnd_module`) when the
preview renders. It stands in for what a marketer would type into the page
editor, so you can try images, long copy or edge cases locally.

`hubdb-rows.json` is what the stubbed `hubdb_table_rows()` returns. To preview
the HubDB variant of the card grid, set `"source": "hubdb"` and
`"hubdb_table": 1` in `card-grid.json`.
