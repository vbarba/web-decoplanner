# HALDANE — Desktop packaging

This directory packages the HALDANE web app as an offline desktop application
for **macOS, Linux, and Windows**, using [Electron](https://www.electronjs.org/)
+ [electron-builder](https://www.electron.build/).

> ⚠️ The safety disclaimer in the [root README](../README.md) applies equally to
> the desktop build. HALDANE is **educational software** and must not be used to
> plan, conduct, or verify any actual dive.

## Why this lives in its own directory

The HALDANE web app is intentionally **zero-dependency, no-build-step** (see
[../docs/DECISIONS.md](../docs/DECISIONS.md)). Desktop packaging needs build
tooling (Electron, electron-builder, an `npm` project), so **all of it is
isolated here** — `desktop/` holds the repo's only `package.json`. The web app
at the repo root stays pristine and still runs by just opening `index.html`.

The desktop build does **not** duplicate the web app in git. At build time,
[`scripts/prepare.js`](scripts/prepare.js) **copies** the root web app
(`index.html` + `css/` + `js/`) into `desktop/build/app/` (gitignored), so the
repo root remains the single source of truth.

## Build

```sh
cd desktop
npm install            # one-time: installs electron + electron-builder + icon tools
npm run build          # builds an installer for YOUR current OS into desktop/dist/
```

Outputs in `desktop/dist/`:

| OS | Artifact |
| --- | --- |
| macOS | `HALDANE-<version>.dmg` |
| Linux | `HALDANE-<version>.AppImage` and `*.deb` |
| Windows | `HALDANE Setup <version>.exe` (NSIS installer) |

electron-builder can usually only build for the OS it runs on, so CI builds all
three on a per-OS runner matrix (see
[`../.github/workflows/release.yml`](../.github/workflows/release.yml)).

### Other commands

```sh
npm start              # preview: stage the app + launch the Electron window (no installer)
npm run build:mac      # force a single target (when supported by the host OS)
npm run build:linux
npm run build:win
npm run icons          # regenerate icons from icons/icon.svg (see "Icons" below)
```

## Offline fonts

The root `index.html` loads Oxanium + Sometype Mono from Google Fonts (a CDN).
For a fully offline desktop app, [`scripts/fetch-fonts.js`](scripts/fetch-fonts.js)
downloads those font files at build time into `build/app/fonts/`, and
`prepare.js` rewrites **only the copied** `index.html` to load the local
`fonts/fonts.css` instead. The root `index.html` is never touched, so the online
GitHub Pages version keeps using the CDN.

This is **best-effort**: if the network is unavailable during the build, the
fonts step is skipped and the app falls back to the system fonts already
declared in `css/styles.css` — it still renders correctly, just without the
custom typefaces.

## Icons

[`icons/icon.svg`](icons/icon.svg) is the source mark (the phosphor sonar dot
from the favicon). `npm run icons` rasterizes it to `icon.png` (1024×1024) and
generates `icon.icns` (macOS) and `icon.ico` (Windows). All three generated
files are **committed**, so CI consumes them directly and never needs an icon
toolchain. Re-run `npm run icons` only when the mark in `icon.svg` changes.

## Unsigned builds — what users will see

These installers are **not code-signed or notarized** (signing requires paid
developer certificates). On first launch users must bypass the OS gatekeeper
once:

- **macOS:** double-clicking shows *"HALDANE can't be opened because Apple
  cannot check it for malicious software."* → **Right-click the app → Open →
  Open.** (Only needed the first time.)
- **Windows:** SmartScreen shows *"Windows protected your PC."* → click
  **More info → Run anyway.**
- **Linux:** make the AppImage executable (`chmod +x HALDANE-*.AppImage`) and
  run it, or install the `.deb`.

## Notes

- `npm audit` reports vulnerabilities in some of electron-builder's transitive
  dependencies. These are **build-time only** — none of that code is shipped in
  the packaged app — and are a known characteristic of electron-builder. Keep
  electron + electron-builder reasonably current; do not let audit noise block
  builds.
- State (`localStorage`: `haldane-plan-v1`, `haldane-dives-v1`) persists across
  launches in Electron's per-app user-data directory, exactly as in the browser.
