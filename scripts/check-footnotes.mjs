/**
 * End-to-end check of adding a footnote, driven through the real editor.
 *
 * The numbering is the delicate part — a note's number is its place in the
 * reading order of the whole New Testament, so it can never be typed by hand —
 * and the unit tests only cover the data. This covers the screen: the button,
 * the marker landing at the cursor, the note appearing with a number nobody
 * typed, and the cursor waiting in it.
 *
 * Needs a dev server: npm run dev, then npm run check:footnotes
 */
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://localhost:5174';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addInitScript(() => window.localStorage.setItem('nt-editor-session', 'screenshot-session'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', async (d) => { errors.push(`UNEXPECTED BROWSER DIALOG: ${d.message()}`); await d.dismiss(); });

let fails = 0;
const ok = (n, c, extra='') => { if (c) console.log('✓ '+n); else { fails++; console.log('✗ '+n+'  '+extra); } };

await page.goto(`${base}/edit`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '1 Timotei', exact: true }).first().click();
const block = page.locator('[data-edit^="block:1-timotei-7:"]').first();
await block.waitFor({ state: 'attached' });
await block.scrollIntoViewIfNeeded();
await block.click({ force: true });
await page.locator('.passage-editor').waitFor();
await page.waitForTimeout(400);

ok('passage has no notes to start with', await page.locator('.passage-editor-notes').count() === 0);

// put the cursor inside the first box, 30 characters in
const box = page.locator('.passage-editor-input').first();
await box.click();
await box.evaluate((el) => { el.setSelectionRange(30, 30); el.dispatchEvent(new Event('click', { bubbles: true })); });
const before = await box.inputValue();

const addNote = page.getByRole('button', { name: '+ Notă' });
ok('the "+ Notă" button is enabled', await addNote.isEnabled());
await addNote.click();
await page.waitForTimeout(700);

ok('no browser prompt dialog appeared', !errors.some((e) => e.includes('BROWSER DIALOG')));
const notes = page.locator('.passage-editor-notes li');
ok('a note was created', await notes.count() === 1, `count=${await notes.count()}`);

const numberLabel = await page.locator('.passage-editor-note-number').first().innerText().catch(() => '');
ok('the note shows a number the editor did not type', /^\*\d+$/.test(numberLabel.trim()), JSON.stringify(numberLabel));

const focused = await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('aria-label') ?? ''));
ok('the cursor is waiting in the new note', focused.startsWith('TEXTAREA') && focused.includes('Nota'), focused);

// type the explanation where the cursor already is
await page.keyboard.type('Explicație de probă.');
await page.waitForTimeout(200);
const noteValue = await page.locator('.passage-editor-notes textarea').first().inputValue();
ok('typing goes straight into the note', noteValue === 'Explicație de probă.', JSON.stringify(noteValue));

// the marker landed in the verse
const after = await page.locator('.passage-editor-input').first().inputValue();
ok('a * marker was put into the text', after.includes('*') && !before.includes('*'),
   JSON.stringify(after.slice(20, 50)));
ok('the marker sits where the cursor was', after.slice(0, 31).endsWith('*'), JSON.stringify(after.slice(25, 35)));

// preview shows the callout
const callout = await page.locator('.passage-editor-preview-pane .note-callout').count();
ok('the preview shows the callout', callout === 1, `count=${callout}`);

// A picture is only saved when one is asked for, so the check can run on its own.
if (process.env.OUT) {
  await page.locator('.passage-editor').screenshot({ path: process.env.OUT });
  console.log(`saved ${process.env.OUT}`);
}
if (errors.length) console.log('\nerrors:\n  ' + errors.join('\n  '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
