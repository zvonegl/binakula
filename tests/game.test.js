import { describe, it, expect } from 'vitest';
import {
  createGame, startRound, drawFromStock, takeFromDiscard, undoTake, canTakeAt,
  meldNew, meldAdd, redeemJoker, discard, closeRound, GameError,
} from '../src/engine/game.js';

function game(n, seed = 42) {
  const g = createGame({
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, type: 'human' })),
    seed,
  });
  startRound(g);
  return g;
}

// Krafted scenarij: ručno postavljamo ruke/kup/špil radi determinizma.
function setRound(g, { hands, discard: disc, stock, melds, turn = 0, phase = 'draw' }) {
  const r = g.round;
  if (hands) r.hands = hands;
  if (disc) r.discard = disc;
  if (stock) r.stock = stock;
  if (melds) {
    r.melds = melds.map((m, i) => ({ id: i + 1, jokerMap: {}, ...m }));
    r.nextMeldId = melds.length + 1;
  }
  r.turn = turn;
  r.phase = phase;
  r.pendingPileCardId = null;
  return r;
}

describe('dijeljenje', () => {
  it('svaki igrač dobiva 19 karata, jedna otvara kup, ostalo je špil', () => {
    for (const n of [2, 3, 4]) {
      const g = game(n);
      expect(g.round.hands.every((h) => h.length === 19)).toBe(true);
      expect(g.round.discard).toHaveLength(1);
      expect(g.round.stock).toHaveLength(108 - 19 * n - 1);
    }
  });

  it('isti seed daje isto dijeljenje (determinizam)', () => {
    const a = game(3, 123);
    const b = game(3, 123);
    expect(a.round.hands).toEqual(b.round.hands);
    expect(a.round.stock).toEqual(b.round.stock);
    const c = game(3, 124);
    expect(c.round.hands).not.toEqual(a.round.hands);
  });
});

describe('vučenje i odbacivanje', () => {
  it('vučenje sa špila pa odbacivanje predaje potez', () => {
    const g = game(2);
    const ev = drawFromStock(g, 0);
    expect(g.round.hands[0]).toHaveLength(20);
    expect(g.round.phase).toBe('meld');
    discard(g, 0, ev.cardId);
    expect(g.round.turn).toBe(1);
    expect(g.round.phase).toBe('draw');
    expect(g.round.discard[g.round.discard.length - 1]).toBe(ev.cardId);
  });

  it('ne može se odbaciti prije vučenja ni vući dvaput', () => {
    const g = game(2);
    expect(() => discard(g, 0, g.round.hands[0][0])).toThrow(GameError);
    drawFromStock(g, 0);
    expect(() => drawFromStock(g, 0)).toThrow(GameError);
  });

  it('kad se špil potroši, kup (osim vrha) postaje novi špil', () => {
    const g = game(2);
    setRound(g, {
      hands: [['H2_0', 'H3_0'], ['H4_0']],
      stock: [],
      discard: ['S5_0', 'S6_0', 'S7_1', 'D9_0'],
    });
    drawFromStock(g, 0);
    expect(g.round.discard).toEqual(['D9_0']);
    expect(g.round.stock).toHaveLength(2); // 3 promiješane − 1 izvučena
    expect(g.round.hands[0]).toHaveLength(3);
  });
});

describe('uzimanje iz otvorenog kupa', () => {
  it('uzima odabranu kartu i SVE iznad nje; najdonja se mora moći izložiti', () => {
    const g = game(2);
    setRound(g, {
      hands: [['S7_0', 'S8_0', 'H2_0', 'H9_0'], ['D4_0']],
      discard: ['C3_0', 'S9_0', 'D11_0', 'C13_0'],
    });
    // S9 (indeks 1) se uklapa uz S7,S8 iz ruke → smije se uzeti od tamo.
    expect(canTakeAt(g, 0, 1)).toBeTruthy();
    const ev = takeFromDiscard(g, 0, 1);
    expect(ev.takenIds).toEqual(['S9_0', 'D11_0', 'C13_0']);
    expect(g.round.discard).toEqual(['C3_0']);
    expect(g.round.pendingPileCardId).toBe('S9_0');
    // Odbacivanje je blokirano dok se najdonja karta ne izloži.
    expect(() => discard(g, 0, 'H2_0')).toThrow(/izloži/i);
    meldNew(g, 0, ['S7_0', 'S8_0', 'S9_0']);
    expect(g.round.pendingPileCardId).toBeNull();
    discard(g, 0, 'H2_0');
    expect(g.round.turn).toBe(1);
  });

  it('odbija uzimanje kad se najdonja karta nema kamo izložiti', () => {
    const g = game(2);
    setRound(g, {
      hands: [['S7_0', 'S8_0', 'H2_0'], ['D4_0']],
      discard: ['C3_0', 'S9_0', 'D11_0'],
    });
    expect(canTakeAt(g, 0, 0)).toBeNull(); // C3 se ne uklapa ni u što
    expect(() => takeFromDiscard(g, 0, 0)).toThrow(GameError);
  });

  it('najdonja karta se može izložiti i dodavanjem na svoju kombinaciju', () => {
    const g = game(2);
    setRound(g, {
      hands: [['H2_0', 'H9_0'], ['D4_0']],
      discard: ['C3_0', 'S9_0'],
      melds: [{ side: 0, cardIds: ['S6_0', 'S7_0', 'S8_0'], type: 'run' }],
    });
    const plan = canTakeAt(g, 0, 1);
    expect(plan).toMatchObject({ kind: 'extend', meldId: 1 });
    takeFromDiscard(g, 0, 1);
    meldAdd(g, 0, 1, ['S9_0']);
    expect(g.round.pendingPileCardId).toBeNull();
  });

  it('poništavanje uzimanja vraća kup i ruku', () => {
    const g = game(2);
    setRound(g, {
      hands: [['S7_0', 'S8_0', 'H2_0'], ['D4_0']],
      discard: ['C3_0', 'S9_0', 'D11_0'],
    });
    takeFromDiscard(g, 0, 1);
    undoTake(g, 0);
    expect(g.round.discard).toEqual(['C3_0', 'S9_0', 'D11_0']);
    expect(g.round.hands[0]).toEqual(['S7_0', 'S8_0', 'H2_0']);
    expect(g.round.phase).toBe('draw');
  });
});

describe('izlaganje', () => {
  it('odbija nevaljanu kombinaciju i izlaganje zadnje karte', () => {
    const g = game(2);
    setRound(g, { hands: [['S7_0', 'S8_0', 'S9_0'], ['D4_0']], phase: 'meld' });
    expect(() => meldNew(g, 0, ['S7_0', 'S8_0', 'S9_0'])).toThrow(/barem jedna/i);
    g.round.hands[0].push('H2_0');
    expect(() => meldNew(g, 0, ['S7_0', 'S8_0', 'H2_0'])).toThrow(GameError);
    meldNew(g, 0, ['S7_0', 'S8_0', 'S9_0']);
    expect(g.round.melds).toHaveLength(1);
    expect(g.round.hands[0]).toEqual(['H2_0']);
  });

  it('u igri 2 na 2 smije se dodavati na partnerove, ali ne protivničke kombinacije', () => {
    const g = game(4);
    setRound(g, {
      hands: [['S9_0', 'H2_0'], ['D4_0'], ['C5_0'], ['C6_0']],
      melds: [
        { side: 0, cardIds: ['S6_0', 'S7_0', 'S8_0'], type: 'run' },  // izložio partner (sjedalo 2)
        { side: 1, cardIds: ['D6_0', 'D7_0', 'D8_0'], type: 'run' },
      ],
      phase: 'meld',
    });
    expect(() => meldAdd(g, 0, 2, ['S9_0'])).toThrow(/protivničke/i);
    meldAdd(g, 0, 1, ['S9_0']);
    expect(g.round.melds[0].cardIds).toContain('S9_0');
  });

  it('karte u kombinaciji uvijek su pravilno poslagane (joker na svom mjestu)', () => {
    const g = game(2);
    setRound(g, {
      hands: [['H6_0', 'H3_0', 'JOK_0', 'H4_0', 'D2_0'], ['D4_0']],
      phase: 'meld',
    });
    // izloženo izmiješano: 6,3,J,4 → mora stajati 3,4,J(=5),6
    const ev = meldNew(g, 0, ['H6_0', 'H3_0', 'JOK_0', 'H4_0'], { JOK_0: { rank: 5, suit: 'H' } });
    expect(ev.meld.cardIds).toEqual(['H3_0', 'H4_0', 'JOK_0', 'H6_0']);
    // dodavanje 7♥ ostaje sortirano
    g.round.hands[0].push('H7_0');
    meldAdd(g, 0, ev.meld.id, ['H7_0']);
    expect(ev.meld.cardIds).toEqual(['H3_0', 'H4_0', 'JOK_0', 'H6_0', 'H7_0']);
  });

  it('na Q,K,A smije se nastaviti s 2 i 3; redoslijed prati luk niza', () => {
    const g = game(2);
    setRound(g, {
      hands: [['S2_0', 'S3_0', 'H9_0'], ['D4_0']],
      melds: [{ side: 0, seat: 0, cardIds: ['S12_0', 'S13_0', 'S1_0'], type: 'run' }],
      phase: 'meld',
    });
    meldAdd(g, 0, 1, ['S2_0', 'S3_0']);
    expect(g.round.melds[0].cardIds).toEqual(['S12_0', 'S13_0', 'S1_0', 'S2_0', 'S3_0']);
  });

  it('izlaganje binakule se prepoznaje', () => {
    const g = game(2);
    const bin = ['S1_0', ...Array.from({ length: 12 }, (_, i) => `S${i + 2}_0`), 'S1_1'];
    setRound(g, { hands: [[...bin, 'H2_0'], ['D4_0']], phase: 'meld' });
    const ev = meldNew(g, 0, bin);
    expect(ev.binakula).toBe(true);
    expect(ev.meld.type).toBe('binakula');
  });
});

describe('otkup jokera', () => {
  function jokerSetup() {
    const g = game(2);
    setRound(g, {
      hands: [['S9_1', 'D10_0', 'H10_0', 'H2_0'], ['D4_0']],
      melds: [
        // Protivnikova kombinacija s jokerom koji predstavlja ♠9.
        { side: 1, cardIds: ['S7_0', 'S8_0', 'JOK_0'], jokerMap: { JOK_0: { rank: 9, suit: 'S' } }, type: 'run' },
      ],
      phase: 'meld',
    });
    return g;
  }

  it('zamjenska karta sjeda na mjesto jokera, joker ide u ruku', () => {
    const g = jokerSetup();
    redeemJoker(g, 0, { meldId: 1, jokerId: 'JOK_0', replacementCardId: 'S9_1' });
    expect(g.round.melds[0].cardIds).toEqual(['S7_0', 'S8_0', 'S9_1']);
    expect(g.round.melds[0].jokerMap).toEqual({});
    expect(g.round.hands[0]).toContain('JOK_0');
  });

  it('otkupljeni joker mora se izložiti do kraja poteza, slaže se gdje god', () => {
    const g = jokerSetup();
    g.round.hands[0].push('C5_0');
    redeemJoker(g, 0, { meldId: 1, jokerId: 'JOK_0', replacementCardId: 'S9_1' });
    // odbacivanje je blokirano dok je joker u ruci
    expect(() => discard(g, 0, 'H2_0')).toThrow(/joker/i);
    // joker se slobodno izlaže u bilo kojoj (ovdje: novoj) kombinaciji
    meldNew(g, 0, ['D10_0', 'H10_0', 'JOK_0'], { JOK_0: { rank: 10, suit: 'C' } });
    expect(g.round.pendingJokers).toEqual([]);
    discard(g, 0, 'H2_0');
    expect(g.round.turn).toBe(1);
  });

  it('otkup nije moguć ako se joker nema kamo izložiti', () => {
    const g = jokerSetup();
    g.round.hands[0] = ['S9_1', 'H2_0'];
    expect(() => redeemJoker(g, 0, {
      meldId: 1, jokerId: 'JOK_0', replacementCardId: 'S9_1',
    })).toThrow(/nemaš kamo/i);
  });

  it('otkup krivom kartom ne prolazi', () => {
    const g = jokerSetup();
    expect(() => redeemJoker(g, 0, {
      meldId: 1, jokerId: 'JOK_0', replacementCardId: 'D10_0',
    })).toThrow(/točno karta/i);
  });
});

describe('zatvaranje kruga i bodovanje', () => {
  it('zadnja karta ide na zatvoreni špil, pobjednik dobiva bonus 10 (=100)', () => {
    const g = game(2);
    setRound(g, {
      // Igrač 0: na stolu 6-karta run (duplo), u ruci 1 karta za zatvaranje.
      hands: [['H2_0'], ['D1_0', 'D5_0', 'C13_0']], // protivniku ostaje 15+5+10 = 30
      melds: [
        { side: 0, cardIds: ['S4_0', 'S5_0', 'S6_0', 'S7_0', 'S8_0', 'S9_0'], type: 'run' },
        { side: 1, cardIds: ['H12_0', 'D12_0', 'S12_0'], type: 'set' },
      ],
      stock: ['C2_0'],
      phase: 'meld',
    });
    const ev = closeRound(g, 0, 'H2_0');
    expect(g.round.closed).toBe(true);
    expect(g.round.stock[g.round.stock.length - 1]).toBe('H2_0');
    // Strana 0: 45×2 (duplo) + 100 bonusa = 190; strana 1: 30 − 30 u ruci = 0.
    expect(ev.result.perSide).toEqual([190, 0]);
    expect(g.totals).toEqual([190, 0]);
  });

  it('igrač koji nije izašao može završiti krug u minusu', () => {
    const g = game(2);
    setRound(g, {
      hands: [['H2_0'], ['D1_0', 'JOK_3', 'C13_0']],
      melds: [{ side: 0, cardIds: ['S7_0', 'S8_0', 'S9_0'], type: 'run' }],
      stock: ['C2_0'],
      phase: 'meld',
    });
    const ev = closeRound(g, 0, 'H2_0');
    expect(ev.result.perSide).toEqual([130, -55]); // 30+100 ; −(15+30+10)
  });

  it('u igri 2 na 2 partneri dijele rezultat (kombinacije + obje ruke)', () => {
    const g = game(4);
    setRound(g, {
      hands: [['H2_0'], ['D5_0'], ['C13_0', 'C13_1'], ['S2_1']],
      melds: [
        { side: 0, cardIds: ['S7_0', 'S8_0', 'S9_0'], type: 'run' },   // igrač 0
        { side: 0, cardIds: ['H4_0', 'D4_0', 'C4_0'], type: 'set' },   // partner (2)
        { side: 1, cardIds: ['D9_0', 'D10_0', 'D11_0'], type: 'run' },
      ],
      stock: ['C2_0'],
      phase: 'meld',
    });
    const ev = closeRound(g, 0, 'H2_0');
    // Strana 0: 30 + 15 − partnerova ruka (20) + 100 = 125
    // Strana 1: 30 − (5 + 5) = 20
    expect(ev.result.perSide).toEqual([125, 20]);
  });

  it('ne može se zatvoriti s više od jedne karte ni odbaciti zadnja karta', () => {
    const g = game(2);
    setRound(g, { hands: [['H2_0', 'H3_0'], ['D4_0']], phase: 'meld' });
    expect(() => closeRound(g, 0, 'H2_0')).toThrow(/točno jedna/i);
    g.round.hands[0] = ['H2_0'];
    expect(() => discard(g, 0, 'H2_0')).toThrow(/zatvaraš/i);
  });

  it('partija završava kad strana dosegne cilj', () => {
    const g = game(2);
    g.totals = [1400, 0];
    setRound(g, {
      hands: [['H2_0'], ['D4_0']],
      melds: [{ side: 0, cardIds: ['S7_0', 'S8_0', 'S9_0'], type: 'run' }],
      stock: ['C2_0'],
      phase: 'meld',
    });
    closeRound(g, 0, 'H2_0'); // 1400 + 130 ≥ 1500
    expect(g.gameOver).toBe(true);
    expect(g.winnerSide).toBe(0);
  });
});
