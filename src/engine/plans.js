// Pretraga valjanih planova izlaganja:
//  - solveJokerAssignments: pronalazi moguće deklaracije jokera u kombinaciji
//  - findMeldPlanForCard: postoji li (i koji) način da se zadana karta odmah
//    izloži — uvjet za uzimanje karata iz otvorenog kupa.

import { SUITS } from './cards.js';
import { validateMeld, effectiveCard } from './combos.js';

// ---------------------------------------------------------------------------
// Deklaracije jokera
// ---------------------------------------------------------------------------

// Vraća popis valjanih potpunih jokerMap-ova za zadane karte; partialMap sadrži
// već deklarirane jokere (npr. iz postojeće kombinacije pri dodavanju).
export function solveJokerAssignments(cards, partialMap = {}) {
  const jokers = cards.filter((c) => c.joker && !partialMap[c.id]);
  if (jokers.length === 0) {
    const v = validateMeld(cards, partialMap);
    return v.valid ? [{ map: { ...partialMap }, type: v.type }] : [];
  }
  const fixedEffs = cards
    .filter((c) => !c.joker || partialMap[c.id])
    .map((c) => effectiveCard(c, partialMap));
  const n = cards.length;
  if (n < 3) return [];

  const solutions = [];
  const seen = new Set();
  const push = (map) => {
    const full = { ...partialMap, ...map };
    const v = validateMeld(cards, full);
    if (!v.valid) return;
    const key = jokers.map((j) => `${j.id}:${full[j.id].suit}${full[j.id].rank}`).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    solutions.push({ map: full, type: v.type });
  };

  // Tris: sve fiksne karte iste oznake → jokeri dobiju istu oznaku.
  const ranks = new Set(fixedEffs.map((e) => e.rank));
  if (fixedEffs.length === 0 || ranks.size === 1) {
    const r = fixedEffs.length ? [...ranks][0] : 1;
    const usedSuits = fixedEffs.map((e) => e.suit);
    const map = {};
    jokers.forEach((j, i) => {
      const free = SUITS.find((s) => !usedSuits.includes(s)) || SUITS[i % 4];
      usedSuits.push(free);
      map[j.id] = { rank: r, suit: free };
    });
    push(map);
  }

  // Niz: sve fiksne karte iste boje → jokeri popunjavaju rupe u CIKLIČKOM
  // prozoru (as spaja K i 2, pa je valjano i npr. K,A + joker kao 2).
  const suits = new Set(fixedEffs.map((e) => e.suit));
  if (fixedEffs.length > 0 && suits.size === 1) {
    const s = [...suits][0];
    const fixedRanks = fixedEffs.map((e) => e.rank);
    if (n <= 13 && new Set(fixedRanks).size === fixedRanks.length) {
      for (let start = 1; start <= 13; start++) {
        const window = Array.from({ length: n }, (_, k) => ((start - 1 + k) % 13) + 1);
        if (!fixedRanks.every((r) => window.includes(r))) continue;
        const missing = window.filter((r) => !fixedRanks.includes(r));
        if (missing.length !== jokers.length) continue;
        const map = {};
        jokers.forEach((j, i) => { map[j.id] = { rank: missing[i], suit: s }; });
        push(map);
      }
    } else if (n === 14) {
      // Binakula s jokerima: trebaju svi rangovi 1..13 + drugi as.
      const have = {};
      for (const r of fixedRanks) have[r] = (have[r] || 0) + 1;
      const missing = [];
      let ok = true;
      for (let r = 1; r <= 13; r++) {
        const m = (r === 1 ? 2 : 1) - (have[r] || 0);
        if (m < 0) { ok = false; break; }
        for (let k = 0; k < m; k++) missing.push(r);
      }
      if (ok && missing.length === jokers.length) {
        const map = {};
        jokers.forEach((j, i) => { map[j.id] = { rank: missing[i], suit: s }; });
        push(map);
      }
    }
  }
  return solutions;
}

// Ciklički sljedeći/prethodni rang (as spaja K i 2).
const cyc = (x) => ((((x - 1) % 13) + 13) % 13) + 1;

// ---------------------------------------------------------------------------
// Plan izlaganja za zadanu kartu (uvjet uzimanja kupa)
// ---------------------------------------------------------------------------
//
// Vraća null ili plan:
//   { kind:'extend', meldId, jokerAs? }                — dodavanje na kombinaciju
//   { kind:'new', cardIds, jokerMap }                  — nova kombinacija
// `pool` su karte koje igrač ima na raspolaganju (ruka + ostale uzete karte),
// BEZ same karte `bottom`. `sideMelds` su kombinacije njegove strane.

export function findMeldPlanForCard(bottom, pool, sideMelds, cardsById) {
  // 1) proširenje postojeće kombinacije (najjeftinije — ne troši karte iz ruke)
  for (const m of sideMelds) {
    const meldCards = m.cardIds.map((id) => cardsById[id]);
    if (!bottom.joker) {
      const v = validateMeld([...meldCards, bottom], m.jokerMap);
      if (v.valid) return { kind: 'extend', meldId: m.id };
    } else {
      const sols = solveJokerAssignments([...meldCards, bottom], m.jokerMap);
      if (sols.length) return { kind: 'extend', meldId: m.id, jokerAs: sols[0].map[bottom.id] };
    }
  }

  const reals = pool.filter((c) => !c.joker);
  const jokers = pool.filter((c) => c.joker);

  if (bottom.joker) {
    // Joker s dna kupa: tris od bilo koje oznake s ≥2 stvarne karte
    // različitih boja (joker preuzima jednu od preostalih boja)…
    const byRank = groupBy(reals, (c) => c.rank);
    for (const group of Object.values(byRank)) {
      const bySuit = new Map();
      for (const c of group) if (!bySuit.has(c.suit)) bySuit.set(c.suit, c);
      const distinct = [...bySuit.values()];
      if (distinct.length < 2) continue;
      const free = SUITS.find((s) => !bySuit.has(s));
      if (!free) continue;
      const jokerAs = { rank: distinct[0].rank, suit: free };
      const plan = newPlan([distinct[0], distinct[1], bottom], { [bottom.id]: jokerAs });
      if (plan) return plan;
    }
    // …ili niz: dvije karte iste boje na razmaku ≤2, joker popunjava.
    for (const suit of SUITS) {
      const cardsOfSuit = reals.filter((c) => c.suit === suit);
      const sols = pairRunWithJoker(cardsOfSuit, bottom, suit);
      if (sols) return sols;
    }
    return null;
  }

  // 2) nova kombinacija — redoslijed preferira čiste kombinacije (bez jokera)
  for (let maxJ = 0; maxJ <= Math.min(2, jokers.length); maxJ++) {
    const set = setPlan(bottom, reals, jokers, maxJ);
    if (set) return set;
    const run = runPlan(bottom, reals, jokers, maxJ);
    if (run) return run;
  }
  return null;
}

function newPlan(cards, jokerMap) {
  const v = validateMeld(cards, jokerMap);
  if (!v.valid) return null;
  return { kind: 'new', cardIds: cards.map((c) => c.id), jokerMap };
}

function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) (out[fn(x)] ??= []).push(x);
  return out;
}

function setPlan(bottom, reals, jokers, jokersToUse) {
  // Tris: sve karte različitih boja, najviše 4.
  const needReals = 2 - jokersToUse;
  if (jokers.length < jokersToUse) return null;
  const usedSuits = [bottom.suit];
  const picks = [];
  for (const c of reals) {
    if (picks.length >= needReals) break;
    if (c.rank !== bottom.rank || usedSuits.includes(c.suit)) continue;
    picks.push(c);
    usedSuits.push(c.suit);
  }
  if (picks.length < needReals) return null;
  const used = [bottom, ...picks];
  const map = {};
  for (let i = 0; i < jokersToUse; i++) {
    const free = SUITS.find((s) => !usedSuits.includes(s));
    if (!free) return null;
    usedSuits.push(free);
    map[jokers[i].id] = { rank: bottom.rank, suit: free };
    used.push(jokers[i]);
  }
  return newPlan(used, map);
}

function runPlan(bottom, reals, jokers, jokersToUse) {
  if (jokers.length < jokersToUse) return null;
  const suitCards = reals.filter((c) => c.suit === bottom.suit);
  const byRank = {};
  for (const c of suitCards) byRank[c.rank] ??= c;
  // Ciklički prozori od 3 ranga koji sadrže rang najdonje karte.
  for (let off = -2; off <= 0; off++) {
    const window = [cyc(bottom.rank + off), cyc(bottom.rank + off + 1), cyc(bottom.rank + off + 2)];
    const cards = [bottom];
    const map = {};
    let jUsed = 0;
    let ok = true;
    for (const r of window) {
      if (r === bottom.rank) continue;
      const real = byRank[r];
      if (real) {
        cards.push(real);
      } else if (jUsed < jokersToUse) {
        const j = jokers[jUsed++];
        map[j.id] = { rank: r, suit: bottom.suit };
        cards.push(j);
      } else {
        ok = false;
        break;
      }
    }
    if (ok && jUsed === jokersToUse) {
      const plan = newPlan(cards, map);
      if (plan) return plan;
    }
  }
  return null;
}

// Joker s dna kupa + dvije stvarne karte iste boje na cikličkom razmaku ≤ 2.
function pairRunWithJoker(cardsOfSuit, jokerCard, suit) {
  const byRank = {};
  for (const c of cardsOfSuit) byRank[c.rank] ??= c;
  const ranks = Object.keys(byRank).map(Number);
  for (const a of ranks) {
    for (const b of ranks) {
      if (a === b) continue;
      const d = ((b - a) % 13 + 13) % 13;
      const candidates = [];
      if (d === 1) candidates.push(cyc(a - 1), cyc(b + 1));
      else if (d === 2) candidates.push(cyc(a + 1));
      for (const jr of candidates) {
        const map = { [jokerCard.id]: { rank: jr, suit } };
        const plan = newPlan([byRank[a], byRank[b], jokerCard], map);
        if (plan) return plan;
      }
    }
  }
  return null;
}
