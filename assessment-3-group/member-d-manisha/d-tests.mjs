// d-tests.mjs - Member D system tests (Playwright, JavaScript)
//   F10 Wishlist            -> D01-S1..S3   (S2 and S3 log in to the existing test account)
//   F11 Product Comparison  -> D02-S1..S3
//   F12 Checkout            -> D03-S1..S3
//
// Run:   node d-tests.mjs --headed --http        (watch the browser, use http://)
//        node d-tests.mjs --only D03-S2          (only scenarios whose id starts with this)
//        node d-tests.mjs --retries 0            (no automatic retry; default is 1 retry)
//
// Login details are NOT stored in this file. They are read from credentials.json
// (next to this file) or from the OC_EMAIL / OC_PASSWORD environment variables.
//
// Every scenario runs in a brand-new browser context (empty cookies, empty cart),
// so scenarios do not depend on each other.

import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const flagValue = name => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : '';
};
const ONLY = flagValue('--only');
const RETRIES = args.includes('--retries') ? Number(flagValue('--retries')) : 1;

// ---------- credentials (kept out of the source code) ----------
function loadCredentials() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(new URL('./credentials.json', import.meta.url), 'utf8'));
  } catch { /* no file - fall back to environment variables */ }
  return {
    email: process.env.OC_EMAIL || file.email || '',
    password: process.env.OC_PASSWORD || file.password || '',
  };
}
const CREDS = loadCredentials();

// ---------- site addresses ----------
// The demo site has an unreliable HTTPS certificate, so the script can use http or https.
// With neither --http nor --https it tries https first and falls back to http.
let BASE = '';
const URLS = {};
function setBase(scheme) {
  BASE = `${scheme}://opencart.abstracta.us/index.php?route=`;
  Object.assign(URLS, {
    home: BASE + 'common/home',
    login: BASE + 'account/login',
    wishlist: BASE + 'account/wishlist',
    compare: BASE + 'product/compare',
    cart: BASE + 'checkout/cart',
    checkout: BASE + 'checkout/checkout',
  });
}
setBase(args.includes('--http') ? 'http' : 'https');
const productUrl = id => `${BASE}product/product&product_id=${id}`;

// Same products Member C used, so the whole report is consistent.
const PRODUCTS = {
  iPhone: { id: 40 },
  MacBook: { id: 43 },
};
// Products with no required options - tried in order until one can be checked out
// (some demo products show stock warnings and OpenCart may then block checkout).
const CHECKOUT_CANDIDATES = [40, 43, 44, 28, 29, 31, 33, 35, 36, 48, 49];

fs.mkdirSync('screenshots', { recursive: true });

// ---------- tiny assertion helper ----------
function check(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- UI helper: wraps every page action used by the scenarios ----------
class UI {
  constructor(page, id) {
    this.page = page;
    this.id = id;
    this.notes = [];
    this.observed = []; // what the website actually did - copied into results.md
  }
  log(msg) {
    this.observed.push(msg);
  }
  async shot(label) {
    await this.page.screenshot({ path: `screenshots/${this.id}-${label}.png`, fullPage: true });
  }
  async open(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  // Reads the newest alert banner (OpenCart shows AJAX results in a .alert box).
  async alertText() {
    const alert = this.page.locator('.alert').first();
    await alert.waitFor({ state: 'visible', timeout: 10000 });
    await this.shot('alert');
    const text = (await alert.innerText()).replace(/\s+/g, ' ').trim();
    this.log(`Message shown: "${text}"`);
    return text;
  }
  async bodyText() {
    return (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');
  }

  // ----- F1 login with the existing test account (needed for the wishlist) -----
  async login() {
    check(CREDS.email && CREDS.password,
      'No login details found. Fill in credentials.json (email and password) or set OC_EMAIL and OC_PASSWORD.');
    const p = this.page;
    await this.open(URLS.login);
    await p.fill('#input-email', CREDS.email);
    await p.fill('#input-password', CREDS.password);
    await p.locator('input[value="Login"]').click();
    const bad = p.locator('.alert-danger').first();
    await Promise.any([
      p.waitForURL(/account\/account/, { timeout: 20000 }),
      bad.waitFor({ state: 'visible', timeout: 20000 }),
    ]).catch(() => {});
    if (await bad.isVisible().catch(() => false)) {
      const t = (await bad.innerText()).replace(/\s+/g, ' ').trim();
      throw new Error(`Login failed: "${t}"`);
    }
    check(/account\/account/.test(p.url()), `Login did not reach the account page (page: ${p.url()})`);
    this.log('Logged in with the existing test account');
  }

  // ----- F10 wishlist -----
  async addToWishlist(id) {
    await this.open(productUrl(id));
    await this.page.locator('button[onclick*="wishlist.add"]').first().click();
    return this.alertText();
  }
  async wishlistProducts() {
    await this.open(URLS.wishlist);
    if (!this.page.url().includes('account/wishlist')) {
      this.log(`Wishlist page redirected to: ${this.page.url()}`);
      return null; // redirected to login
    }
    const items = await this.page.$$eval('#content table tbody tr td.text-left a', els =>
      els.map(e => e.innerText.trim()).filter(Boolean));
    this.log(`Wishlist page lists: ${JSON.stringify(items)}`);
    return items;
  }
  async removeFirstFromWishlist() {
    const btn = this.page.locator('#content table tbody tr a.btn-danger').first();
    await Promise.all([this.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), btn.click()]);
    return this.alertText();
  }
  // Test data set-up: the account may already hold items from earlier manual testing.
  async clearWishlist() {
    await this.open(URLS.wishlist);
    const removeButtons = this.page.locator('#content table tbody tr a.btn-danger');
    let removed = 0;
    while ((await removeButtons.count()) > 0 && removed < 30) {
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        removeButtons.first().click(),
      ]);
      removed++;
    }
    this.log(`Set-up: removed ${removed} existing wishlist item(s) so the test starts from an empty list`);
  }

  // ----- F11 comparison -----
  async addToCompare(id) {
    await this.open(productUrl(id));
    await this.page.locator('button[onclick*="compare.add"]').first().click();
    return this.alertText();
  }
  async compareProducts() {
    await this.open(URLS.compare);
    const names = await this.page.$$eval('#content table tr', rows => {
      const row = rows.find(r => r.cells[0] && r.cells[0].innerText.trim() === 'Product');
      return row ? [...row.cells].slice(1).map(c => c.innerText.trim()) : [];
    });
    this.log(`Compare page lists: ${JSON.stringify(names)}`);
    return names;
  }
  async removeFromCompare(id) {
    const btn = this.page.locator(`#content a.btn-danger[href*="remove=${id}"]`);
    await Promise.all([this.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), btn.click()]);
  }

  // ----- cart + F12 checkout -----
  async addToCart(id, qty = 1) {
    await this.open(productUrl(id));
    await this.page.fill('#input-quantity', String(qty));
    await this.page.click('#button-cart');
    await this.page.locator('.alert-success').first().waitFor({ state: 'visible', timeout: 15000 });
  }
  // Finds a product that OpenCart lets us check out; leaves it in the cart.
  async fillCartWithCheckoutableProduct() {
    for (const id of CHECKOUT_CANDIDATES) {
      await this.addToCart(id, 1);
      await this.open(URLS.checkout);
      if (this.page.url().includes('checkout/checkout')) {
        this.notes.push(`checkout product_id=${id}`);
        return id;
      }
      this.notes.push(`product_id=${id} blocked (stock) - trying next`);
      await this.page.context().clearCookies(); // new session = empty cart
    }
    throw new Error('No candidate product could be taken to the checkout page (all blocked).');
  }
  // Guest checkout: Step 1 (guest) -> Step 2 (billing) -> Step 4 (delivery method) -> Step 5 (payment).
  async guestCheckoutToPaymentStep() {
    const p = this.page;
    await this.open(URLS.checkout);
    await p.locator('input[name="account"][value="guest"]').check();
    await p.click('#button-account');
    await p.locator('#input-payment-firstname').waitFor({ state: 'visible' });
    await p.fill('#input-payment-firstname', 'Test');
    await p.fill('#input-payment-lastname', 'Tester');
    await p.fill('#input-payment-email', `member.d+${Date.now()}@example.com`);
    await p.fill('#input-payment-telephone', '0400000000');
    await p.fill('#input-payment-address-1', '1 Test Street');
    await p.fill('#input-payment-city', 'Sydney');
    await p.fill('#input-payment-postcode', '2000');
    await p.selectOption('#input-payment-country', { label: 'Australia' });
    await p.waitForSelector('#input-payment-zone option:text("New South Wales")', { state: 'attached' });
    await p.selectOption('#input-payment-zone', { label: 'New South Wales' });
    await p.click('#button-guest');
    await p.locator('#button-shipping-method').waitFor({ state: 'visible' });
    await p.click('#button-shipping-method');
    await p.locator('#button-payment-method').waitFor({ state: 'visible' });
  }
}

// =====================================================================
// D01 - F10 Wishlist
// =====================================================================
export const wishlistScenarios = [
  {
    id: 'D01-S1',
    name: 'Guest cannot save to wishlist (prompted to log in or register)',
    run: async ui => {
      const msg = await ui.addToWishlist(PRODUCTS.iPhone.id);
      check(/login/i.test(msg) && /create an account/i.test(msg),
        `Expected a login/create-account prompt; got: "${msg}"`);
      const list = await ui.wishlistProducts();
      check(list === null, 'Expected guest to be redirected to the login page from the wishlist page');
      check(ui.page.url().includes('account/login'), `Expected login URL; got ${ui.page.url()}`);
    },
  },
  {
    id: 'D01-S2',
    name: 'Logged-in user adds iPhone to the wishlist',
    run: async ui => {
      await ui.login();
      await ui.clearWishlist();
      const msg = await ui.addToWishlist(PRODUCTS.iPhone.id);
      check(/Success/i.test(msg) && /iPhone/.test(msg) && /wish list/i.test(msg),
        `Expected success message for iPhone; got: "${msg}"`);
      const list = await ui.wishlistProducts();
      check(list && list.length === 1 && list[0] === 'iPhone',
        `Expected wishlist [iPhone]; got ${JSON.stringify(list)}`);
      await ui.shot('wishlist-page');
    },
  },
  {
    id: 'D01-S3',
    name: 'Logged-in user removes iPhone from the wishlist',
    run: async ui => {
      await ui.login();
      await ui.clearWishlist();
      await ui.addToWishlist(PRODUCTS.iPhone.id);
      const before = await ui.wishlistProducts();
      check(before && before.includes('iPhone'), 'Precondition failed: iPhone not in wishlist');
      const msg = await ui.removeFirstFromWishlist();
      check(/modified your wish list/i.test(msg), `Expected "modified your wish list"; got: "${msg}"`);
      const after = await ui.wishlistProducts();
      check(after && after.length === 0, `Expected empty wishlist; got ${JSON.stringify(after)}`);
      // Expected (test assumption, no requirements document): the empty Wish List page says so.
      const content = (await ui.page.locator('#content').innerText()).replace(/\s+/g, ' ').trim();
      ui.log(`Wishlist page text after removal: "${content}"`);
      await ui.shot('empty-wishlist');
      check(/wish\s*list is empty/i.test(content),
        `Expected the message "Your wish list is empty."; the page showed: "${content}"`);
    },
  },
];

// =====================================================================
// D02 - F11 Product Comparison
// =====================================================================
export const compareScenarios = [
  {
    id: 'D02-S1',
    name: 'Add one product (iPhone) to the comparison',
    run: async ui => {
      const msg = await ui.addToCompare(PRODUCTS.iPhone.id);
      check(/Success/i.test(msg) && /iPhone/.test(msg) && /comparison/i.test(msg),
        `Expected success message for iPhone; got: "${msg}"`);
      const names = await ui.compareProducts();
      check(names.length === 1 && names[0] === 'iPhone',
        `Expected comparison [iPhone]; got ${JSON.stringify(names)}`);
      await ui.shot('compare-page');
    },
  },
  {
    id: 'D02-S2',
    name: 'Compare two products side by side (iPhone and MacBook)',
    run: async ui => {
      await ui.addToCompare(PRODUCTS.iPhone.id);
      await ui.addToCompare(PRODUCTS.MacBook.id);
      const names = await ui.compareProducts();
      check(names.length === 2 && names.includes('iPhone') && names.includes('MacBook'),
        `Expected [iPhone, MacBook]; got ${JSON.stringify(names)}`);
      const text = await ui.bodyText();
      for (const label of ['Price', 'Model', 'Brand', 'Availability']) {
        check(text.includes(label), `Comparison table is missing the "${label}" row`);
      }
      await ui.shot('compare-page');
    },
  },
  {
    id: 'D02-S3',
    name: 'Remove one product from the comparison',
    run: async ui => {
      await ui.addToCompare(PRODUCTS.iPhone.id);
      await ui.addToCompare(PRODUCTS.MacBook.id);
      await ui.compareProducts();
      await ui.removeFromCompare(PRODUCTS.iPhone.id);
      const names = await ui.compareProducts();
      check(names.length === 1 && names[0] === 'MacBook',
        `Expected only MacBook to remain; got ${JSON.stringify(names)}`);
      await ui.shot('compare-page-after-remove');
    },
  },
];

// =====================================================================
// D03 - F12 Checkout (guest checkout, default shipping, default payment = Bank Transfer)
// NOTE: S2 places a real order on the public demo store - fake test data only.
// =====================================================================
export const checkoutScenarios = [
  {
    id: 'D03-S1',
    name: 'Checkout with an empty cart is not possible',
    run: async ui => {
      await ui.open(URLS.checkout);
      ui.log(`Checkout URL redirected to: ${ui.page.url()}`);
      check(ui.page.url().includes('checkout/cart'),
        `Expected redirect to the cart page; got ${ui.page.url()}`);
      const empty = /shopping cart is empty/i.test(await ui.bodyText());
      ui.log(`Empty-cart message shown: ${empty}`);
      check(empty, 'Expected the empty-cart message');
    },
  },
  {
    id: 'D03-S2',
    name: 'Guest completes checkout and the order is placed',
    run: async ui => {
      await ui.fillCartWithCheckoutableProduct();
      await ui.guestCheckoutToPaymentStep();
      const agree = ui.page.locator('input[name="agree"]');
      await agree.check();
      check(await agree.isChecked(), 'Terms & Conditions box is not ticked');
      await ui.shot('terms-ticked');
      await ui.page.click('#button-payment-method');
      const confirmBtn = ui.page.locator('#button-confirm');
      const dangerBox = ui.page.locator('.alert-danger').first();
      // wait for whichever appears first: the Confirm Order step, or a warning
      await Promise.any([
        confirmBtn.waitFor({ state: 'visible', timeout: 30000 }),
        dangerBox.waitFor({ state: 'visible', timeout: 30000 }),
      ]).catch(() => {});
      if (await dangerBox.isVisible().catch(() => false)) {
        const t = (await dangerBox.innerText()).replace(/\s+/g, ' ').trim();
        ui.log(`Warning shown after Continue on payment step: "${t}"`);
        await ui.shot('payment-warning');
        throw new Error(`Checkout stopped with a warning: "${t}"`);
      }
      check(await confirmBtn.isVisible().catch(() => false),
        `Confirm Order step did not appear (page: ${ui.page.url()})`);
      await ui.shot('confirm-step');
      await ui.page.click('#button-confirm');
      await ui.page.waitForURL(/checkout\/success/, { timeout: 30000 });
      const heading = (await ui.page.locator('#content h1').innerText()).trim();
      ui.log(`Final page heading: "${heading}" (${ui.page.url()})`);
      check(/order has been placed/i.test(heading), `Expected "Your order has been placed!"; got "${heading}"`);
    },
  },
  {
    id: 'D03-S3',
    name: 'Checkout is blocked if Terms & Conditions are not accepted',
    run: async ui => {
      await ui.fillCartWithCheckoutableProduct();
      await ui.guestCheckoutToPaymentStep();
      await ui.page.click('#button-payment-method'); // agree box left unticked
      const warning = ui.page.locator('.alert-danger').filter({ hasText: /Terms/i }).first();
      await warning.waitFor({ state: 'visible', timeout: 15000 });
      ui.log(`Warning shown: "${(await warning.innerText()).replace(/\s+/g, ' ').trim()}"`);
      await ui.shot('terms-warning');
      check(!ui.page.url().includes('checkout/success'), 'Order must not be placed without accepting the terms');
      check(await ui.page.locator('#button-confirm').count() === 0 ||
            !(await ui.page.locator('#button-confirm').isVisible()),
        'Confirm Order step must not be reachable without accepting the terms');
    },
  },
];

// =====================================================================
// Runner
// =====================================================================
const all = [...wishlistScenarios, ...compareScenarios, ...checkoutScenarios]
  .filter(s => !ONLY || s.id.startsWith(ONLY));

const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 300 : 0 });

if (!args.includes('--http') && !args.includes('--https')) {
  const probeCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const probe = await probeCtx.newPage();
  try {
    await probe.goto(URLS.home, { timeout: 15000, waitUntil: 'domcontentloaded' });
  } catch {
    setBase('http');
  }
  await probeCtx.close();
}
console.log(`Testing site: ${URLS.home}`);
console.log(`Login account: ${CREDS.email ? 'found in credentials.json / environment' : 'NOT FOUND (wishlist scenarios will fail)'}\n`);

async function runOnce(sc) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const ui = new UI(page, sc.id);
  let status = 'PASS';
  let detail = '';
  try {
    await sc.run(ui);
  } catch (err) {
    status = 'FAIL';
    detail = String(err.message).replace(/\x1b\[[0-9;]*m/g, '') // strip colour codes
      .split('\n').slice(0, 3).join(' ').trim(); // keeps the locator name
    try {
      ui.log(`Page at failure: ${page.url()}`);
      const alerts = (await page.locator('.alert').allInnerTexts()).map(a => a.replace(/\s+/g, ' ').trim());
      if (alerts.length) ui.log(`Alerts on the page at failure: ${JSON.stringify(alerts)}`);
    } catch { /* ignore */ }
  }
  try { await ui.shot('final'); } catch { /* page may be closed */ }
  await context.close();
  return { status, detail, ui };
}

const results = [];
for (const sc of all) {
  const earlierFailures = [];
  let run;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    run = await runOnce(sc);
    if (run.status === 'PASS') {
      if (attempt > 1) earlierFailures.push(`Passed on attempt ${attempt}`);
      break;
    }
    if (attempt <= RETRIES) {
      earlierFailures.push(`Attempt ${attempt} failed: ${run.detail}`);
      console.log(`      (attempt ${attempt} of ${sc.id} failed - retrying: ${run.detail})`);
    }
  }
  const { status, detail, ui } = run;
  const notes = [...ui.notes, ...earlierFailures];
  results.push({ id: sc.id, name: sc.name, status, detail, notes, observed: ui.observed });
  console.log(`${status}  ${sc.id}  ${sc.name}${detail ? '\n        -> ' + detail : ''}`);
  for (const n of notes) console.log(`        (${n})`);
}

await browser.close();
fs.writeFileSync('results.json', JSON.stringify(results, null, 2));

// results.md: paste-ready text for the "Test Results" row of each test case table.
const today = new Date().toISOString().slice(0, 10);
const md = [`# Member D test results (run on ${today}, ${HEADED ? 'headed' : 'headless'} Chromium via Playwright, ${URLS.home.split('/')[0]}//)\n`];
for (const r of results) {
  md.push(`## ${r.id} - ${r.status}: ${r.name}`);
  for (const o of r.observed) md.push(`- ${o}`);
  for (const n of r.notes) md.push(`- Note: ${n}`);
  if (r.detail) md.push(`- Failure reason: ${r.detail}`);
  md.push('');
}
fs.writeFileSync('results.md', md.join('\n'));

const failed = results.filter(r => r.status === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed. Screenshots: ./screenshots  Results: ./results.md`);
process.exit(failed ? 1 : 0);
