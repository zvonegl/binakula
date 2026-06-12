// Karte: dva standardna špila od 52 karte + 4 jokera = 108 karata.
// Od svake obične karte postoje točno dvije identične kopije (copy 0 i 1).
//
// Bodovne vrijednosti se interno vode u "tradicionalnoj notaciji" (×10),
// kao cijeli brojevi: As = 15 (1,5 boda), joker = 30 (3 boda) itd.
// Time izbjegavamo decimalne brojeve, a prikaz odgovara tradicionalnom zapisu.

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAMES = { S: 'pik', H: 'herc', D: 'karo', C: 'tref' };
export const RED_SUITS = new Set(['H', 'D']);

export const RANK_LABELS = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

export function cardLabel(card, jokerAs = null) {
  if (card.joker) {
    if (jokerAs) return `Joker (= ${SUIT_SYMBOLS[jokerAs.suit]}${RANK_LABELS[jokerAs.rank]})`;
    return 'Joker';
  }
  return `${SUIT_SYMBOLS[card.suit]}${RANK_LABELS[card.rank]}`;
}

// Vraća svih 108 karata. ID je stabilan i čitljiv: "S7_0" = ♠7, prva kopija.
export function createDeck() {
  const cards = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: `${suit}${rank}_${copy}`, suit, rank, copy, joker: false });
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({ id: `JOK_${i}`, suit: null, rank: 0, copy: i, joker: true });
  }
  return cards;
}

// Vrijednost karte u desetinkama boda (tradicionalna notacija ×10).
export function cardValue(card) {
  if (card.joker) return 30;       // joker = 3 boda
  if (card.rank === 1) return 15;  // as = 1,5 boda
  if (card.rank >= 2 && card.rank <= 6) return 5; // 2–6 = 0,5 boda
  return 10;                       // 7,8,9,10,J,Q,K = 1 bod
}

// Tradicionalni zapis: interna vrijednost je već ×10, samo formatiramo broj.
export function formatTraditional(tenths) {
  return String(tenths);
}

// Stvarna bodovna vrijednost s decimalnim zarezom, za tooltipe (225 → "22,5").
export function formatReal(tenths) {
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return frac === 0 ? `${whole}` : `${whole},${frac}`;
}
