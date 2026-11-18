'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHttpUrl, isAllowedSolitaire } = require('./security.cjs');

test('browser navigation accepts HTTP and HTTPS URLs', () => {
  assert.equal(parseHttpUrl('https://example.com').protocol, 'https:');
  assert.equal(parseHttpUrl('http://localhost:1420').hostname, 'localhost');
});

test('browser navigation rejects non-web and malformed URLs', () => {
  assert.throws(() => parseHttpUrl('file:///C:/secret.txt'));
  assert.throws(() => parseHttpUrl('javascript:alert(1)'));
  assert.throws(() => parseHttpUrl('not a URL'));
});

test('recording is restricted to the configured HTTPS Solitaire pages', () => {
  assert.equal(isAllowedSolitaire('https://1xlite-6487.com/en/games/solitaire'), true);
  assert.equal(isAllowedSolitaire('https://1xlite-7498.com/en/games/solitaire/daily'), true);
  assert.equal(isAllowedSolitaire('http://1xlite-6487.com/en/games/solitaire'), false);
  assert.equal(isAllowedSolitaire('https://1xlite-6487.com/other'), false);
  assert.equal(isAllowedSolitaire('https://1xlite-6487.com.evil.example/en/games/solitaire'), false);
});
