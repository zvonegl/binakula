import { describe, it, expect } from 'vitest';
import { GameRoom } from '../src/net/room.js';
import { isHiddenId } from '../src/net/protocol.js';

// Odigraj cijeli krug u sobi: ljudski igrači šalju jednostavne poteze,
// botovi se rješavaju automatski. Vraća broj koraka.
function playRoundViaRoom(room, humanIds) {
  let steps = 0;
  while (room.phase === 'playing' && !room.game.round.closed && steps < 6000) {
    const seat = room.game.round.turn;
    if (room.isBotSeat(seat)) {
      room.stepBot();
    } else {
      const id = humanIds[seat];
      simpleHumanMove(room, id, seat);
    }
    steps += 1;
  }
  return steps;
}

// Najjednostavniji legalan ljudski potez: vuci pa odbaci (ili zatvori).
function simpleHumanMove(room, id, seat) {
  const r = room.game.round;
  if (r.phase === 'draw') room.applyMemberAction(id, { type: 'drawStock' });
  const hand = room.game.round.hands[seat];
  if (hand.length === 1) {
    room.applyMemberAction(id, { type: 'close', cardId: hand[0] });
    return;
  }
  // odbaci prvu kartu koju smijemo (preskačemo izlaganja radi jednostavnosti)
  for (const cardId of [...hand]) {
    const res = room.applyMemberAction(id, { type: 'discard', cardId });
    if (res.ok) return;
  }
}

describe('GameRoom — lobi', () => {
  it('prvi član postaje host i sjeda na sjedalo 0', () => {
    const room = new GameRoom('ABCD');
    const a = room.addMember('a1', 'Ana');
    expect(room.hostId).toBe('a1');
    expect(a.seat).toBe(0);
    expect(room.lobbyView().seats[0]).toMatchObject({ type: 'human', name: 'Ana', connected: true });
  });

  it('drugi čovjek dobiva ljudsko sjedalo kad host poveća broj igrača', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.setConfig('a1', { numPlayers: 4, seats: [{ type: 'human' }, { type: 'human' }, { type: 'bot' }, { type: 'bot' }] });
    const b = room.addMember('b2', 'Bruno');
    expect(b.seat).toBe(1);
    expect(room.canStart()).toBe(true); // 2 čovjeka spojena + 2 bota
  });

  it('ne može se započeti dok ljudsko sjedalo nije popunjeno', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.setConfig('a1', { numPlayers: 2, seats: [{ type: 'human' }, { type: 'human' }] });
    expect(room.canStart()).toBe(false);
    expect(room.start('a1')).toBe(false);
    room.addMember('b2', 'Bruno');
    expect(room.canStart()).toBe(true);
  });

  it('samo host smije mijenjati postavke i pokrenuti', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.addMember('b2', 'Bruno');
    room.setConfig('b2', { target: 999 }); // nije host — ignorira se
    expect(room.target).toBe(2000);
    expect(room.start('b2', 1)).toBe(false);
  });
});

describe('GameRoom — partija i sinkronizacija', () => {
  it('1 čovjek + 1 bot: krug se odigra do kraja bez ilegalnih poteza', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.setConfig('a1', { numPlayers: 2, seats: [{ type: 'human' }, { type: 'bot' }] });
    expect(room.start('a1', 42)).toBe(true);
    const steps = playRoundViaRoom(room, { 0: 'a1' });
    expect(room.game.round.closed).toBe(true);
    expect(steps).toBeLessThan(6000);
  });

  it('redigirani pogled skriva TUĐE karte, a otkriva vlastite', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.addMember('b2', 'Bruno');
    room.setConfig('a1', { numPlayers: 2, seats: [{ type: 'human' }, { type: 'human' }] });
    room.start('a1', 7);

    const viewA = room.viewForMember('a1'); // sjedalo 0
    expect(viewA.round.hands[0].every((id) => !isHiddenId(id))).toBe(true);  // moje karte prave
    expect(viewA.round.hands[1].every((id) => isHiddenId(id))).toBe(true);   // tuđe skrivene
    expect(viewA.round.hands[0]).toHaveLength(19);
    expect(viewA.round.hands[1]).toHaveLength(19);                            // ali broj se zna
    // špil je skriven, kup je javan
    expect(viewA.round.stock.every((id) => isHiddenId(id))).toBe(true);
    expect(viewA.round.discard.every((id) => !isHiddenId(id))).toBe(true);

    const viewB = room.viewForMember('b2'); // sjedalo 1 — sada su prave njegove
    expect(viewB.round.hands[1].every((id) => !isHiddenId(id))).toBe(true);
    expect(viewB.round.hands[0].every((id) => isHiddenId(id))).toBe(true);
    // isti špil, ista gornja karta kupa kod oba igrača
    expect(viewB.round.discard).toEqual(viewA.round.discard);
  });

  it('ne može se odigrati potez kad nije tvoj red', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.addMember('b2', 'Bruno');
    room.setConfig('a1', { numPlayers: 2, seats: [{ type: 'human' }, { type: 'human' }] });
    room.start('a1', 7);
    const onTurn = room.game.round.turn;
    const offTurnId = onTurn === 0 ? 'b2' : 'a1';
    const res = room.applyMemberAction(offTurnId, { type: 'drawStock' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/nisi na potezu/i);
  });

  it('pogled ne sadrži funkciju RNG-a (mora biti JSON-siguran)', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana');
    room.setConfig('a1', { numPlayers: 2, seats: [{ type: 'human' }, { type: 'bot' }] });
    room.start('a1', 1);
    const view = room.viewForMember('a1');
    expect(() => JSON.stringify(view)).not.toThrow();
    expect(view.rng).toBeUndefined();
  });

  it('puna partija 4 bota (2 na 2) ide do cilja', () => {
    const room = new GameRoom('ABCD');
    room.addMember('a1', 'Ana'); // host na sjedalu 0
    room.setConfig('a1', {
      numPlayers: 4,
      seats: [{ type: 'human' }, { type: 'bot' }, { type: 'bot' }, { type: 'bot' }],
      target: 600,
    });
    room.start('a1', 5);
    let rounds = 0;
    while (room.phase === 'playing' && rounds < 60) {
      playRoundViaRoom(room, { 0: 'a1' });
      if (room.game.gameOver) break;
      room.nextRound('a1');
      rounds += 1;
    }
    expect(room.game.gameOver).toBe(true);
    expect(room.phase).toBe('ended');
  });
});
