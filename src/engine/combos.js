// Validacija kombinacija i bodovanje pojedinačnih kombinacija.
//
// Kombinacija je opisana popisom karata + jokerMap: { [cardId]: {rank, suit} }
// koji za svaki joker deklarira koju točno kartu predstavlja.

import { SUITS, cardValue } from './cards.js';

const inv = (reason) => ({ valid: false, reason });

// "Efektivna" karta: za joker vraća deklariranu kartu, inače stvarnu.
export function effectiveCard(card, jokerMap = {}) {
  if (card.joker) {
    const as = jokerMap[card.id];
    if (!as) return null;
    return { rank: as.rank, suit: as.suit, joker: true };
  }
  return { rank: card.rank, suit: card.suit, joker: false };
}

// Nizovi su CIKLIČKI: as spaja kralja i dvojku, pa je valjano i K,A,2
// ili Q,K,A,2,3. Niz od svih 13 rangova je pun krug; 14 karata = Binakula.
function tryRun(effs) {
  const suit = effs[0].suit;
  if (!effs.every((e) => e.suit === suit)) {
    return inv('Niz mora biti u istoj boji.');
  }
  const n = effs.length;
  const ranks = effs.map((e) => e.rank);

  if (n === 14) {
    // BINAKULA: kompletan niz od asa do asa (A,2,...,K,A) u istoj boji.
    const aceCount = ranks.filter((r) => r === 1).length;
    const nonAce = ranks.filter((r) => r !== 1);
    const distinct = new Set(nonAce);
    if (aceCount === 2 && distinct.size === 12 && nonAce.length === 12) {
      let full = true;
      for (let r = 2; r <= 13; r++) if (!distinct.has(r)) full = false;
      if (full) return { valid: true, type: 'binakula' };
    }
    return inv('Niz od 14 karata mora biti Binakula: A,2,…,K,A u istoj boji.');
  }
  if (n > 13) return inv('Niz može imati najviše 13 karata (14. karta zatvara Binakulu).');
  if (new Set(ranks).size !== n) {
    return inv('Niz ne smije sadržavati istu kartu dvaput (dva asa ima samo Binakula).');
  }
  // Uzastopnost na cikličkom krugu A,2,…,K,A: dopušten je najviše jedan "skok".
  const sorted = [...ranks].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 0; i < n; i++) {
    const d = (((sorted[i] - sorted[(i - 1 + n) % n]) % 13) + 13) % 13;
    if (d !== 1) gaps++;
  }
  if (gaps <= 1) return { valid: true, type: 'run' };
  return inv('Karte ne čine uzastopni niz.');
}

// Redoslijed prikaza/slaganja niza: počinje od ranga iza "skoka"
// (npr. Q,K,A,2,3 → pozicije Q=0, K=1, A=2, 2=3, 3=4).
export function runArcPositions(ranks) {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b);
  const n = sorted.length;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const d = (((sorted[i] - sorted[(i - 1 + n) % n]) % 13) + 13) % 13;
    if (d !== 1) start = i;
  }
  const pos = new Map();
  for (let k = 0; k < n; k++) pos.set(sorted[(start + k) % n], k);
  return pos;
}

// Provjerava je li skup karata valjana kombinacija (tris, niz ili binakula).
export function validateMeld(cards, jokerMap = {}) {
  if (cards.length < 3) return inv('Kombinacija mora imati najmanje 3 karte.');
  const effs = [];
  for (const c of cards) {
    const e = effectiveCard(c, jokerMap);
    if (!e) return inv('Za joker moraš deklarirati koju kartu predstavlja.');
    if (e.joker && (e.rank < 1 || e.rank > 13 || !SUITS.includes(e.suit))) {
      return inv('Nevaljana deklaracija jokera.');
    }
    effs.push(e);
  }
  // Joker ne smije predstavljati kartu koja je već u istoj kombinaciji
  // (ni stvarnu kartu ni deklaraciju drugog jokera).
  const realPairs = new Set(cards.filter((c) => !c.joker).map((c) => `${c.suit}${c.rank}`));
  const jokerPairs = new Set();
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].joker) continue;
    const key = `${effs[i].suit}${effs[i].rank}`;
    if (realPairs.has(key) || jokerPairs.has(key)) {
      return inv('Joker ne smije predstavljati kartu koja je već u toj kombinaciji.');
    }
    jokerPairs.add(key);
  }
  if (effs.every((e) => e.rank === effs[0].rank)) {
    // Tris/skupina: 3 ili 4 karte iste oznake, SVE različitih boja
    // (npr. 9♥ 9♣ 9♠ 9♦ — duplikat iste boje nije dopušten).
    if (effs.length > 4) return inv('Tris može imati najviše 4 karte (po jednu od svake boje).');
    const suits = new Set(effs.map((e) => e.suit));
    if (suits.size !== effs.length) return inv('U trisu sve karte moraju biti različitih boja.');
    return { valid: true, type: 'set' };
  }
  return tryRun(effs);
}

// Bodovanje jedne kombinacije (u desetinkama boda).
// Duplo vrijede samo "čiste" kombinacije (bez jokera):
//  - 6 ili više karata, ili
//  - tris od točno 4 karte u 4 različite boje.
// Binakula (14 karata) je time automatski dupla ako je čista.
export function meldScore(cards, jokerMap = {}, type = null) {
  if (!type) {
    const v = validateMeld(cards, jokerMap);
    type = v.valid ? v.type : 'set';
  }
  const base = cards.reduce((s, c) => s + cardValue(c), 0);
  const hasJoker = cards.some((c) => c.joker);
  let double = false;
  if (!hasJoker) {
    if (cards.length >= 6) double = true;
    if (type === 'set' && cards.length === 4) {
      const suits = new Set(cards.map((c) => c.suit));
      if (suits.size === 4) double = true;
    }
  }
  return { base, double, total: double ? base * 2 : base };
}
