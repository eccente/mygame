# Repository Guidelines

## Project Structure & Module Organization
- `web_frontend/` is the main product codebase.
- Entry pages: `web_frontend/index.html`, `web_frontend/game.html`, `web_frontend/health.html`.
- Frontend logic and styles live in `web_frontend/src/`:
  - `app.js` (game), `health.js` (health tool), `shell.js` (view switching), `backup-*.js` (global backup hub/providers).
- Static assets are under `web_frontend/assets/` (audio, icons, images).
- Build output is `web_frontend/dist/` and is generated; treat it as build artifact.
- Root docs/scripts:
  - `README.md`, `web_frontend/README.md`, `docs/`
  - `scripts/build_frontend_web.sh`

## Build, Test, and Development Commands
- Local preview:
  - `cd web_frontend && python3 -m http.server 8080`
  - Open `http://127.0.0.1:8080`
- Production build:
  - `./scripts/build_frontend_web.sh`
  - Copies `web_frontend/` to `web_frontend/dist/` and replaces `__BUILD_TAG__` in `.html/.css/.js`.
- Agent workflow:
  - After any code change made by the agent, automatically run `./scripts/build_frontend_web.sh` before handing off, unless the user explicitly says not to build.
- Quick JS syntax check:
  - `node --check web_frontend/src/shell.js`
  - Run similarly for edited JS files.

## Coding Style & Naming Conventions
- Use 2-space indentation for HTML/CSS/JS.
- JavaScript style follows existing files: single quotes, semicolons, `camelCase` for functions/variables, `UPPER_SNAKE_CASE` for constants.
- Keep filenames lowercase, kebab-case (for example: `backup-provider-health.js`).
- Edit source files in `web_frontend/src/` and page HTML files; do not hand-edit `web_frontend/dist/`.

## Testing Guidelines
- This repo currently has no enforced frontend test runner.
- Required for UI changes:
  - Manual smoke test on `index.html`, `#game`, and `#health`.
  - Verify backup flows when touched (export/import and compatibility behavior).
- `pytest` is listed in `requirements.txt` for Python-side work; add tests if new Python modules are introduced.

## Commit & Pull Request Guidelines
- Git history is not available in this snapshot, so use clear Conventional Commit style:
  - `feat: add project backup provider for game saves`
  - `fix: prevent health module backup null binding`
- PRs should include:
  - What changed and why.
  - Impacted paths (for example `web_frontend/src/health.js`).
  - Manual verification steps.
  - Screenshots/GIFs for visible UI changes.

## Architecture Notes
- Global backup is provider-based via `window.mygameBackupHub`.
- New modules should add a `backup-provider-<module>.js` and register `id`, `label`, `exportData`, `importData` (and optional `clearData`).
