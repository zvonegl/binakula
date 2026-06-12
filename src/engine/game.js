// Game engine za Binakulu — čista logika, bez DOM-a.
//
// Stanje (state) je običan objekt; akcije ga mutiraju i vraćaju opis događaja
// za UI. Ilegalni potezi bacaju GameError s porukom na hrvatskom — UI je hvata
// i prikazuje. Sve vrijednosti bodova su u desetinkama (tradicionalna ×10).

import { createDeck, cardValue } from './cards.js';
import { mulberry32, shuffle } from './rng.js';
import { validateMeld, meldScore, effectiveCard, runArcPositions } from './combos.js';
import { findMeldPlanForCard } from './plans.js';

export class GameError extends Error {}

const DEFAULT_TARGETS = { 2: 1500, 3: 2000, 4: 3000 };

// ---------------------------------------------------------------------------
// Stvaranje partije i kruga
// ---------------------------------------------------------------------------

export function createGame(config) {
  const players = config.players;
  const n = players.length;
  if (![2, 3, 4].includes(n)) throw new GameError('Igra je za 2, 3 ili 4 igrača.');
  const deck = createDeck();
  const cardsById = {};
  for (const c of deck) cardsById[c.id] = c;
  const nSides = n === 4 ? 2 : n;
  const seed = config.seed ?? ((Math.random() * 2 ** 31) | 0);
  return {
    config: {
      players,
      target: config.target ?? DEFAULT_TARGETS[n],
      seed,
    },
    nPlayers: n,
    nSides,
    cardsById,
    rng: mulberry32(seed),
    dealer: null,       // bira se nasumično u prvom krugu
    firstDealer: null,
    direction: -1,      // -1 = udesno (od djelitelja), +1 = ulijevo
    roundNo: 0,
    round: null,
    scores: [],            // po krugu: { perSide: [..], closerSeat }
    totals: new Array(nSides).fill(0),
    gameOver: false,
    winnerSide: null,
  };
}

export function sideOfSeat(state, seat) {
  return state.nPlayers === 4 ? seat % 2 : seat;
}

export function seatsOfSide(state, side) {
  const seats = [];
  for (let s = 0; s < state.nPlayers; s++) if (sideOfSeat(state, s) === side) seats.push(s);
  return seats;
}

export function startRound(state) {
  if (state.gameOver) throw new GameError('Partija je završena.');
  state.roundNo += 1;
  const n = state.nPlayers;

  // Djelitelj: u 1. krugu nasumičan; dalje se dijeljenje seli u smjeru igre.
  // Počinje se dijeliti sa djeliteljeve DESNE strane; kad dijeljenje obiđe
  // pun krug i vrati se na prvog djelitelja, smjer se mijenja (ulijevo).
  if (state.roundNo === 1) {
    state.firstDealer = Math.floor(state.rng() * n);
    state.dealer = state.firstDealer;
    state.direction = -1;
  } else {
    state.dealer = (state.dealer + state.direction + n) % n;
    if (state.dealer === state.firstDealer) state.direction = -state.direction;
  }

  const ids = Object.keys(state.cardsById);
  shuffle(ids, state.rng);

  const hands = Array.from({ length: n }, () => []);
  // Dijeli se jedna po jedna, počevši od igrača do djelitelja u smjeru igre.
  let deal = 0;
  for (let k = 0; k < 19 * n; k++) {
    const seat = (state.dealer + state.direction * (1 + (k % n)) + 4 * n) % n;
    hands[seat].push(ids[deal++]);
  }
  const upcard = ids[deal++];
  const stock = ids.slice(deal); // vrh špila = kraj polja

  state.round = {
    stock,
    discard: [upcard],            // indeks 0 = dno kupa, zadnji = vrh
    hands,
    melds: [],                    // { id, side, cardIds, jokerMap, type }
    nextMeldId: 1,
    turn: (state.dealer + state.direction + n) % n,
    turnCount: 0,
    phase: 'draw',                // 'draw' → 'meld' (izlaganje + odbacivanje)
    pendingPileCardId: null,      // najdonja uzeta karta koju treba izložiti
    pendingJokers: [],            // otkupljeni jokeri koji se moraju izložiti do kraja poteza
    takeSnapshot: null,           // za "poništi uzimanje"
    publicKnown: Array.from({ length: state.nPlayers }, () => new Set()),
    closed: false,
    closerSeat: null,
    result: null,
  };
  return state.round;
}

// ---------------------------------------------------------------------------
// Pomoćne provjere
// ---------------------------------------------------------------------------

function assertTurn(state, seat, phase) {
  const r = state.round;
  if (!r || r.closed) throw new GameError('Krug nije u tijeku.');
  if (r.turn !== seat) throw new GameError('Nisi na potezu.');
  if (phase && r.phase !== phase) {
    if (phase === 'draw') throw new GameError('Već si povukao kartu u ovom potezu.');
    throw new GameError('Najprije moraš povući kartu (sa špila ili iz kupa).');
  }
}

function cardsOf(state, ids) {
  return ids.map((id) => {
    const c = state.cardsById[id];
    if (!c) throw new GameError(`Nepoznata karta: ${id}`);
    return c;
  });
}

function removeFromHand(state, seat, ids) {
  const hand = state.round.hands[seat];
  for (const id of ids) {
    const i = hand.indexOf(id);
    if (i === -1) throw new GameError('Ta karta nije u tvojoj ruci.');
    hand.splice(i, 1);
    state.round.publicKnown[seat].delete(id);
  }
}

function clearPendingIfMelded(state, ids) {
  const r = state.round;
  if (r.pendingPileCardId && ids.includes(r.pendingPileCardId)) {
    r.pendingPileCardId = null;
    r.takeSnapshot = null;
  }
}

export function getMeld(state, meldId) {
  const m = state.round.melds.find((x) => x.id === meldId);
  if (!m) throw new GameError('Ta kombinacija ne postoji.');
  return m;
}

// ---------------------------------------------------------------------------
// Faza 1: vučenje
// ---------------------------------------------------------------------------

export function drawFromStock(state, seat) {
  assertTurn(state, seat, 'draw');
  const r = state.round;
  if (r.stock.length === 0) reshuffleStock(state);
  if (r.stock.length === 0) throw new GameError('Nema karata za vučenje.');
  const id = r.stock.pop();
  r.hands[seat].push(id);
  r.phase = 'meld';
  return { type: 'draw', cardId: id };
}

// Kad se zatvoreni špil potroši: promiješaj otvoreni kup (osim gornje karte)
// i napravi novi zatvoreni špil.
function reshuffleStock(state) {
  const r = state.round;
  if (r.discard.length <= 1) return;
  const top = r.discard[r.discard.length - 1];
  const rest = r.discard.slice(0, -1);
  shuffle(rest, state.rng);
  r.stock = rest;
  r.discard = [top];
}

// Može li se kup uzeti od indeksa `index`? Vraća plan izlaganja najdonje
// karte (ili null). Plan je { kind:'extend'|'new', ... } — koristi ga bot,
// a UI samo kao indikaciju da je potez legalan.
export function canTakeAt(state, seat, index) {
  const r = state.round;
  if (!r || r.closed || r.turn !== seat || r.phase !== 'draw') return null;
  if (index < 0 || index >= r.discard.length) return null;
  const bottom = state.cardsById[r.discard[index]];
  const taken = r.discard.slice(index + 1);
  const pool = cardsOf(state, [...r.hands[seat], ...taken]);
  const side = sideOfSeat(state, seat);
  const sideMelds = r.melds.filter((m) => m.side === side);
  const plan = findMeldPlanForCard(bottom, pool, sideMelds, state.cardsById);
  if (!plan) return null;
  // Nakon izlaganja u ruci mora ostati barem 1 karta (za odbacivanje/zatvaranje).
  const used = plan.kind === 'new' ? plan.cardIds.length : 1;
  const handAfter = r.hands[seat].length + taken.length + 1 - used;
  if (handAfter < 1) return null;
  return plan;
}

export function takeFromDiscard(state, seat, index) {
  assertTurn(state, seat, 'draw');
  const r = state.round;
  if (index < 0 || index >= r.discard.length) throw new GameError('Nevaljan odabir u kupu.');
  const plan = canTakeAt(state, seat, index);
  if (!plan) {
    throw new GameError('Najdonju uzetu kartu moraš odmah izložiti u valjanoj kombinaciji — ovdje to nije moguće.');
  }
  // Snimka za "poništi uzimanje" (sve uzete karte ionako su bile javne).
  r.takeSnapshot = snapshotRound(r);
  const takenIds = r.discard.splice(index);
  r.hands[seat].push(...takenIds);
  for (const id of takenIds) r.publicKnown[seat].add(id);
  r.pendingPileCardId = takenIds[0];
  r.phase = 'meld';
  return { type: 'take', takenIds, plan };
}

function snapshotRound(r) {
  return JSON.parse(JSON.stringify({ ...r, takeSnapshot: null, publicKnown: r.publicKnown.map((s) => [...s]) }));
}

export function undoTake(state, seat) {
  const r = state.round;
  if (r.turn !== seat || !r.takeSnapshot) throw new GameError('Nema se što poništiti.');
  const snap = r.takeSnapshot;
  snap.publicKnown = snap.publicKnown.map((arr) => new Set(arr));
  state.round = snap;
  return { type: 'undoTake' };
}

// ---------------------------------------------------------------------------
// Faza 2: izlaganje
// ---------------------------------------------------------------------------

export function meldNew(state, seat, cardIds, jokerMap = {}) {
  assertTurn(state, seat, 'meld');
  const r = state.round;
  const cards = cardsOf(state, cardIds);
  const v = validateMeld(cards, jokerMap);
  if (!v.valid) throw new GameError(v.reason);
  if (r.hands[seat].length - cardIds.length < 1) {
    throw new GameError('U ruci ti mora ostati barem jedna karta (za odbacivanje ili zatvaranje).');
  }
  removeFromHand(state, seat, cardIds);
  const cleanMap = {};
  for (const c of cards) if (c.joker) cleanMap[c.id] = jokerMap[c.id];
  const meld = {
    id: r.nextMeldId++,
    side: sideOfSeat(state, seat),
    seat, // tko ju je izložio — kombinacija stoji ispred tog igrača
    cardIds: [...cardIds],
    jokerMap: cleanMap,
    type: v.type,
  };
  sortMeldCards(state, meld);
  r.melds.push(meld);
  clearPendingIfMelded(state, cardIds);
  r.pendingJokers = r.pendingJokers.filter((id) => !cardIds.includes(id));
  return { type: 'meldNew', meld, binakula: v.type === 'binakula' };
}

// Dodavanje karata na izloženu kombinaciju — svoju, a u igri 2 na 2 i
// partnerovu. Na protivničke kombinacije se ne dodaje.
export function meldAdd(state, seat, meldId, cardIds, jokerMapAdd = {}) {
  assertTurn(state, seat, 'meld');
  const r = state.round;
  const meld = getMeld(state, meldId);
  if (meld.side !== sideOfSeat(state, seat)) {
    throw new GameError('Na protivničke kombinacije ne smiješ dodavati karte.');
  }
  if (cardIds.length === 0) throw new GameError('Odaberi karte za dodavanje.');
  const allIds = [...meld.cardIds, ...cardIds];
  const mergedMap = { ...meld.jokerMap, ...jokerMapAdd };
  const v = validateMeld(cardsOf(state, allIds), mergedMap);
  if (!v.valid) throw new GameError(v.reason);
  if (r.hands[seat].length - cardIds.length < 1) {
    throw new GameError('U ruci ti mora ostati barem jedna karta (za odbacivanje ili zatvaranje).');
  }
  removeFromHand(state, seat, cardIds);
  const wasBinakula = meld.type === 'binakula';
  meld.cardIds = allIds;
  meld.jokerMap = mergedMap;
  meld.type = v.type;
  sortMeldCards(state, meld);
  clearPendingIfMelded(state, cardIds);
  r.pendingJokers = r.pendingJokers.filter((id) => !cardIds.includes(id));
  return { type: 'meldAdd', meld, binakula: v.type === 'binakula' && !wasBinakula };
}

// Drži karte kombinacije uvijek pravilno posloženima: niz po efektivnom rangu
// (joker stoji na mjestu karte koju predstavlja), tris po boji.
const SET_SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };

function sortMeldCards(state, meld) {
  const effs = meld.cardIds.map((id) => ({
    id,
    e: effectiveCard(state.cardsById[id], meld.jokerMap),
  }));
  if (meld.type === 'set') {
    effs.sort((a, b) => SET_SUIT_ORDER[a.e.suit] - SET_SUIT_ORDER[b.e.suit]);
    meld.cardIds = effs.map((x) => x.id);
    return;
  }
  // Binakula: jedan as ide na početak, drugi na kraj.
  if (meld.type === 'binakula') {
    const aces = effs.filter((x) => x.e.rank === 1);
    const rest = effs.filter((x) => x.e.rank !== 1).sort((a, b) => a.e.rank - b.e.rank);
    meld.cardIds = [aces[0].id, ...rest.map((x) => x.id), aces[1].id];
    return;
  }
  // Niz: ciklički redoslijed od početka luka (npr. Q,K,A,2,3).
  const pos = runArcPositions(effs.map((x) => x.e.rank));
  effs.sort((a, b) => pos.get(a.e.rank) - pos.get(b.e.rank));
  meld.cardIds = effs.map((x) => x.id);
}

// ---------------------------------------------------------------------------
// Otkup jokera
// ---------------------------------------------------------------------------
//
// Bilo koji igrač (vlasnik, partner ili protivnik) koji ima kartu koju joker
// predstavlja može je na svom potezu položiti na mjesto jokera i uzeti joker
// U RUKU — slobodno ga kombinira gdje god želi, ali ga MORA izložiti do kraja
// istog poteza (odbacivanje/zatvaranje je blokirano dok je joker u ruci).

// Provjera (i plan) otkupa: igrač ima zamjensku kartu I joker se nakon otkupa
// ima kamo izložiti. Koriste je engine (validacija), bot i UI (isticanje).
export function canRedeemJoker(state, seat, meldId, jokerId) {
  const r = state.round;
  if (!r || r.closed) return null;
  const meld = r.melds.find((m) => m.id === meldId);
  if (!meld) return null;
  const as = meld.jokerMap[jokerId];
  if (!as) return null;
  const replId = r.hands[seat].find((id) => {
    const c = state.cardsById[id];
    return !c.joker && c.rank === as.rank && c.suit === as.suit;
  });
  if (!replId) return null;
  const side = sideOfSeat(state, seat);
  const joker = state.cardsById[jokerId];
  const pool = r.hands[seat]
    .filter((id) => id !== replId && id !== jokerId)
    .map((id) => state.cardsById[id]);
  // Stanje kombinacija NAKON otkupa: zamjenska karta sjeda na mjesto jokera.
  const sideMelds = r.melds.filter((m) => m.side === side).map((m) => {
    if (m.id !== meld.id) return m;
    const jm = { ...m.jokerMap };
    delete jm[jokerId];
    return { ...m, cardIds: m.cardIds.map((id) => (id === jokerId ? replId : id)), jokerMap: jm };
  });
  const plan = findMeldPlanForCard(joker, pool, sideMelds, state.cardsById);
  if (!plan) return null;
  return { replacementCardId: replId, plan };
}

export function redeemJoker(state, seat, { meldId, jokerId, replacementCardId }) {
  assertTurn(state, seat, 'meld');
  const r = state.round;
  const meld = getMeld(state, meldId);
  if (!meld.cardIds.includes(jokerId)) throw new GameError('Taj joker nije u toj kombinaciji.');
  const joker = state.cardsById[jokerId];
  if (!joker.joker) throw new GameError('Odabrana karta nije joker.');
  const as = meld.jokerMap[jokerId];
  const repl = state.cardsById[replacementCardId];
  if (!r.hands[seat].includes(replacementCardId)) throw new GameError('Zamjenska karta nije u tvojoj ruci.');
  if (repl.joker || repl.rank !== as.rank || repl.suit !== as.suit) {
    throw new GameError('Zamjenska karta mora biti točno karta koju joker predstavlja.');
  }
  if (!canRedeemJoker(state, seat, meldId, jokerId)) {
    throw new GameError('Joker nemaš kamo izložiti — otkup trenutno nije moguć.');
  }

  // Zamjenska karta na mjesto jokera, joker u ruku.
  removeFromHand(state, seat, [replacementCardId]);
  const idx = meld.cardIds.indexOf(jokerId);
  meld.cardIds[idx] = replacementCardId;
  delete meld.jokerMap[jokerId];
  sortMeldCards(state, meld);
  r.hands[seat].push(jokerId);
  r.publicKnown[seat].add(jokerId); // svi su vidjeli tko je uzeo jokera
  r.pendingJokers.push(jokerId);    // mora se izložiti do kraja poteza
  clearPendingIfMelded(state, [replacementCardId]);
  return { type: 'redeemJoker', meld, jokerId };
}

// ---------------------------------------------------------------------------
// Faza 3: odbacivanje / zatvaranje
// ---------------------------------------------------------------------------

export function discard(state, seat, cardId) {
  assertTurn(state, seat, 'meld');
  const r = state.round;
  if (r.pendingPileCardId) {
    throw new GameError('Najprije izloži najdonju kartu uzetu iz kupa (ili poništi uzimanje).');
  }
  if (r.pendingJokers.length > 0) {
    throw new GameError('Otkupljeni joker moraš izložiti prije kraja poteza.');
  }
  if (!r.hands[seat].includes(cardId)) throw new GameError('Ta karta nije u tvojoj ruci.');
  if (r.hands[seat].length === 1) {
    throw new GameError('Sa zadnjom kartom zatvaraš krug — stavlja se na zatvoreni špil.');
  }
  removeFromHand(state, seat, [cardId]);
  r.discard.push(cardId);
  r.takeSnapshot = null;
  r.turn = (seat + state.direction + state.nPlayers) % state.nPlayers;
  r.turnCount += 1;
  r.phase = 'draw';
  return { type: 'discard', cardId, nextTurn: r.turn };
}

// Igrač zatvara krug: sve osim jedne karte je izložio, a zadnju kartu
// stavlja licem prema dolje na vrh ZATVORENOG špila (ne na otvoreni kup).
export function closeRound(state, seat, cardId) {
  assertTurn(state, seat, 'meld');
  const r = state.round;
  if (r.pendingPileCardId) {
    throw new GameError('Najprije izloži najdonju kartu uzetu iz kupa.');
  }
  if (r.pendingJokers.length > 0) {
    throw new GameError('Otkupljeni joker moraš izložiti prije kraja poteza.');
  }
  if (r.hands[seat].length !== 1 || r.hands[seat][0] !== cardId) {
    throw new GameError('Krug zatvaraš tek kad ti u ruci ostane točno jedna karta.');
  }
  removeFromHand(state, seat, [cardId]);
  r.stock.push(cardId);
  r.closed = true;
  r.closerSeat = seat;
  r.takeSnapshot = null;
  const result = scoreRound(state);
  return { type: 'close', cardId, result };
}

// ---------------------------------------------------------------------------
// Bodovanje kruga
// ---------------------------------------------------------------------------

export function scoreRound(state) {
  const r = state.round;
  const n = state.nSides;
  const meldPts = new Array(n).fill(0);
  const handPts = new Array(n).fill(0);
  const meldDetails = [];
  for (const m of r.melds) {
    const sc = meldScore(cardsOf(state, m.cardIds), m.jokerMap, m.type);
    meldPts[m.side] += sc.total;
    meldDetails.push({ meldId: m.id, side: m.side, ...sc });
  }
  const handDetails = [];
  for (let seat = 0; seat < state.nPlayers; seat++) {
    const v = r.hands[seat].reduce((s, id) => s + cardValue(state.cardsById[id]), 0);
    handPts[sideOfSeat(state, seat)] += v;
    handDetails.push({ seat, value: v, cardIds: [...r.hands[seat]] });
  }
  const perSide = [];
  const closerSide = sideOfSeat(state, r.closerSeat);
  for (let side = 0; side < n; side++) {
    let pts = meldPts[side] - handPts[side];
    if (side === closerSide) pts += 100; // bonus za izlazak: 10 bodova
    perSide.push(pts);
  }
  const result = {
    perSide, meldPts, handPts, closerSeat: r.closerSeat, closerSide,
    bonus: 100, meldDetails, handDetails,
  };
  r.result = result;
  state.scores.push(result);
  for (let side = 0; side < n; side++) state.totals[side] += perSide[side];

  // Kraj partije: netko je dosegao ciljni broj bodova.
  let best = null;
  for (let side = 0; side < n; side++) {
    if (state.totals[side] >= state.config.target) {
      if (best === null || state.totals[side] > state.totals[best]) best = side;
      else if (state.totals[side] === state.totals[best] && side === closerSide) best = side;
    }
  }
  if (best !== null) {
    state.gameOver = true;
    state.winnerSide = best;
  }
  return result;
}
