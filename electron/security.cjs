'use strict';

const GAME_HOSTS = new Set(['1xlite-6487.com', '1xlite-7498.com']);

function parseHttpUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Alamat browser tidak valid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Browser hanya menerima alamat HTTP atau HTTPS.');
  }
  return parsed;
}

function isAllowedSolitaire(value) {
  try {
    const url = parseHttpUrl(value);
    return url.protocol === 'https:' && GAME_HOSTS.has(url.hostname) &&
      url.pathname.startsWith('/en/games/solitaire');
  } catch {
    return false;
  }
}

module.exports = { parseHttpUrl, isAllowedSolitaire };
