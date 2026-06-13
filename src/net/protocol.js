// Mrežni protokol za online Binakulu — dijeli ga klijent i server.
//
// Ključno pravilo poštene igre: server drži cjelovito stanje, ali svakom
// igraču šalje "redigirani" pogled u kojem su TUĐE karte skrivene (vidi se
// samo broj karata), a vlastite su prave. Tako ni gledanjem mrežnog prometa
// protivnik ne može vidjeti tuđu ruku.

export const MSG = {
  // klijent → server
  JOIN: 'join',            // { name }
  SET_CONFIG: 'setConfig', // { numPlayers, seats, target }  (samo host)
  START: 'start',          // {}                              (samo host)
  ACTION: 'action',        // { action }  potez u igri
  NEXT_ROUND: 'nextRound', // {}                              (samo host)
  CHAT: 'chat',            // { text }
  // server → klijent
  WELCOME: 'welcome',      // { you, roomCode }
  LOBBY: 'lobby',          // { lobby }
  STATE: 'state',          // { view, seat }   redigirani pogled za tog igrača
  EVENT: 'event',          // { event }        za animacije (binakula, kup…)
  ERROR: 'error',          // { message }
  CHAT_MSG: 'chatMsg',     // { from, text }
};

// Skriveni "placeholder" identifikatori — drže točan broj karata bez otkrivanja.
const hiddenId = (seat, i) => `__hidden_${seat}_${i}`;
const stockId = (i) => `__stock_${i}`;
export const isHiddenId = (id) => typeof id === 'string' && id.startsWith('__');

// Redigirani pogled na partiju za jednog igrača (seat = njegovo sjedalo).
// Vraća JSON-siguran objekt iste strukture kakvu UI očekuje od `g`.
export function serializeGameForSeat(game, seat) {
  const v = {
    config: game.config,
    nPlayers: game.nPlayers,
    nSides: game.nSides,
    cardsById: game.cardsById,  // koje karte POSTOJE nije tajna (2 špila + 4 jokera)
    dealer: game.dealer,
    firstDealer: game.firstDealer,
    direction: game.direction,
    roundNo: game.roundNo,
    scores: game.scores,
    totals: game.totals,
    gameOver: game.gameOver,
    winnerSide: game.winnerSide,
    round: null,
    youSeat: seat,
  };
  const r = game.round;
  if (r) {
    v.round = {
      // špil i tuđe ruke: točan broj karata, ali skriveni identiteti
      stock: r.stock.map((_, i) => stockId(i)),
      discard: [...r.discard], // otvoreni kup je javan
      hands: r.hands.map((h, s) =>
        s === seat ? [...h] : h.map((_, i) => hiddenId(s, i))),
      melds: r.melds.map((m) => ({ ...m, cardIds: [...m.cardIds], jokerMap: { ...m.jokerMap } })),
      nextMeldId: r.nextMeldId,
      turn: r.turn,
      turnCount: r.turnCount,
      phase: r.phase,
      // "pending" karte tiču se samo igrača na potezu
      pendingPileCardId: r.turn === seat ? r.pendingPileCardId : null,
      pendingJokers: (r.pendingJokers || []).filter((id) => r.hands[seat].includes(id)),
      takeSnapshot: r.turn === seat ? r.takeSnapshot : null,
      closed: r.closed,
      closerSeat: r.closerSeat,
      result: r.result,
      // publicKnown je samo za logiku bota na serveru — ne šalje se klijentu
      publicKnown: Array.from({ length: game.nPlayers }, () => []),
    };
  }
  return v;
}

// Događaji za animacije sadrže samo javne podatke (uzete karte iz kupa svi su
// vidjeli, kombinacije su na stolu) pa se mogu poslati svima takvi kakvi jesu.
export function redactEvent(event) {
  if (!event) return null;
  const e = { type: event.type };
  if ('binakula' in event) e.binakula = event.binakula;
  if (event.type === 'take') { e.seat = event.seat; e.takenIds = event.takenIds; }
  if (event.type === 'discard') { e.cardId = event.cardId; e.nextTurn = event.nextTurn; }
  if (event.type === 'close') { e.cardId = event.cardId; e.result = event.result; }
  if (event.type === 'meldNew' || event.type === 'meldAdd' || event.type === 'redeemJoker') {
    e.meldId = event.meld?.id;
  }
  return e;
}
