// GameRoom — logika jedne online sobe, neovisna o transportu (PartyKit, ws…).
// Drži lobi i partiju, primjenjuje poteze preko enginea, vodi botove i
// proizvodi redigirane poglede + događaje. Transport (server) samo prosljeđuje
// poruke i šalje ono što GameRoom vrati.

import {
  createGame, startRound, drawFromStock, takeFromDiscard, undoTake,
  meldNew, meldAdd, redeemJoker, discard, closeRound, GameError,
} from '../engine/game.js';
import { nextBotAction } from '../bot/bot.js';
import { serializeGameForSeat, redactEvent } from './protocol.js';

const DIFFS = ['easy', 'medium', 'hard'];
const clampPlayers = (n) => ([2, 3, 4].includes(n) ? n : 2);

export function defaultSeats(numPlayers) {
  // Sjedalo 0 je prvi čovjek koji uđe (host); ostala su botovi dok ih ljudi ne zauzmu.
  return Array.from({ length: numPlayers }, (_, i) => ({
    type: i === 0 ? 'human' : 'bot',
    difficulty: 'medium',
    name: i === 0 ? null : `Bot ${i + 1}`,
    memberId: null,
    connected: false,
  }));
}

export class GameRoom {
  constructor(code) {
    this.code = code;
    this.phase = 'lobby';        // 'lobby' | 'playing' | 'ended'
    this.numPlayers = 2;
    this.target = 2000;
    this.seats = defaultSeats(2);
    this.members = new Map();     // memberId → { id, name, seat|null }
    this.hostId = null;
    this.game = null;
    this.lastEvent = null;
  }

  // ---- lobi -------------------------------------------------------------

  addMember(id, name) {
    const m = { id, name: name || 'Igrač', seat: null };
    this.members.set(id, m);
    if (!this.hostId) this.hostId = id;
    if (this.phase === 'lobby') this._assignSeat(m);
    else this._reattach(m);    // partija u tijeku: pokušaj povratak na svoje sjedalo
    return m;
  }

  removeMember(id) {
    const m = this.members.get(id);
    if (!m) return;
    if (m.seat != null && this.seats[m.seat]) {
      this.seats[m.seat].connected = false;
      this.seats[m.seat].memberId = null;
    }
    this.members.delete(id);
    if (this.hostId === id) {
      const next = [...this.members.keys()][0] || null;
      this.hostId = next;
    }
  }

  _assignSeat(m) {
    const free = this.seats.findIndex((s) => s.type === 'human' && !s.memberId);
    if (free >= 0) {
      m.seat = free;
      this.seats[free].memberId = m.id;
      this.seats[free].name = m.name;
      this.seats[free].connected = true;
    }
  }

  _reattach(m) {
    // Igra je u tijeku — vrati igrača na sjedalo s istim imenom ako se oslobodilo.
    const idx = this.seats.findIndex((s) => s.type === 'human' && s.name === m.name && !s.connected);
    if (idx >= 0) {
      m.seat = idx;
      this.seats[idx].memberId = m.id;
      this.seats[idx].connected = true;
    }
  }

  setConfig(id, { numPlayers, seats, target }) {
    if (id !== this.hostId || this.phase !== 'lobby') return;
    if (numPlayers != null) {
      this.numPlayers = clampPlayers(numPlayers);
      const old = this.seats;
      this.seats = defaultSeats(this.numPlayers);
      // zadrži dosadašnje članove na njihovim sjedalima gdje je moguće
      for (let i = 0; i < this.numPlayers; i++) if (old[i]) this.seats[i] = old[i];
      // ponovo posjedni spojene članove
      for (const m of this.members.values()) { m.seat = null; }
      this.seats.forEach((s) => { s.memberId = null; s.connected = false; });
      for (const m of this.members.values()) this._assignSeat(m);
    }
    if (Array.isArray(seats)) {
      seats.forEach((cfg, i) => {
        if (!this.seats[i]) return;
        if (cfg.type === 'bot' || cfg.type === 'human') {
          // ne izbacuj spojenog čovjeka pretvaranjem u bota osim ako je prazno
          if (cfg.type === 'bot' && this.seats[i].memberId) return;
          this.seats[i].type = cfg.type;
        }
        if (cfg.difficulty && DIFFS.includes(cfg.difficulty)) this.seats[i].difficulty = cfg.difficulty;
        if (cfg.type === 'bot' && !this.seats[i].memberId) this.seats[i].name = cfg.name || `Bot ${i + 1}`;
      });
      // nakon promjena, posjedni eventualne nove ljudske ladice
      for (const m of this.members.values()) if (m.seat == null) this._assignSeat(m);
    }
    if (target != null && target > 0) this.target = target;
  }

  canStart() {
    if (this.phase !== 'lobby') return false;
    return this.seats.every((s) => s.type === 'bot' || (s.type === 'human' && s.memberId && s.connected));
  }

  start(id, seed) {
    if (id !== this.hostId || !this.canStart()) return false;
    const players = this.seats.map((s, i) => ({
      name: s.name || (s.type === 'bot' ? `Bot ${i + 1}` : `Igrač ${i + 1}`),
      type: s.type,
      difficulty: s.difficulty,
    }));
    this.game = createGame({ players, target: this.target, seed });
    startRound(this.game);
    this.phase = 'playing';
    return true;
  }

  // ---- partija ----------------------------------------------------------

  seatOfMember(id) {
    const m = this.members.get(id);
    return m ? m.seat : null;
  }

  isBotSeat(seat) {
    return this.seats[seat] && this.seats[seat].type === 'bot';
  }

  // Primijeni potez igrača; vraća { ok, event?, error? }.
  applyMemberAction(id, action) {
    if (this.phase !== 'playing' || !this.game) return { ok: false, error: 'Partija nije u tijeku.' };
    const seat = this.seatOfMember(id);
    if (seat == null) return { ok: false, error: 'Nisi za stolom.' };
    if (this.game.round.turn !== seat) return { ok: false, error: 'Nisi na potezu.' };
    return this._apply(seat, action);
  }

  // Jedan bot-potez ako je na redu bot; vraća event ili null.
  stepBot() {
    if (this.phase !== 'playing' || !this.game || this.game.round.closed) return null;
    const seat = this.game.round.turn;
    if (!this.isBotSeat(seat)) return null;
    const a = nextBotAction(this.game, seat, this.seats[seat].difficulty);
    if (!a) { return this._botFallback(seat); }
    const res = this._apply(seat, a);
    return res.ok ? res.event : this._botFallback(seat);
  }

  _apply(seat, action) {
    try {
      const event = applyAction(this.game, seat, action);
      this.lastEvent = event;
      if (event && event.type === 'close') this._onRoundClosed();
      return { ok: true, event };
    } catch (e) {
      if (e instanceof GameError) return { ok: false, error: e.message };
      throw e;
    }
  }

  _onRoundClosed() {
    if (this.game.gameOver) this.phase = 'ended';
  }

  // Host (ili automatika) pokreće sljedeći krug nakon zatvaranja.
  nextRound(id) {
    if (id !== this.hostId) return false;
    if (this.phase !== 'playing' || !this.game || !this.game.round.closed) return false;
    if (this.game.gameOver) return false;
    startRound(this.game);
    return true;
  }

  // Serversko automatsko napredovanje u sljedeći krug (nakon prikaza sažetka).
  advanceRound() {
    if (this.phase !== 'playing' || !this.game || !this.game.round.closed || this.game.gameOver) return false;
    startRound(this.game);
    return true;
  }

  _botFallback(seat) {
    const r = this.game.round;
    try {
      if (r.phase === 'draw') return this._apply(seat, { type: 'drawStock' }).event;
      if (r.takeSnapshot) return this._apply(seat, { type: 'undoTake' }).event;
      if (r.hands[seat].length === 1) return this._apply(seat, { type: 'close', cardId: r.hands[seat][0] }).event;
      for (const id of [...r.hands[seat]]) {
        const res = this._apply(seat, { type: 'discard', cardId: id });
        if (res.ok) return res.event;
      }
    } catch { /* zadnja linija obrane — preskoči */ }
    return null;
  }

  // ---- pogledi za klijente ---------------------------------------------

  lobbyView() {
    return {
      code: this.code,
      phase: this.phase,
      numPlayers: this.numPlayers,
      target: this.target,
      hostId: this.hostId,
      seats: this.seats.map((s) => ({
        type: s.type, difficulty: s.difficulty, name: s.name, connected: s.connected,
      })),
      members: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, seat: m.seat })),
    };
  }

  viewForMember(id) {
    if (!this.game) return null;
    const seat = this.seatOfMember(id);
    return serializeGameForSeat(this.game, seat == null ? -1 : seat);
  }

  eventView() {
    return redactEvent(this.lastEvent);
  }
}

// Jedinstvena primjena poteza — isti oblik akcije koriste i klijent i bot.
export function applyAction(game, seat, a) {
  switch (a.type) {
    case 'drawStock': return drawFromStock(game, seat);
    case 'takePile': return takeFromDiscard(game, seat, a.index);
    case 'undoTake': return undoTake(game, seat);
    case 'meldNew': return meldNew(game, seat, a.cardIds, a.jokerMap || {});
    case 'meldAdd': return meldAdd(game, seat, a.meldId, a.cardIds, a.jokerMap || {});
    case 'redeemJoker': return redeemJoker(game, seat, a.args);
    case 'discard': return discard(game, seat, a.cardId);
    case 'close': return closeRound(game, seat, a.cardId);
    default: throw new GameError(`Nepoznata akcija: ${a.type}`);
  }
}
