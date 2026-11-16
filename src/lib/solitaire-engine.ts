export type BoardCard = {
  code: string;
  faceUp: boolean;
  slot: string;
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

export function decodeBoardSnapshot(label?: string): BoardSnapshot | null {
  try {
    const value = JSON.parse(label || '');
    if (!value || !Array.isArray(value.cards) || typeof value.signature !== 'string') return null;
    const cards = value.cards.filter((card: unknown): card is BoardCard =>
      !!card && typeof card === 'object' &&
      typeof (card as BoardCard).code === 'string' &&
      typeof (card as BoardCard).slot === 'string' &&
      typeof (card as BoardCard).faceUp === 'boolean'
    );
    return cards.length ? { cards, signature: value.signature } : null;
  } catch {
    return null;
  }
}

function knownFaceUpCards(snapshot: BoardSnapshot): Map<string, string[]> {
  const locations = new Map<string, string[]>();
  for (const card of snapshot.cards) {
    const code = card.code.trim().toUpperCase();
    if (!card.faceUp || UNKNOWN_CODES.has(code)) continue;
    const slots = locations.get(code) || [];
    slots.push(card.slot);
    locations.set(code, slots);
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

  const moved: Array<{ code: string; from: string; to: string }> = [];
  for (const [code, oldSlots] of before) {
    const newSlots = after.get(code);
    // Duplicate DOM representations or ambiguous duplicate identities are
    // not sufficient evidence for a reliable move.
    if (oldSlots.length !== 1 || !newSlots || newSlots.length !== 1) continue;
    if (oldSlots[0] !== newSlots[0]) {
      moved.push({ code, from: oldSlots[0], to: newSlots[0] });
    }
  }

  if (moved.length) {
    const fromSlots = [...new Set(moved.map((item) => item.from))];
    const toSlots = [...new Set(moved.map((item) => item.to))];
    if (fromSlots.length !== 1 || toSlots.length !== 1) return null;
    const cards = moved.map((item) => item.code);
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
    if (!card.faceUp || UNKNOWN_CODES.has(card.code.trim().toUpperCase())) return false;
    return previous.cards.some((old) => old.slot === card.slot && !old.faceUp);
  });
  if (newlyRevealed.length === 1) {
    const card = newlyRevealed[0];
    return {
      kind: 'reveal',
      cards: [card.code],
      from: card.slot,
      to: card.slot,
      description: `Buka kartu ${card.code} pada posisi ${card.slot}`,
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
  const known = snapshot.cards.filter((card) =>
    card.faceUp && !UNKNOWN_CODES.has(card.code.trim().toUpperCase())
  );
  const uniqueCodes = new Set(known.map((card) => card.code.trim().toUpperCase()));
  return snapshot.cards.length === 52 && known.length === 52 && uniqueCodes.size === 52
    ? 'exact'
    : 'partial';
}
