# Routa

Habit tracker web app (formerly named "Cadence"; the folder used to be `habit-tracker`).
Plain HTML/CSS/JS, no build step, no framework. `README.md` (Thai) has the full file list and Firebase setup.

- Live site: https://chanita6732-code.github.io/routa/
- Repo: `chanita6732-code/routa`, GitHub Pages serves the `main` branch root.

## Working with the owner

- Reply in Thai, in plain non-technical language. The owner is not a programmer.
- When a request is unclear, ask before acting (their standing preference).
- Use real data only: no sample or placeholder data in the app.
- Keep the purple–navy look and the existing navigation unless asked to change them.

## Deploying

1. Bump the version in **both** places, to the same number:
   - `CACHE` in `sw.js` (e.g. `routa-v2.6.1`)
   - every `?v=` in `index.html` (stylesheet, scripts, icon links) and the icon URL in `style.css` (`.brand-mark`)
2. Add any new file to `SHELL` in `sw.js` and to the file list in `README.md`.
3. Commit and push to `main`. Commits use the repo-local noreply identity already set in git config; never put the owner's personal email in a commit.
4. Confirm it is live: `curl` `sw.js` on the live site and check the `CACHE` value.
   If the Pages run sits in "queued" for minutes, start a fresh build: `gh api -X POST repos/chanita6732-code/routa/pages/builds`.

Skipping step 1 makes browsers mix a new page with old cached CSS/JS and the layout breaks.

## Things that look wrong but are intentional

- LocalStorage keys start with `cadence:v2:` and the Firebase project is `cadence-b463f`. Do not rename either: the keys hold users' saved data, and a Firebase project id cannot change.
- `config.js` holds the Firebase web config. It is public by design. Never add service-account or other private keys to the repo.
- `firestore.rules` is published by hand in the Firebase console; changing the file alone changes nothing.
- React Bits components (ShapeGrid, ClickSpark, BorderGlow, Dock, GooeyNav) are hand ports to plain JS in their own files, themed through CSS variables in `style.css`.

## Testing

No test suite in the repo. Changes are checked with throwaway Playwright scripts (`playwright-core`, Chrome at `/usr/bin/google-chrome`) against a small static server:
serve `window.ROUTA_CONFIG = { firebase: null }` in place of `config.js` to get guest mode without touching real accounts, and return 404 for `sw.js` unless the service worker itself is under test.
Check desktop (1366px) and phone (390px, 320px) widths, both themes, and that the page never scrolls sideways.
