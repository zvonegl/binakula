import { describe, it, expect } from 'vitest';
import {
  createGame, startRound, drawFromStock, takeFromDiscard,
  meldNew, meldAdd, redeemJoker, discard, closeRound,
} from '../src/engine/game.js';
import { nextBotAction, decompose } from '../src/bot/bot.js';
import { mulberry32 } from '../src/engine/rng.js';

function applyAction(g, seat, a) {
  switch (a.type) {
    case 'drawStock': return drawFromStock(g, seat);
    case 'takePile': return takeFromDiscard(g, seat, a.index);
    case 'meldNew': return meldNew(g, seat, a.cardIds, a.jokerMap);
    case 'meldAdd': return meldAdd(g, seat, a.meldId, a.cardIds, a.jokerMap);
    case 'redeemJoker': return redeemJoker(g, seat, a.args);
    case 'discard': return discard(g, seat, a.cardId);
    case 'close': return closeRound(g, seat, a.cardId);
    default: throw new Error(`nepoznata akcija: ${a.type}`);
  }
}

function checkInvariants(g) {
  const r = g.round;
  const all = [
    ...r.stock, ...r.discard,
    ...r.hands.flat(),
    ...r.melds.flatMap((m) => m.cardIds),
  ];
  expect(all).toHaveLength(108);
  expect(new Set(all).size).toBe(108);
}

function playRound(g, difficulty, rand) {
  let steps = 0;
  while (!g.round.closed && steps < 5000) {
    const seat = g.round.turn;
    const a = nextBotAction(g, seat, difficulty, rand);
    expect(a).toBeTruthy();
    applyAction(g, seat, a);
    if (steps % 25 === 0) checkInvariants(g);
    steps += 1;
  }
  return steps;
}

describe('bot simulacije', () => {
  for (const n of [2, 3, 4]) {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      it(`${n} botova (${difficulty}) odigraju krug bez ilegalnih poteza`, () => {
        const g = createGame({
          players: Array.from({ length: n }, (_, i) => ({ name: `Bot${i}`, type: 'bot' })),
          seed: 1000 + n * 10 + difficulty.length,
        });
        startRound(g);
        const rand = mulberry32(7);
        const steps = playRound(g, difficulty, rand);
        expect(g.round.closed).toBe(true);
        expect(steps).toBeLessThan(5000);
        checkInvariants(g);
        // Pobjednik kruga je dobio bonus i nema karata u ruci.
        expect(g.round.hands[g.round.closerSeat]).toHaveLength(0);
        expect(g.scores).toHaveLength(1);
      });
    }
  }

  it('partija 2 bota (hard) se odigra do kraja (više krugova)', () => {
    const g = createGame({
      players: [{ name: 'A', type: 'bot' }, { name: 'B', type: 'bot' }],
      seed: 99, target: 600,
    });
    const rand = mulberry32(3);
    let rounds = 0;
    while (!g.gameOver && rounds < 40) {
      startRound(g);
      playRound(g, 'hard', rand);
      rounds += 1;
    }
    expect(g.gameOver).toBe(true);
    expect(g.totals[g.winnerSide]).toBeGreaterThanOrEqual(600);
  });
});

describe('rastav ruke (decompose)', () => {
  it('prepoznaje nizove, triseve i preferira duplu četvorku', () => {
    const byId = {};
    const g = createGame({ players: [{ name: 'a' }, { name: 'b' }], seed: 1 });
    Object.assign(byId, g.cardsById);
    const hand = ['S7_0', 'S8_0', 'S9_0', 'H13_0', 'D13_0', 'C13_0', 'S13_0', 'H2_0']
      .map((id) => byId[id]);
    const d = decompose(hand);
    // Run 30 + četiri kralja u 4 boje duplo 80 = 110, deadwood samo H2.
    expect(d.meldedValue).toBe(110);
    expect(d.deadwood.map((c) => c.id)).toEqual(['H2_0']);
  });
});
