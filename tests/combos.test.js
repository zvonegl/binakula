import { describe, it, expect } from 'vitest';
import { createDeck, cardValue } from '../src/engine/cards.js';
import { validateMeld, meldScore } from '../src/engine/combos.js';

const byId = {};
for (const c of createDeck()) byId[c.id] = c;
const C = (...ids) => ids.map((id) => byId[id]);

describe('špil', () => {
  it('ima 108 karata: 2×52 + 4 jokera, svaka karta u dvije kopije', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c.joker)).toHaveLength(4);
    const counts = {};
    for (const c of deck.filter((c) => !c.joker)) {
      const key = `${c.suit}${c.rank}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    expect(Object.keys(counts)).toHaveLength(52);
    expect(Object.values(counts).every((n) => n === 2)).toBe(true);
  });
});

describe('vrijednosti karata', () => {
  it('joker 3, as 1,5, 2–6 pola boda, ostalo 1 bod (×10)', () => {
    expect(cardValue(byId.JOK_0)).toBe(30);
    expect(cardValue(byId.S1_0)).toBe(15);
    expect(cardValue(byId.S2_0)).toBe(5);
    expect(cardValue(byId.S6_0)).toBe(5);
    expect(cardValue(byId.S7_0)).toBe(10);
    expect(cardValue(byId.S10_0)).toBe(10);
    expect(cardValue(byId.S13_0)).toBe(10);
  });
});

describe('validacija kombinacija', () => {
  it('niz: 3+ uzastopne karte iste boje', () => {
    expect(validateMeld(C('S6_0', 'S7_0', 'S8_0')).valid).toBe(true);
    expect(validateMeld(C('S6_0', 'S8_0', 'S7_0')).type).toBe('run');
  });

  it('niz je ciklički: as spaja K i 2, pa niz ide i "preko asa"', () => {
    expect(validateMeld(C('S1_0', 'S2_0', 'S3_0')).valid).toBe(true);
    expect(validateMeld(C('S12_0', 'S13_0', 'S1_0')).valid).toBe(true);
    expect(validateMeld(C('S13_0', 'S1_0', 'S2_0')).valid).toBe(true);
    // Q,K,A pa se nastavlja s 2 i 3
    expect(validateMeld(C('S12_0', 'S13_0', 'S1_0', 'S2_0', 'S3_0')).valid).toBe(true);
    // ali dva asa izvan Binakule ne smiju
    expect(validateMeld(C('S13_0', 'S1_0', 'S1_1', 'S2_0')).valid).toBe(false);
  });

  it('niz mora biti u istoj boji i bez rupa', () => {
    expect(validateMeld(C('S6_0', 'H7_0', 'S8_0')).valid).toBe(false);
    expect(validateMeld(C('S6_0', 'S8_0', 'S9_0')).valid).toBe(false);
    expect(validateMeld(C('S6_0', 'S6_1', 'S7_0')).valid).toBe(false);
  });

  it('tris: 3 ili 4 iste oznake, sve RAZLIČITIH boja', () => {
    expect(validateMeld(C('H12_0', 'D12_0', 'S12_0')).type).toBe('set');
    expect(validateMeld(C('H12_0', 'D12_0', 'S12_0', 'C12_0')).valid).toBe(true);
    // duplikat iste boje nije dopušten (iako postoje dvije kopije u špilu)
    expect(validateMeld(C('H12_0', 'H12_1', 'S12_0')).valid).toBe(false);
    // više od 4 karte nije dopušteno
    expect(validateMeld(C('H12_0', 'D12_0', 'S12_0', 'C12_0', 'H12_1')).valid).toBe(false);
  });

  it('manje od 3 karte nije kombinacija', () => {
    expect(validateMeld(C('S6_0', 'S7_0')).valid).toBe(false);
  });

  it('binakula: kompletan niz od asa do asa (14 karata) u istoj boji', () => {
    const ids = ['S1_0', ...Array.from({ length: 12 }, (_, i) => `S${i + 2}_0`), 'S1_1'];
    const v = validateMeld(C(...ids));
    expect(v.valid).toBe(true);
    expect(v.type).toBe('binakula');
  });

  it('14 karata koje nisu A–A nije valjano (dva asa u običnom nizu)', () => {
    const ids = ['S1_0', 'S1_1', ...Array.from({ length: 11 }, (_, i) => `S${i + 2}_0`), 'S2_1'];
    expect(validateMeld(C(...ids)).valid).toBe(false);
  });

  it('joker ne smije predstavljati kartu koja je već u kombinaciji', () => {
    // tris 9♥ 9♠ + joker: joker NE smije biti "9♠" (već je na stolu), smije biti 9♣/9♦
    const cards = C('H9_0', 'S9_0', 'JOK_0');
    expect(validateMeld(cards, { JOK_0: { rank: 9, suit: 'S' } }).valid).toBe(false);
    expect(validateMeld(cards, { JOK_0: { rank: 9, suit: 'H' } }).valid).toBe(false);
    expect(validateMeld(cards, { JOK_0: { rank: 9, suit: 'C' } }).valid).toBe(true);
    // dva jokera ne smiju predstavljati istu kartu
    const two = C('H9_0', 'JOK_0', 'JOK_1');
    expect(validateMeld(two, {
      JOK_0: { rank: 9, suit: 'S' }, JOK_1: { rank: 9, suit: 'S' },
    }).valid).toBe(false);
    expect(validateMeld(two, {
      JOK_0: { rank: 9, suit: 'S' }, JOK_1: { rank: 9, suit: 'C' },
    }).valid).toBe(true);
  });

  it('joker bez deklaracije nije valjan; s deklaracijom jest', () => {
    const cards = C('S6_0', 'S7_0', 'JOK_0');
    expect(validateMeld(cards).valid).toBe(false);
    expect(validateMeld(cards, { JOK_0: { rank: 8, suit: 'S' } }).valid).toBe(true);
    expect(validateMeld(cards, { JOK_0: { rank: 9, suit: 'S' } }).valid).toBe(false);
  });
});

describe('bodovanje kombinacija', () => {
  it('zbraja vrijednosti karata', () => {
    expect(meldScore(C('S7_0', 'S8_0', 'S9_0')).total).toBe(30);
    expect(meldScore(C('S1_0', 'S2_0', 'S3_0')).total).toBe(25);
  });

  it('kombinacija od 6+ karata broji se duplo', () => {
    const run6 = C('S4_0', 'S5_0', 'S6_0', 'S7_0', 'S8_0', 'S9_0');
    expect(meldScore(run6)).toMatchObject({ base: 45, double: true, total: 90 });
  });

  it('tris od 4 karte u 4 boje broji se duplo, tris od 3 ne', () => {
    const kings = C('H13_0', 'D13_0', 'S13_0', 'C13_0');
    expect(meldScore(kings)).toMatchObject({ base: 40, double: true, total: 80 });
    const three = C('H13_0', 'D13_0', 'S13_0');
    expect(meldScore(three)).toMatchObject({ base: 30, double: false, total: 30 });
  });

  it('kombinacija s jokerom se NIKAD ne duplira', () => {
    const map = { JOK_0: { rank: 9, suit: 'S' } };
    const run6j = C('S4_0', 'S5_0', 'S6_0', 'S7_0', 'S8_0', 'JOK_0');
    const sc = meldScore(run6j, map);
    expect(sc.double).toBe(false);
    expect(sc.total).toBe(65); // 5+5+5+10+10+30
    const kingsJ = C('H13_0', 'D13_0', 'S13_0', 'JOK_0');
    expect(meldScore(kingsJ, { JOK_0: { rank: 13, suit: 'C' } }).double).toBe(false);
  });

  it('čista binakula vrijedi duplo', () => {
    const ids = ['S1_0', ...Array.from({ length: 12 }, (_, i) => `S${i + 2}_0`), 'S1_1'];
    const sc = meldScore(C(...ids));
    expect(sc).toMatchObject({ base: 125, double: true, total: 250 });
  });
});
