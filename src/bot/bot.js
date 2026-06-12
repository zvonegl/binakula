// Bot za Binakulu. Stateless: nextBotAction(state, seat, difficulty) vraća
// JEDNU sljedeću akciju; UI je izvrši pa ponovno pita (radi animacija).
//
// Heuristike:
//  - prati viđene karte (vlastita ruka, stol, kup, javno uzete karte) i po
//    tome procjenjuje rizik odbacivanja i sigurnost deklaracije jokera,
//  - procjenjuje isplati li se uzeti kup i dokle (dobitak vs. balast),
//  - izbjegava odbaciti kartu koja protivniku očito igra,
//  - povremeno blefira: odbaci kartu čiju kopiju drži u ruci,
//  - otkupljuje jokere kad ima zamjensku kartu,
//  - "teško" drži jaku ruku za zatvaranje, a slabu izlaže rano da smanji minus.

import { SUITS, cardValue } from '../engine/cards.js';
import { validateMeld, meldScore } from '../engine/combos.js';
import { solveJokerAssignments, findMeldPlanForCard } from '../engine/plans.js';
import { sideOfSeat, canTakeAt, canRedeemJoker } from '../engine/game.js';

const DIFF = {
  easy:   { scanPile: 1,   takeThreshold: 1,  care: 0.2, bluff: 0,    redeem: 0.5, hold: false },
  medium: { scanPile: 12,  takeThreshold: 12, care: 1,   bluff: 0.05, redeem: 1,   hold: false },
  hard:   { scanPile: 999, takeThreshold: 6,  care: 1.4, bluff: 0.12, redeem: 1,   hold: true },
};

export function nextBotAction(state, seat, difficulty = 'medium', rand = Math.random) {
  const cfg = DIFF[difficulty] || DIFF.medium;
  const r = state.round;
  if (!r || r.closed || r.turn !== seat) return null;
  if (r.phase === 'draw') return decideDraw(state, seat, cfg);
  return decideMeldPhase(state, seat, cfg, rand);
}

// ---------------------------------------------------------------------------
// Vučenje: špil ili kup (i dokle)
// ---------------------------------------------------------------------------

function decideDraw(state, seat, cfg) {
  const r = state.round;
  const hand = cards(state, r.hands[seat]);
  const baseValue = decompose(hand).meldedValue;
  const pressure = minOpponentHandSize(state, seat) <= 6 ? 2 : 1;

  let best = null;
  const from = Math.max(0, r.discard.length - cfg.scanPile);
  for (let i = r.discard.length - 1; i >= from; i--) {
    const plan = canTakeAt(state, seat, i);
    if (!plan) continue;
    const takenIds = r.discard.slice(i);
    const taken = cards(state, takenIds);
    const after = decompose([...hand, ...taken]);
    const gain = after.meldedValue - baseValue
      + taken.filter((c) => c.joker).length * 20;
    const cost = (takenIds.length - 1) * 6 * pressure;
    const score = gain - cost;
    if (score >= cfg.takeThreshold && (!best || score > best.score)) {
      best = { index: i, score };
    }
  }
  if (best) return { type: 'takePile', index: best.index };
  return { type: 'drawStock' };
}

// ---------------------------------------------------------------------------
// Izlaganje, otkup jokera, odbacivanje / zatvaranje
// ---------------------------------------------------------------------------

function decideMeldPhase(state, seat, cfg, rand) {
  const r = state.round;
  const mySide = sideOfSeat(state, seat);
  const handIds = r.hands[seat];
  const hand = cards(state, handIds);
  const sideMelds = r.melds.filter((m) => m.side === mySide);

  // Zadnja karta u ruci → zatvaranje kruga.
  if (handIds.length === 1) return { type: 'close', cardId: handIds[0] };

  // 1) Obvezno: izloži najdonju kartu uzetu iz kupa.
  if (r.pendingPileCardId) {
    const bottom = state.cardsById[r.pendingPileCardId];
    const pool = hand.filter((c) => c.id !== bottom.id);
    const plan = findMeldPlanForCard(bottom, pool, sideMelds, state.cardsById);
    if (plan) return planToAction(plan, bottom);
  }

  // 1b) Obvezno: izloži otkupljenog jokera (mora na stol do kraja poteza).
  const pendingJoker = (r.pendingJokers || []).find((id) => handIds.includes(id));
  if (pendingJoker) {
    const joker = state.cardsById[pendingJoker];
    const pool = hand.filter((c) => c.id !== pendingJoker);
    const plan = findMeldPlanForCard(joker, pool, sideMelds, state.cardsById);
    if (plan) return planToAction(plan, joker);
  }

  // 2) Otkup jokera kad imamo zamjensku kartu i mjesto za joker.
  if (rand() < cfg.redeem) {
    const redeem = findJokerRedemption(state, seat);
    if (redeem) return redeem;
  }

  const decomp = decompose(hand);
  const extension = findExtension(state, hand, sideMelds);
  const leftoverAfterAll = countLeftover(hand, decomp, state, sideMelds);

  // Možemo li zatvoriti (sve osim jedne karte izložiti)?
  const canClose = leftoverAfterAll <= 1;
  const weakHand = decomp.deadwoodValue >= 60 && r.turnCount > state.nPlayers * 4;
  const shouldMeld = !cfg.hold || canClose || weakHand
    || minOpponentHandSize(state, seat) <= 7
    || decomp.meldedValue >= 120;

  if (shouldMeld) {
    if (decomp.melds.length > 0) {
      const m = decomp.melds[0];
      let ids = m.cardIds;
      if (handIds.length - ids.length < 1) {
        // Ne smijemo ostati bez karata: skratimo niz s kraja ili preskočimo.
        const trimmed = trimMeld(state, m);
        if (trimmed) ids = trimmed;
        else return discardAction(state, seat, cfg, decomp, rand);
      }
      const jokerMap = finalizeJokerMap(state, seat, ids, m.jokerMap);
      return { type: 'meldNew', cardIds: ids, jokerMap };
    }
    if (extension) {
      if (handIds.length - extension.cardIds.length < 1) {
        return discardAction(state, seat, cfg, decomp, rand);
      }
      return extension;
    }
  }
  return discardAction(state, seat, cfg, decomp, rand);
}

function planToAction(plan, bottom) {
  if (plan.kind === 'extend') {
    return {
      type: 'meldAdd', meldId: plan.meldId, cardIds: [bottom.id],
      jokerMap: plan.jokerAs ? { [bottom.id]: plan.jokerAs } : {},
    };
  }
  return { type: 'meldNew', cardIds: plan.cardIds, jokerMap: plan.jokerMap };
}

// Skrati niz za jednu kartu s kraja (ostaje valjan ako ima ≥4 karte).
function trimMeld(state, m) {
  if (m.cardIds.length < 4) return null;
  for (const dropIdx of [m.cardIds.length - 1, 0]) {
    const ids = m.cardIds.filter((_, i) => i !== dropIdx);
    if (ids.some((id) => state.cardsById[id].joker && !m.jokerMap[id])) continue;
    if (validateMeld(ids.map((id) => state.cardsById[id]), m.jokerMap).valid) return ids;
  }
  return null;
}

// Koliko karata ostaje u ruci nakon svih izlaganja (kombinacije + dodavanja)?
function countLeftover(hand, decomp, state, sideMelds) {
  let leftover = decomp.deadwood.length;
  const tableMelds = sideMelds.map((m) => ({
    cards: m.cardIds.map((id) => state.cardsById[id]),
    jokerMap: m.jokerMap,
  }));
  let changed = true;
  let pool = [...decomp.deadwood];
  while (changed) {
    changed = false;
    for (const c of pool) {
      for (const tm of tableMelds) {
        if (validateMeld([...tm.cards, c], tm.jokerMap).valid) {
          tm.cards.push(c);
          pool = pool.filter((x) => x.id !== c.id);
          leftover -= 1;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return leftover;
}

function findExtension(state, hand, sideMelds) {
  for (const m of sideMelds) {
    const meldCards = m.cardIds.map((id) => state.cardsById[id]);
    for (const c of hand) {
      if (c.joker) continue; // jokere iz ruke ne lijepimo bezglavo na stol
      if (validateMeld([...meldCards, c], m.jokerMap).valid) {
        return { type: 'meldAdd', meldId: m.id, cardIds: [c.id], jokerMap: {} };
      }
    }
  }
  return null;
}

// Otkup s bilo čije kombinacije (svoje, partnerove ili protivničke) —
// engine provjerava i da se joker nakon otkupa ima kamo izložiti.
function findJokerRedemption(state, seat) {
  for (const m of state.round.melds) {
    for (const jokerId of Object.keys(m.jokerMap)) {
      const ok = canRedeemJoker(state, seat, m.id, jokerId);
      if (ok) {
        return {
          type: 'redeemJoker',
          args: { meldId: m.id, jokerId, replacementCardId: ok.replacementCardId },
        };
      }
    }
  }
  return null;
}

// Taktika jokera: deklariraj kartu čije smo obje kopije već vidjeli —
// protivnik je tada sigurno nema i ne može otkupiti joker.
function finalizeJokerMap(state, seat, cardIds, jokerMap) {
  const out = {};
  for (const [jid, as] of Object.entries(jokerMap)) {
    if (!cardIds.includes(jid)) continue;
    out[jid] = as;
    const meldCards = cardIds.map((id) => state.cardsById[id]);
    const v0 = validateMeld(meldCards, { ...jokerMap });
    if (v0.valid && v0.type === 'set') {
      let bestSuit = as.suit;
      let bestSeen = -1;
      for (const s of SUITS) {
        const candidate = { ...jokerMap, [jid]: { rank: as.rank, suit: s } };
        if (!validateMeld(meldCards, candidate).valid) continue;
        const seen = seenCopies(state, seat, as.rank, s);
        if (seen > bestSeen) { bestSeen = seen; bestSuit = s; }
      }
      out[jid] = { rank: as.rank, suit: bestSuit };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Odbacivanje
// ---------------------------------------------------------------------------

function discardAction(state, seat, cfg, decomp, rand) {
  const r = state.round;
  const hand = cards(state, r.hands[seat]);
  const keep = new Set(decomp.melds.flatMap((m) => m.cardIds));
  let candidates = hand.filter((c) => !keep.has(c.id) && !c.joker);
  if (candidates.length === 0) candidates = hand.filter((c) => !c.joker);
  if (candidates.length === 0) candidates = hand;

  // Blef: rano u krugu odbaci kartu čiju kopiju držimo — protivnika navodi
  // da misli kako nam te karte ne trebaju, a mi ne gubimo ništa.
  if (cfg.bluff > 0 && r.turnCount < state.nPlayers * 3 && rand() < cfg.bluff) {
    const dup = candidates.find((c) =>
      hand.some((o) => o.id !== c.id && !o.joker && o.rank === c.rank && o.suit === c.suit));
    if (dup) return { type: 'discard', cardId: dup.id };
  }

  let best = null;
  for (const c of candidates) {
    const score = dangerOf(state, seat, c) * cfg.care
      + potentialOf(hand, c) * 0.8
      - cardValue(c) * 0.4; // visoke beskorisne karte radije van (manji minus)
    if (!best || score < best.score) best = { card: c, score };
  }
  return { type: 'discard', cardId: best.card.id };
}

// Koliko karta igra protivniku?
function dangerOf(state, seat, card) {
  const r = state.round;
  const mySide = sideOfSeat(state, seat);
  let d = 0;
  for (const m of r.melds) {
    if (m.side === mySide) continue;
    const meldCards = m.cardIds.map((id) => state.cardsById[id]);
    if (validateMeld([...meldCards, card], m.jokerMap).valid) d += 40;
  }
  for (let s = 0; s < state.nPlayers; s++) {
    if (s === seat || sideOfSeat(state, s) === mySide) continue;
    for (const id of r.publicKnown[s]) {
      const k = state.cardsById[id];
      if (k.joker) continue;
      if (k.rank === card.rank) d += 12;
      if (k.suit === card.suit && Math.abs(k.rank - card.rank) <= 2) d += 10;
    }
  }
  return d;
}

// Koliko karta vrijedi nama (blizu je vlastite kombinacije)?
function potentialOf(hand, card) {
  let p = 0;
  for (const o of hand) {
    if (o.id === card.id || o.joker || card.joker) continue;
    if (o.rank === card.rank) p += 12;
    if (o.suit === card.suit) {
      const d = Math.abs(o.rank - card.rank);
      if (d === 1) p += 10;
      else if (d === 2) p += 5;
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// Rastav ruke na kombinacije (pohlepno)
// ---------------------------------------------------------------------------

export function decompose(handCards) {
  let remaining = [...handCards];
  const melds = [];
  let meldedValue = 0;
  for (;;) {
    const cand = bestCandidate(remaining);
    if (!cand) break;
    melds.push(cand);
    meldedValue += cand.value;
    const used = new Set(cand.cardIds);
    remaining = remaining.filter((c) => !used.has(c.id));
  }
  const deadwoodValue = remaining.reduce((s, c) => s + cardValue(c), 0);
  return { melds, deadwood: remaining, meldedValue, deadwoodValue };
}

function bestCandidate(cardsLeft) {
  const reals = cardsLeft.filter((c) => !c.joker);
  const jokers = cardsLeft.filter((c) => c.joker);
  const out = [];

  // Trisevi: po jedna karta od svake boje (najviše 4, bez duplikata boje).
  const byRank = {};
  for (const c of reals) (byRank[c.rank] ??= []).push(c);
  for (const group of Object.values(byRank)) {
    const bySuit = new Map();
    for (const c of group) if (!bySuit.has(c.suit)) bySuit.set(c.suit, c);
    const distinct = [...bySuit.values()];
    if (distinct.length >= 3) {
      out.push(mkCandidate(distinct, {}));
    } else if (distinct.length === 2 && jokers.length >= 1) {
      const j = jokers[0];
      const free = SUITS.find((s) => !bySuit.has(s));
      if (free) out.push(mkCandidate([...distinct, j], { [j.id]: { rank: distinct[0].rank, suit: free } }));
    }
  }

  // Nizovi
  for (const suit of SUITS) {
    const ofSuit = reals.filter((c) => c.suit === suit);
    if (ofSuit.length < 2) continue;
    const byR = {};
    for (const c of ofSuit) {
      (byR[c.rank] ??= []).push(c);
      if (c.rank === 1) (byR[14] ??= []).push(c);
    }
    const ranks = Object.keys(byR).map(Number).sort((a, b) => a - b);
    // Čisti maksimalni lanci.
    let chain = [];
    const flush = () => {
      if (chain.length >= 3) {
        const used = pickChainCards(byR, chain);
        if (used) out.push(mkCandidate(used, {}));
      }
      chain = [];
    };
    for (let i = 0; i < ranks.length; i++) {
      if (chain.length && ranks[i] !== chain[chain.length - 1] + 1) flush();
      chain.push(ranks[i]);
    }
    flush();
    // Lanci s jednim jokerom koji premošćuje rupu ili produljuje par.
    if (jokers.length >= 1) {
      const j = jokers[0];
      for (let i = 0; i < ranks.length - 1; i++) {
        const a = ranks[i];
        const b = ranks[i + 1];
        let jr = null;
        if (b - a === 2) jr = a + 1;
        else if (b - a === 1) jr = a - 1 >= 1 ? a - 1 : b + 1 <= 14 ? b + 1 : null;
        if (jr === null) continue;
        const used = pickChainCards(byR, [a, b]);
        if (!used) continue;
        const map = { [j.id]: { rank: jr === 14 ? 1 : jr, suit } };
        const all = [...used, j];
        if (validateMeld(all, map).valid) out.push(mkCandidate(all, map));
      }
    }
  }

  const valid = out.filter((c) => c.value > 0 && c.cardIds.length >= 3);
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.value - a.value || a.jokers - b.jokers);
  return valid[0];
}

function pickChainCards(byR, chainRanks) {
  const used = [];
  const usedIds = new Set();
  for (const r of chainRanks) {
    const c = (byR[r] || []).find((x) => !usedIds.has(x.id));
    if (!c) return null;
    usedIds.add(c.id);
    used.push(c);
  }
  return used;
}

function mkCandidate(cardsArr, jokerMap) {
  const v = validateMeld(cardsArr, jokerMap);
  if (!v.valid) return { cardIds: [], value: -1, jokers: 0 };
  const sc = meldScore(cardsArr, jokerMap, v.type);
  return {
    cardIds: cardsArr.map((c) => c.id),
    jokerMap,
    value: sc.total,
    jokers: cardsArr.filter((c) => c.joker).length,
  };
}

// ---------------------------------------------------------------------------
// Brojanje karata
// ---------------------------------------------------------------------------

function seenCopies(state, seat, rank, suit) {
  const r = state.round;
  let n = 0;
  const check = (id) => {
    const c = state.cardsById[id];
    if (!c.joker && c.rank === rank && c.suit === suit) n++;
  };
  for (const id of r.hands[seat]) check(id);
  for (const m of r.melds) for (const id of m.cardIds) check(id);
  for (const id of r.discard) check(id);
  for (let s = 0; s < state.nPlayers; s++) {
    if (s === seat) continue;
    for (const id of r.publicKnown[s]) check(id);
  }
  return n;
}

function minOpponentHandSize(state, seat) {
  const mySide = sideOfSeat(state, seat);
  let min = Infinity;
  for (let s = 0; s < state.nPlayers; s++) {
    if (sideOfSeat(state, s) === mySide) continue;
    min = Math.min(min, state.round.hands[s].length);
  }
  return min === Infinity ? 99 : min;
}

function cards(state, ids) {
  return ids.map((id) => state.cardsById[id]);
}
