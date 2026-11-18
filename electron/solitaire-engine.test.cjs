'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'solitaire-engine.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const sandbox = { exports: {}, module: { exports: {} }, require };
sandbox.module.exports = sandbox.exports;
vm.runInNewContext(compiled, sandbox);
const { inferGameStep } = sandbox.module.exports;

test('recognizes a known face-up card moving between Solitaire piles', () => {
  const previous = { signature: 'before', cards: [{ code: 'AS', faceUp: true, slot: 'tableau:01:01' }] };
  const next = { signature: 'after', cards: [{ code: 'AS', faceUp: true, slot: 'tableau:02:01' }] };
  const step = inferGameStep(previous, next);
  assert.equal(step.kind, 'move');
  assert.equal(step.from, 'tableau:01');
  assert.equal(step.to, 'tableau:02');
  assert.match(step.description, /AS/);
});

test('recognizes a stable visual identity without inventing card rank or suit', () => {
  const previous = { signature: 'before', cards: [{ code: 'UNKNOWN', faceUp: true, visualId: 'visual-abc', slot: 'tableau:01:01' }] };
  const next = { signature: 'after', cards: [{ code: 'UNKNOWN', faceUp: true, visualId: 'visual-abc', slot: 'tableau:02:01' }] };
  const step = inferGameStep(previous, next);
  assert.equal(step.kind, 'move');
  assert.match(step.description, /kartu belum terbaca/);
});

test('does not infer identity or moves for face-down cards', () => {
  const previous = { signature: 'before', cards: [{ code: 'BACK', faceUp: false, slot: 'tableau:01:01' }] };
  const next = { signature: 'after', cards: [{ code: 'BACK', faceUp: false, slot: 'tableau:02:01' }] };
  assert.equal(inferGameStep(previous, next), null);
});
