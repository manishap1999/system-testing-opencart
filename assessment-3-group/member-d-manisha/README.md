# Member D system tests - F10 Wishlist, F11 Product Comparison, F12 Checkout

Tester: Manisha Pattanaik
Site under test: http://opencart.abstracta.us/index.php?route=common/home

Automated with JavaScript (Node.js) and Playwright. Nine scenarios:
- D01 Wishlist (F10): D01-S1, D01-S2, D01-S3
- D02 Product Comparison (F11): D02-S1, D02-S2, D02-S3
- D03 Checkout (F12): D03-S1, D03-S2, D03-S3

## Set up (once)
1. Install Node.js LTS and Visual Studio Code, then open this folder in VS Code.
2. In the terminal run:

```
npm install
npx playwright install chromium
```

3. Copy `credentials.example.json` to `credentials.json` and put in the email and password of
   a registered account on the site. The wishlist scenarios (D01-S2, D01-S3) log in with it.
   `credentials.json` is listed in `.gitignore` and must not be uploaded.

## Run

```
node d-tests.mjs --headed --http
```

Options: `--only D01-S3` (one scenario) or `--only D03` (one test case), `--retries 0` (no automatic retry).

Output: `screenshots/` (evidence), `results.md` (summary of what the site did), `results.json`.

## Notes
- The site's HTTPS certificate is not trusted by the browser, so the tests run over http://.
- D01-S2 and D01-S3 empty the logged-in account's wishlist first so they start from a known state.
- D03-S2 places a real order on the public demo store using fake guest details.
- Each scenario runs in a new browser context (empty cookies and cart).
