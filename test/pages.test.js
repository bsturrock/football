// GitHub Pages compatibility: dots.html and index.html must load when served
// from https://bsturrock.github.io/football/ (legacy branch deploy of main at /,
// case-sensitive host). Checks static hosting marker, page script URLs, and that
// every relative module import resolves to a git-tracked file with exact case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const tracked = new Set(
  execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((p) => p.split(path.sep).join('/')),
);

const SCRIPT_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const INLINE_MODULE = /<script\b([^>]*\btype=["']module["'][^>]*)>([\s\S]*?)<\/script>/gi;
const FROM_SPEC = /from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_SPEC = /import\s+['"]([^'"]+)['"]/g;

const matches = (re, text) => [...text.matchAll(re)].map((m) => m[1]);

// Page-level: every <script src> value, and every module specifier in inline module scripts.
function pageRefs(html) {
  const srcs = matches(SCRIPT_SRC, html);
  const inlineSpecs = [];
  for (const m of html.matchAll(INLINE_MODULE)) {
    if (/\bsrc=/i.test(m[1])) continue;
    inlineSpecs.push(...matches(FROM_SPEC, m[2]), ...matches(BARE_IMPORT_SPEC, m[2]));
  }
  return { srcs, inlineSpecs };
}

function isPagesSafe(spec) {
  if (spec.startsWith('/') || spec.startsWith('http://')) return false;
  if (spec.startsWith('https://')) return true;
  return spec.startsWith('./') || spec.startsWith('../') || !spec.includes(':');
}

// Walk the import graph from the given repo-relative roots (resolved against the repo root).
// Returns the set of repo-relative POSIX paths visited.
function walk(startSpecs) {
  const visited = new Set();
  const queue = [];
  const enqueue = (fromDir, spec) => {
    const rel = path.posix.normalize(path.posix.join(fromDir, spec));
    assert.ok(tracked.has(rel), `import resolves to a path not git-tracked with exact case: ${spec} -> ${rel}`);
    if (!visited.has(rel)) {
      visited.add(rel);
      queue.push(rel);
    }
  };
  for (const spec of startSpecs) enqueue('.', spec);
  while (queue.length) {
    const rel = queue.shift();
    if (!rel.endsWith('.js')) continue;
    const dir = path.posix.dirname(rel);
    const text = read(rel);
    for (const spec of [...matches(FROM_SPEC, text), ...matches(BARE_IMPORT_SPEC, text)]) {
      if (spec.startsWith('.')) enqueue(dir, spec);
    }
  }
  return visited;
}

const dots = read('dots.html');
const index = read('index.html');

test('static hosting marker and entry pages exist at repo root', () => {
  for (const rel of ['dots.html', 'index.html']) {
    assert.ok(existsSync(path.join(root, rel)), `${rel} missing`);
  }
  // Not checked via git ls-files: a freshly created marker may be unstaged.
  assert.ok(existsSync(path.join(root, '.nojekyll')), '.nojekyll missing');
});

test('dots.html script URLs are https or relative', () => {
  const { srcs, inlineSpecs } = pageRefs(dots);
  assert.ok(srcs.length > 0, 'expected at least one <script src> in dots.html');
  for (const spec of [...srcs, ...inlineSpecs]) {
    assert.ok(isPagesSafe(spec), `dots.html reference not https or relative: ${spec}`);
  }
});

test('index.html script URLs are https or relative', () => {
  const { srcs, inlineSpecs } = pageRefs(index);
  assert.ok(srcs.length > 0, 'expected at least one <script src> in index.html');
  for (const spec of [...srcs, ...inlineSpecs]) {
    assert.ok(isPagesSafe(spec), `index.html reference not https or relative: ${spec}`);
  }
});

test('dots.html module graph resolves to tracked files with exact case', () => {
  const { srcs, inlineSpecs } = pageRefs(dots);
  const starts = [...srcs, ...inlineSpecs].filter((s) => !s.startsWith('https://'));
  const visited = walk(starts);
  for (const must of ['src/dots/view.js', 'src/dots/play.js', 'src/util.js']) {
    assert.ok(visited.has(must), `walk did not reach ${must}`);
  }
});

test('index.html module graph resolves to tracked files with exact case', () => {
  const { srcs } = pageRefs(index);
  const starts = srcs.filter((s) => !s.startsWith('https://'));
  const visited = walk(starts);
  for (const must of ['src/main.js', 'src/util.js']) {
    assert.ok(visited.has(must), `walk did not reach ${must}`);
  }
});
