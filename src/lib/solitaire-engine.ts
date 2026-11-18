export type BoardCard = {
  code: string;
  faceUp: boolean;
  slot: string;
  /** Stable visual fingerprint when a face-up card's rank/suit is unavailable. */
  visualId?: string;
};

export type BoardSnapshot = {
  cards: BoardCard[];
  signature: string;
};

export type InferredGameStep = {
  kind: 'move' | 'reveal';
  cards: string[];
  from: string;
  to: string;
  description: string;
  confidence: 'observed' | 'ambiguous';
};

const UNKNOWN_CODES = new Set(['', 'UNKNOWN', 'BACK', 'KARTU_TERTUTUP']);
const CARD_CODE_PATTERN = /^(?:A|[2-9]|10|J|Q|K)[CDHS]$/;

function isValidCardCode(value: string): boolean {
  return CARD_CODE_PATTERN.test(value.trim().toUpperCase());
}

export function decodeBoardSnapshot(label?: string): BoardSnapshot | null {
  try {
    const value = JSON.parse(label || '');
    if (!value || !Array.isArray(value.cards) || typeof value.signature !== 'string') return null;
    const cards = value.cards.filter((card: unknown): card is BoardCard =>
      !!card && typeof card === 'object' &&
      typeof (card as BoardCard).code === 'string' &&
      typeof (card as BoardCard).slot === 'string' &&
      typeof (card as BoardCard).faceUp === 'boolean' &&
      ((card as BoardCard).visualId === undefined || typeof (card as BoardCard).visualId === 'string')
    );
    return cards.length ? { cards, signature: value.signature } : null;
  } catch {
    return null;
  }
}

function pileKey(slot: string): string {
  return slot.split(':').slice(0, 2).join(':');
}

function knownFaceUpCards(snapshot: BoardSnapshot): Map<string, Array<{ slot: string; label: string }>> {
  const locations = new Map<string, Array<{ slot: string; label: string }>>();
  for (const card of snapshot.cards) {
    if (!card.faceUp) continue;
    const code = card.code.trim().toUpperCase();
    const identity = isValidCardCode(code) ? 'card:' + code : (card.visualId ? 'visual:' + card.visualId : '');
    // Hidden cards and cards without a stable visible identity remain unknown.
    if (!identity) continue;
    const entries = locations.get(identity) || [];
    entries.push({ slot: card.slot, label: isValidCardCode(code) ? code : 'kartu belum terbaca' });
    locations.set(identity, entries);
  }
  return locations;
}

/**
 * Infer a game action only from two observed board states. Mouse coordinates
 * are deliberately not used as proof that a card moved.
 */
export function inferGameStep(
  previous: BoardSnapshot,
  next: BoardSnapshot
): InferredGameStep | null {
  const before = knownFaceUpCards(previous);
  const after = knownFaceUpCards(next);

  const moved: Array<{ label: string; from: string; to: string }> = [];
  for (const [identity, oldEntries] of before) {
    const newEntries = after.get(identity);
    // Duplicate DOM representations or ambiguous visual identities are not
    // sufficient evidence for a reliable move.
    if (oldEntries.length !== 1 || !newEntries || newEntries.length !== 1) continue;
    if (pileKey(oldEntries[0].slot) !== pileKey(newEntries[0].slot)) {
      moved.push({ label: oldEntries[0].label, from: pileKey(oldEntries[0].slot), to: pileKey(newEntries[0].slot) });
    }
  }

  if (moved.length) {
    const fromSlots = [...new Set(moved.map((item) => item.from))];
    const toSlots = [...new Set(moved.map((item) => item.to))];
    if (fromSlots.length !== 1 || toSlots.length !== 1) return null;
    const cards = moved.map((item) => item.label);
    return {
      kind: 'move',
      cards,
      from: fromSlots[0],
      to: toSlots[0],
      description: `Pindahkan ${cards.join(', ')} dari posisi ${fromSlots[0]} ke posisi ${toSlots[0]}`,
      confidence: 'observed'
    };
  }

  const newlyRevealed = next.cards.filter((card) => {
    if (!card.faceUp) return false;
    const known = isValidCardCode(card.code.trim().toUpperCase()) || Boolean(card.visualId);
    return known && previous.cards.some((old) => old.slot === card.slot && !old.faceUp);
  });
  if (newlyRevealed.length === 1) {
    const card = newlyRevealed[0];
    return {
      kind: 'reveal',
      cards: [isValidCardCode(card.code.trim().toUpperCase()) ? card.code : 'kartu (identitas belum terbaca)'],
      from: card.slot,
      to: card.slot,
      description: `Buka ${isValidCardCode(card.code.trim().toUpperCase()) ? 'kartu ' + card.code : 'kartu (identitas belum terbaca)'} pada posisi ${card.slot}`,
      confidence: 'observed'
    };
  }

  return null;
}

/**
 * A visible-layout signature is only a candidate key. It is not proof that
 * two deals are identical while any card identity remains hidden/unknown.
 */
export function patternCertainty(snapshot: BoardSnapshot): 'exact' | 'partial' {
  // A card is known only when its face is visibly up and its identity is a
  // valid standard playing-card code. Never count hidden DOM metadata.
  const known = snapshot.cards.filter((card) =>
    card.faceUp &&
    !UNKNOWN_CODES.has(card.code.trim().toUpperCase()) &&
    isValidCardCode(card.code)
  );
  const uniqueCodes = new Set(known.map((card) => card.code.trim().toUpperCase()));
  return snapshot.cards.length === 52 && known.length === 52 && uniqueCodes.size === 52
    ? 'exact'
    : 'partial';
}
