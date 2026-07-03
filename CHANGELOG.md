# Changelog

All notable changes to HALDANE, generated from Conventional Commits.
## [1.1.0] - 2026-07-03

### Features
- **engine:** DecoPlanner parity — runtime rounding, repetitive dives, surface-interval shunt (#2)

## [1.0.2] - 2026-06-22

### Bug Fixes
- **desktop:** Ad-hoc sign macOS app so it isn't flagged 'damaged' [skip release]

## [1.0.0] - 2026-06-22

### Bug Fixes
- **ui:** Relabel Bühlmann toggle, group coefficient sub-toggle, fix hidden algo bodies
- **deco:** Pin gas-switch gas to its switch depth in custom-stop seeding
- **deco:** Switch gas on arrival at the stop, not before ascending
- **deco:** Anchor verify GF/Boyle at the real first stop, not the switch depth
- **deco:** Align ZHL/VPM-B contract divergences (audit findings)
- **deco:** ZHL-16 holds every rung for strict Erik-Baker GF compliance
- **ui:** Order deco-time table blocks shallowest→deepest

### Documentation
- Add live GitHub Pages URL to README
- Add CLAUDE.md and docs/ (architecture, design, decisions)
- Document i18n, saved dives, rail split, charts column, FIX DECO
- Reflect Edit Deco removal, engine parity fixes, field tooltips

### Features
- Cylinder & gas-supply planning
- **ui:** Themed custom listbox replacing native selects
- Editable runtime table with safety verification
- Min-gas (rock bottom) reserve rule
- Configurable extra reserve added on top of every rule
- Selectable ZHL-16B coefficient variant
- **ui:** Default gradient factors to 20/85
- **ui:** Default "level time includes travel" to off
- **ui:** Default to ZHL-16B coefficients
- **ui:** Drop O2 default gas, default 45m/30min, add travel-legs toggle
- **ui:** Default extra reserve to 0, default reserve rule to min-gas
- **ui:** Add named saved dives (save/load/export/import)
- **ui:** Make Gases and Algorithm panels collapsible like Settings
- **ui:** Move charts into a dedicated third column
- **i18n:** Add UI translations for en/es/fr/de/zh
- **ui:** Reorganize rail, fix charts reveal, FIX DECO, tooltips, i18n wiring
- **ui:** Default "level time includes travel" to on
- **ui:** Add tooltips to every input field
- **ui:** Add Summarized Table with ±3 m / ±1 min contingencies
- **ui:** Replace SUMMARY with CREATE TABLE deco-time matrix
- **deco:** Add stopRounding toggle (ceil vs nearest) for DP-matching stops
- **desktop:** Package as offline app + automated releases

### HALDANE
- Multi-gas dive decompression planner (ZHL-16C+GF & VPM-B)

### Refactor
- Remove Edit Deco (verify mode) from engines + UI

