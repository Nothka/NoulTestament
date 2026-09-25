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

// Pressed before the cursor is anywhere: it must say why, not sit there.
const addNoteEarly = page.getByRole('button', { name: '+ Notă' });
ok('the button is pressable even before the cursor is placed', await addNoteEarly.isEnabled());
await addNoteEarly.click();
await page.waitForTimeout(200);
const hint = await page.locator('.passage-editor-hint').innerText().catch(() => '');
ok('pressing it with no cursor explains itself', hint.includes('cursorul'), JSON.stringify(hint));
ok('and it created nothing', await page.locator('.passage-editor-notes li').count() === 0);

// Click into the text the way a person does, and take the caret the browser
// actually put there — no scripted selection, so this exercises the same path
// the editor really gets.
const box = page.locator('.passage-editor-input').first();
await box.click();
await page.waitForTimeout(150);
const caret = await box.evaluate((el) => el.selectionStart);
const before = await box.inputValue();
ok('clicking put the caret somewhere inside the text', caret > 0 && caret < before.length, `caret=${caret}`);

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
// The marker goes in at the caret's offset inside its own verse, and that verse
// starts at a known place in the combined text — so in the box as a whole the
// star must land exactly where the caret was.
ok('the marker sits exactly where the cursor was', after[caret] === '*',
   `caret=${caret} got=${JSON.stringify(after.slice(caret - 8, caret + 3))}`);

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
