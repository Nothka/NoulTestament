/**
 * Opens the passage editor in a real browser and saves a screenshot of it.
 *
 * The editor is behind a password, but the gate is only "is there a session
 * token in localStorage" — the token is checked by the save endpoint, not by
 * the page. Seeding a dummy one is enough to render edit mode, and nothing
 * here can publish, so this never touches the live text.
 *
 *   node scripts/shot-editor.mjs apocalipsa-1 [out.png]
 *
 * Needs a dev server already running (npm run dev); pass its URL in BASE_URL
 * if it is not on 5173.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const passageId = process.argv[2];
const outFile = process.argv[3] ?? `editor-${passageId}.png`;
const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';

if (!passageId) {
  console.error('usage: node scripts/shot-editor.mjs <passageId> [out.png]');
  process.exit(1);
}

const bookId = passageId.replace(/-\d+$/u, '');
const index = JSON.parse(readFileSync('public/content/books-index.json', 'utf8'));
const book = index.find((entry) => entry.id === bookId);

if (!book) {
  console.error(`no book "${bookId}" in books-index.json`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });

// Seeded before any of the app's own code runs, so the first render is already
// edit mode rather than the login screen.
await context.addInitScript(() => {
  window.localStorage.setItem('nt-editor-session', 'screenshot-session');
});

const page = await context.newPage();
const problems = [];

page.on('console', (message) => {
  if (message.type() === 'error') problems.push(message.text());
});
page.on('pageerror', (error) => problems.push(String(error)));

await page.goto(`${baseUrl}/edit`, { waitUntil: 'networkidle' });

// Pick the book from the navigation, then open the passage by clicking any
// block in it — the same click a person makes.
await page.getByRole('button', { name: book.navTitle, exact: true }).first().click();

const block = page.locator(`[data-edit^="block:${passageId}:"]`).first();
await block.waitFor({ state: 'attached', timeout: 15000 });
await block.scrollIntoViewIfNeeded();
await block.click({ force: true });

const dialog = page.locator('.passage-editor');
await dialog.waitFor({ timeout: 15000 });
await page.waitForTimeout(400);           // let the auto-grow settle

await dialog.screenshot({ path: outFile });

// The left pane on its own is usually what matters, so save it too.
const fields = page.locator('.passage-editor-fields');
if (await fields.count()) {
  await fields.screenshot({ path: outFile.replace(/\.png$/u, '-fields.png') });
}

// Report any box whose text is taller than the box showing it: these boxes hide
// their overflow, so that is text the editor simply cannot see.
const clipped = await page.$$eval('.passage-editor-input', (nodes) => nodes
  .filter((n) => n.scrollHeight - n.clientHeight > 2)
  .map((n) => ({
    hidden: n.scrollHeight - n.clientHeight,
    width: Math.round(n.getBoundingClientRect().width),
    text: n.value.slice(0, 60),
  })));

console.log(`saved ${outFile}`);
if (clipped.length) {
  console.log(`\nCLIPPED BOXES (text taller than the box): ${clipped.length}`);
  for (const c of clipped) console.log(`   ${c.hidden}px hidden, ${c.width}px wide :: ${c.text}`);
} else {
  console.log('no clipped boxes');
}
const narrow = await page.$$eval('.passage-editor-input',
  (nodes) => nodes.filter((n) => n.getBoundingClientRect().width < 120).length);
console.log(narrow ? `WARNING: ${narrow} box(es) narrower than 120px` : 'no squeezed boxes');
if (problems.length) console.log('\nconsole errors:\n  ' + problems.join('\n  '));

await browser.close();
