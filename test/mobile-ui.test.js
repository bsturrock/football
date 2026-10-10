// Mobile layout for dots.html: a viewport meta tag so phones lay the page out
// at device width, and a coarse-pointer / narrow-screen media block that makes
// the hint bar, its buttons and select, the info panel and the tooltip readable
// and tappable (44 px targets). Desktop rules outside the block stay as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(path.join(root, 'dots.html'), 'utf8');

const MEDIA = '@media (pointer: coarse), (max-width: 700px)';

// Text from the `{` after the media query to its matching `}` (braces counted).
function mediaBody(text) {
  const start = text.indexOf(MEDIA);
  assert.notEqual(start, -1, 'media query present');
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), before: text.slice(0, start), after: text.slice(i + 1) };
    }
  }
  assert.fail('media block closes');
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Flat rules of a CSS fragment (no nesting): [{ selectors: [...], decls: {prop: value} }].
function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = norm(m[1]).split(',').map((s) => norm(s));
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i === -1) continue;
      decls[norm(d.slice(0, i)).toLowerCase()] = norm(d.slice(i + 1));
    }
    out.push({ selectors, decls });
  }
  return out;
}

// True if some rule has the exact selector and declares prop with value.
function declares(list, selector, prop, value) {
  return list.some((r) => r.selectors.includes(selector) && r.decls[prop] === value);
}

test('viewport meta: exactly one tag with device-width and initial-scale, no zoom lock', () => {
  const tags = html.match(/<meta\s+name=["']viewport["'][^>]*>/gi) ?? [];
  assert.equal(tags.length, 1);
  const content = tags[0].match(/content=["']([^"']*)["']/i);
  assert.ok(content, 'viewport tag has content');
  assert.ok(content[1].includes('width=device-width'));
  assert.ok(content[1].includes('initial-scale=1'));
  assert.ok(!html.includes('maximum-scale'), 'no maximum-scale');
  assert.ok(!html.includes('user-scalable'), 'no user-scalable');
});

test('mobile media block: hint, controls, info panel and tooltip rules', () => {
  assert.ok(html.includes(MEDIA), 'media query present');
  const { body } = mediaBody(html);
  const list = rules(body);
  assert.ok(declares(list, '#hint', 'font-size', '16px'), '#hint font-size 16px');
  assert.ok(declares(list, '#hint button', 'font-size', '16px'), '#hint button font-size 16px');
  assert.ok(declares(list, '#hint select', 'font-size', '16px'), '#hint select font-size 16px');
  assert.ok(declares(list, '#hint button', 'min-height', '44px'), '#hint button min-height 44px');
  assert.ok(declares(list, '#hint select', 'min-height', '44px'), '#hint select min-height 44px');
  assert.ok(declares(list, '#hint button', 'min-width', '44px'), '#hint button min-width 44px');
  assert.ok(declares(list, '#info-panel', 'font-size', '15px'), '#info-panel font-size 15px');
  assert.ok(declares(list, '#tooltip', 'font-size', '15px'), '#tooltip font-size 15px');
});

test('desktop CSS outside the media block is unchanged', () => {
  const { before, after } = mediaBody(html);
  const list = rules(before + after);
  assert.ok(declares(list, '#hint', 'font-size', '12px'), '#hint font-size 12px outside media');
  assert.ok(declares(list, '#info-panel', 'font-size', '13px'), '#info-panel font-size 13px outside media');
});
