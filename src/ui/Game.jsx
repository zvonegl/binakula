import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createGame, startRound, drawFromStock, takeFromDiscard, undoTake, canTakeAt,
  meldNew, meldAdd, redeemJoker, discard, closeRound, GameError, sideOfSeat,
  canRedeemJoker as engineCanRedeem,
} from '../engine/game.js';
import { solveJokerAssignments } from '../engine/plans.js';
import { meldScore } from '../engine/combos.js';
import { cardLabel, SUIT_SYMBOLS, RANK_LABELS } from '../engine/cards.js';
import { nextBotAction } from '../bot/bot.js';
import CardView from './CardView.jsx';
import RulesModal from './RulesModal.jsx';
import Scoreboard, { sideName } from './Scoreboard.jsx';

const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };

export default function Game({ config, onExit }) {
  const gref = useRef(null);
  if (!gref.current) {
    gref.current = createGame(config);
    startRound(gref.current);
  }
  const g = gref.current;
  const players = g.config.players;
  const humanSeats = players.map((p, i) => (p.type === 'human' ? i : -1)).filter((i) => i >= 0);
  const multiHuman = humanSeats.length > 1;

  const [version, bump] = useReducer((x) => x + 1, 0);
  const [viewerSeat, setViewerSeat] = useState(() =>
    players[g.round.turn].type === 'human' ? g.round.turn : (humanSeats[0] ?? 0));
  const [handoff, setHandoff] = useState(() => multiHuman && players[g.round.turn].type === 'human');
  const [selected, setSelected] = useState(() => new Set());
  const [pileSel, setPileSel] = useState(null);
  const [toast, setToast] = useState(null);
  const [binakula, setBinakula] = useState(false);
  const [summary, setSummary] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [jokerDialog, setJokerDialog] = useState(null);

  const r = g.round;
  const mySide = sideOfSeat(g, viewerSeat);
  const viewerIsHuman = players[viewerSeat].type === 'human';
  const myTurn = r && !r.closed && r.turn === viewerSeat && viewerIsHuman && !handoff && !summary;
  const handIds = r ? r.hands[viewerSeat] : [];

  function showToast(msg) {
    setToast({ msg, key: Date.now() });
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  function afterEvent(ev) {
    if (!ev) return;
    let extraDelay = 0;
    if (ev.binakula) {
      setBinakula(true);
      setTimeout(() => setBinakula(false), 3000);
      extraDelay = 2200;
    }
    if (['discard', 'close', 'meldNew', 'meldAdd', 'redeemJoker', 'take', 'undoTake'].includes(ev.type)) {
      setSelected(new Set());
      setPileSel(null);
    }
    if (ev.type === 'close') {
      setTimeout(() => { setSummary(true); bump(); }, 700 + extraDelay);
    }
    if (ev.type === 'discard') {
      const next = ev.nextTurn;
      if (players[next].type === 'human') {
        setViewerSeat(next);
        if (multiHuman) setHandoff(true);
      }
    }
  }

  function act(fn) {
    try {
      const ev = fn();
      afterEvent(ev);
      bump();
      return ev;
    } catch (e) {
      if (e instanceof GameError) { showToast(e.message); return null; }
      throw e;
    }
  }

  // ----- botovi -------------------------------------------------------------
  useEffect(() => {
    if (!r || r.closed || summary || handoff) return;
    const seat = r.turn;
    const p = players[seat];
    if (p.type !== 'bot') return;
    const delay = r.phase === 'draw' ? 850 : 550;
    const t = setTimeout(() => {
      let ev = null;
      try {
        const a = nextBotAction(g, seat, p.difficulty);
        ev = applyBotAction(g, seat, a);
      } catch (err) {
        console.error('Bot greška:', err);
        ev = botFallback(g, seat);
      }
      afterEvent(ev);
      bump();
    }, delay);
    return () => clearTimeout(t);
  }, [version, summary, handoff]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- interakcije igrača -------------------------------------------------

  const takeable = useMemo(() => {
    if (!myTurn || r.phase !== 'draw') return null;
    return r.discard.map((_, i) => !!canTakeAt(g, viewerSeat, i));
  }, [version, myTurn, viewerSeat]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSelect(id) {
    if (!myTurn) return;
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function confirmTake() {
    const ev = act(() => takeFromDiscard(g, viewerSeat, pileSel));
    if (ev) setPileSel(null);
  }

  function meldSelected() {
    const ids = [...selected];
    const cards = ids.map((id) => g.cardsById[id]);
    const sols = solveJokerAssignments(cards, {});
    if (sols.length === 0) { showToast('Odabrane karte ne čine valjanu kombinaciju.'); return; }
    const hasFreeJoker = cards.some((c) => c.joker);
    if (sols.length === 1 || !hasFreeJoker) {
      act(() => meldNew(g, viewerSeat, ids, sols[0].map));
    } else {
      setJokerDialog({
        title: 'Što predstavlja joker?',
        options: sols.map((sol) => ({ label: solutionLabel(g, ids, sol), sol })),
        apply: (sol) => act(() => meldNew(g, viewerSeat, ids, sol.map)),
      });
    }
  }

  function addToMeld(meld) {
    if (!myTurn || selected.size === 0) return;
    if (meld.side !== mySide) { showToast('Na protivničke kombinacije ne smiješ dodavati karte.'); return; }
    const ids = [...selected];
    const all = [...meld.cardIds, ...ids].map((id) => g.cardsById[id]);
    const sols = solveJokerAssignments(all, meld.jokerMap);
    if (sols.length === 0) { showToast('Odabrane karte se ne uklapaju u tu kombinaciju.'); return; }
    const hasFreeJoker = ids.some((id) => g.cardsById[id].joker);
    if (sols.length === 1 || !hasFreeJoker) {
      act(() => meldAdd(g, viewerSeat, meld.id, ids, sols[0].map));
    } else {
      setJokerDialog({
        title: 'Što predstavlja joker?',
        options: sols.map((sol) => ({ label: solutionLabel(g, ids, sol), sol })),
        apply: (sol) => act(() => meldAdd(g, viewerSeat, meld.id, ids, sol.map)),
      });
    }
  }

  function clickJoker(meld, jokerId) {
    if (!myTurn || r.phase !== 'meld') { showToast('Otkup jokera moguć je u fazi izlaganja na tvom potezu.'); return; }
    const as = meld.jokerMap[jokerId];
    const replId = handIds.find((id) => {
      const c = g.cardsById[id];
      return !c.joker && c.rank === as.rank && c.suit === as.suit;
    });
    if (!replId) {
      showToast(`Za otkup ovog jokera trebaš ${SUIT_SYMBOLS[as.suit]}${RANK_LABELS[as.rank]} u ruci.`);
      return;
    }
    // Tvoja karta sjeda na mjesto jokera, a joker ide u tvoju ruku.
    act(() => redeemJoker(g, viewerSeat, { meldId: meld.id, jokerId, replacementCardId: replId }));
  }

  // Joker kojeg viewer može otkupiti: ima njegovu kartu i joker se ima kamo izložiti.
  function canRedeemJoker(meld, jokerId) {
    if (!myTurn || r.phase !== 'meld') return false;
    return !!engineCanRedeem(g, viewerSeat, meld.id, jokerId);
  }

  function sortHand(by) {
    const hand = r.hands[viewerSeat];
    const key = (id) => {
      const c = g.cardsById[id];
      if (c.joker) return [9, 99];
      return by === 'suit' ? [SUIT_ORDER[c.suit], c.rank] : [c.rank, SUIT_ORDER[c.suit]];
    };
    hand.sort((a, b) => {
      const [a1, a2] = key(a); const [b1, b2] = key(b);
      return a1 - b1 || a2 - b2;
    });
    bump();
  }

  const dragIdx = useRef(null);
  function reorderHand(from, to) {
    if (from == null || to == null || from === to) return;
    const hand = r.hands[viewerSeat];
    const [c] = hand.splice(from, 1);
    hand.splice(to, 0, c);
    bump();
  }

  function nextRound() {
    startRound(g);
    setSummary(false);
    setSelected(new Set());
    setPileSel(null);
    const next = g.round.turn;
    if (players[next].type === 'human') {
      setViewerSeat(next);
      if (multiHuman) setHandoff(true);
    } else if (humanSeats.length) {
      setViewerSeat(humanSeats[0]);
    }
    bump();
  }

  // ----- render -------------------------------------------------------------

  const otherSeats = Array.from({ length: g.nPlayers - 1 }, (_, k) => (viewerSeat + 1 + k) % g.nPlayers);
  // Igrači sjede oko stola: ti dolje, ostali lijevo / gore / desno.
  // U igri 2 na 2 partner ti je preko puta (gore).
  const seatAt = { left: null, top: null, right: null };
  if (g.nPlayers === 2) seatAt.top = otherSeats[0];
  else if (g.nPlayers === 3) { seatAt.left = otherSeats[0]; seatAt.right = otherSeats[1]; }
  else { seatAt.left = otherSeats[0]; seatAt.top = otherSeats[1]; seatAt.right = otherSeats[2]; }
  const turnName = players[r.turn].name;
  const lastResult = g.scores[g.scores.length - 1];

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar-title">♠ Binakula</div>
        <div className="topbar-info">
          Krug {g.roundNo} · Cilj {g.config.target} · Na potezu: <b>{turnName}</b>
        </div>
        <div className="topbar-btns">
          <button className="btn ghost" onClick={() => setScoreOpen(true)}>Semafor</button>
          <button className="btn ghost" onClick={() => setRulesOpen(true)}>Pravila</button>
          <button className="btn ghost" onClick={() => { if (window.confirm('Napustiti partiju?')) onExit(); }}>Izlaz</button>
        </div>
      </header>

      <div className={`table-felt np${g.nPlayers}`}>
        {['left', 'top', 'right'].map((pos) => (
          <div className={`zone zone-${pos}`} key={pos}>
            {seatAt[pos] != null && (
              <div className="opp-panel">
                <SeatChip g={g} seat={seatAt[pos]} active={r.turn === seatAt[pos] && !r.closed} dealer={g.dealer === seatAt[pos]} />
                <MeldZone g={g} seat={seatAt[pos]}
                  onMeldClick={selected.size > 0 ? addToMeld : undefined}
                  onJokerClick={clickJoker} canRedeem={canRedeemJoker} />
              </div>
            )}
          </div>
        ))}

        <div className="zone zone-center">
          <div className="center-row">
            <StockPile g={g} onClick={myTurn && r.phase === 'draw' ? () => act(() => drawFromStock(g, viewerSeat)) : undefined} />
            <DiscardSpread
              g={g} pileSel={pileSel} takeable={takeable}
              onCardClick={myTurn && r.phase === 'draw' ? (i) => setPileSel(i === pileSel ? null : i) : undefined}
            />
            <PhaseBar phase={r.closed ? 'done' : r.phase} pending={!!r.pendingPileCardId} />
          </div>
        </div>

        <div className="zone zone-mine">
          <MeldZone g={g} seat={viewerSeat} mine
            onMeldClick={selected.size > 0 ? addToMeld : undefined}
            onJokerClick={clickJoker} canRedeem={canRedeemJoker} />
        </div>
      </div>

      <div className="bottom-area">
        <ActionBar
          g={g} myTurn={myTurn} viewerSeat={viewerSeat} selected={selected} pileSel={pileSel}
          onConfirmTake={confirmTake} onCancelTake={() => setPileSel(null)}
          onMeld={meldSelected}
          onDiscard={() => act(() => discard(g, viewerSeat, [...selected][0]))}
          onClose={() => act(() => closeRound(g, viewerSeat, handIds[0]))}
          onUndoTake={() => act(() => undoTake(g, viewerSeat))}
          onSort={sortHand}
        />
        {viewerIsHuman ? (
          <div className="hand-wrap">
            <div className="hand-owner">
              {players[viewerSeat].name} {g.nPlayers === 4 && <span className={`pair-dot pair-${mySide}`} />}
              <span className="hand-count">{handIds.length} karata</span>
            </div>
            <div className="hand">
              {handIds.map((id, i) => {
                const n = handIds.length;
                const half = Math.max((n - 1) / 2, 1);
                const off = i - (n - 1) / 2;
                const angle = n > 1 ? (off / half) * Math.min(24, n * 2.2) : 0;
                const droop = n > 1 ? (off / half) ** 2 * Math.min(30, n * 2.6) : 0;
                return (
                  <div
                    key={`${g.roundNo}-${id}`}
                    className="hand-slot"
                    style={{
                      transform: `rotate(${angle}deg) translateY(${droop}px)`,
                      zIndex: 10 + i,
                      animationDelay: `${Math.min(i * 35, 700)}ms`,
                    }}
                    draggable
                    onDragStart={() => { dragIdx.current = i; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { reorderHand(dragIdx.current, i); dragIdx.current = null; }}
                  >
                    <CardView
                      card={g.cardsById[id]} size="md"
                      selected={selected.has(id)}
                      highlight={r.pendingPileCardId === id || r.pendingJokers.includes(id)}
                      onClick={() => toggleSelect(id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="spectator-note">Botovi igraju… promatraš partiju.</div>
        )}
      </div>

      {toast && <div className="toast" key={toast.key}>{toast.msg}</div>}
      {binakula && <BinakulaOverlay />}
      {handoff && !summary && (
        <div className="overlay handoff">
          <div className="handoff-box">
            <div className="handoff-icon">🂠</div>
            <h2>Predaj uređaj igraču</h2>
            <div className="handoff-name">{players[viewerSeat].name}</div>
            <p>Prethodni igrač ne smije vidjeti tvoje karte.</p>
            <button className="btn primary big" onClick={() => setHandoff(false)}>Preuzimam</button>
          </div>
        </div>
      )}
      {summary && lastResult && (
        <RoundSummary g={g} result={lastResult} onNext={nextRound} onExit={onExit} />
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
      {scoreOpen && <Scoreboard g={g} onClose={() => setScoreOpen(false)} />}
      {jokerDialog && (
        <ChoiceDialog
          title={jokerDialog.title}
          options={jokerDialog.options.map((o) => o.label)}
          onPick={(i) => { const o = jokerDialog.options[i]; setJokerDialog(null); jokerDialog.apply(o.sol); }}
          onCancel={() => setJokerDialog(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pomoćne komponente
// ---------------------------------------------------------------------------

function SeatChip({ g, seat, active, dealer }) {
  const p = g.config.players[seat];
  const count = g.round.hands[seat].length;
  const side = sideOfSeat(g, seat);
  const backs = Math.min(count, 7);
  return (
    <div className={`seat-chip ${active ? 'active' : ''}`}>
      {g.nPlayers === 4 && <span className={`pair-dot pair-${side}`} title={`Par ${side + 1}`} />}
      <span className="seat-chip-name">{p.type === 'bot' ? '🤖 ' : '👤 '}{p.name}{dealer ? ' · dijeli' : ''}</span>
      <span className="seat-backs">
        {Array.from({ length: backs }, (_, i) => (
          <span key={i} className="mini-back" style={{ marginLeft: i ? -9 : 0 }} />
        ))}
      </span>
      <span className="seat-count">{count}</span>
    </div>
  );
}

function StockPile({ g, onClick }) {
  const n = g.round.stock.length;
  return (
    <div className={`stock ${onClick ? 'clickable-stock' : ''}`} onClick={onClick} title="Zatvoreni špil — klikni za vučenje">
      <CardView faceDown size="md" />
      <div className="stock-count">{n}</div>
      <div className="stock-label">špil</div>
    </div>
  );
}

function DiscardSpread({ g, pileSel, takeable, onCardClick }) {
  const r = g.round;
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [r.discard.length]);
  return (
    <div className="discard-outer">
      <div className="discard-label">otvoreni kup ({r.discard.length})</div>
      <div className="discard-spread" ref={ref}>
        {r.discard.map((id, i) => (
          <div
            key={id}
            className={[
              'discard-slot',
              pileSel != null && i >= pileSel ? 'will-take' : '',
              takeable && takeable[i] ? 'takeable' : '',
            ].join(' ')}
            onClick={onCardClick ? () => onCardClick(i) : undefined}
          >
            <CardView card={g.cardsById[id]} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PhaseBar({ phase, pending }) {
  const steps = ['Vuci', 'Izloži', 'Odbaci'];
  const activeIdx = phase === 'draw' ? 0 : pending ? 1 : phase === 'meld' ? 1 : -1;
  return (
    <div className="phase-bar">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span className="phase-arrow">→</span>}
          <span className={`phase-step ${i === activeIdx ? 'active' : ''} ${phase === 'meld' && i === 2 ? 'soon' : ''}`}>{s}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

// Kombinacije koje je igrač izložio stoje ispred njega (po sjedalu).
function MeldZone({ g, seat, mine, onMeldClick, onJokerClick, canRedeem }) {
  const melds = g.round.melds.filter((m) => m.seat === seat);
  const side = sideOfSeat(g, seat);
  return (
    <div className={`meld-group ${mine ? 'mine' : ''}`}>
      <div className="meld-group-label">
        {g.nPlayers === 4 && <span className={`pair-dot pair-${side}`} />}
        {mine ? `${g.config.players[seat].name} — tvoje kombinacije` : g.config.players[seat].name}
      </div>
      <div className="meld-list">
        {melds.length === 0 && <span className="meld-empty">— još ništa izloženo —</span>}
        {melds.map((m) => (
          <MeldView key={m.id} g={g} meld={m}
            onClick={onMeldClick ? () => onMeldClick(m) : undefined}
            onJokerClick={onJokerClick} canRedeem={canRedeem} />
        ))}
      </div>
    </div>
  );
}

function MeldView({ g, meld, onClick, onJokerClick, canRedeem }) {
  // Engine drži karte od najniže prema najvišoj; u stupcu se slažu tako da je
  // najniža DOLJE (potpuno vidljiva), a više karte idu prema gore.
  const cards = meld.cardIds.map((id) => g.cardsById[id]).reverse();
  const sc = meldScore(cards, meld.jokerMap, meld.type);
  return (
    <div className={`meld ${meld.type === 'binakula' ? 'meld-binakula' : ''} ${onClick ? 'meld-target' : ''}`}
      onClick={onClick} title={onClick ? 'Dodaj odabrane karte na ovu kombinaciju' : undefined}>
      {meld.type === 'binakula' && <div className="meld-binakula-tag">BINAKULA</div>}
      <div className="meld-cards">
        {cards.map((c, i) => (
          <div key={c.id}
            className={`meld-card-slot ${c.joker && canRedeem && canRedeem(meld, c.id) ? 'redeemable' : ''}`}
            style={{ marginTop: i ? -48 : 0 }}
            title={c.joker && canRedeem && canRedeem(meld, c.id) ? 'Imaš ovu kartu — klikni za otkup jokera!' : undefined}>
            <CardView
              card={c} size="xs" jokerAs={meld.jokerMap[c.id]}
              onClick={c.joker && onJokerClick
                ? (e) => { e.stopPropagation(); onJokerClick(meld, c.id); }
                : undefined}
            />
          </div>
        ))}
      </div>
      <div className="meld-score" title={sc.double ? 'Čista kombinacija — broji se duplo' : 'Vrijednost kombinacije (×10 zapis)'}>
        {sc.total}{sc.double && <span className="double-badge">×2</span>}
      </div>
    </div>
  );
}

function ActionBar({ g, myTurn, viewerSeat, selected, pileSel, onConfirmTake, onCancelTake, onMeld, onDiscard, onClose, onUndoTake, onSort }) {
  const r = g.round;
  if (!r || r.closed) return <div className="action-bar" />;
  if (!myTurn) {
    return (
      <div className="action-bar">
        <span className="action-hint">Na potezu: <b>{g.config.players[r.turn].name}</b>…</span>
        <span className="action-spacer" />
        <button className="btn ghost sm" onClick={() => onSort('suit')}>Sortiraj ♠♥</button>
        <button className="btn ghost sm" onClick={() => onSort('rank')}>Sortiraj 123</button>
      </div>
    );
  }
  const n = selected.size;
  const handLen = r.hands[viewerSeat].length;
  const pending = r.pendingPileCardId ? g.cardsById[r.pendingPileCardId] : null;
  const pendingJoker = r.pendingJokers.some((id) => r.hands[viewerSeat].includes(id));

  return (
    <div className="action-bar">
      {r.phase === 'draw' && pileSel == null && (
        <span className="action-hint">Povuci sa špila ili klikni kartu u kupu (uzimaš nju i sve iznad nje).</span>
      )}
      {r.phase === 'draw' && pileSel != null && (
        <>
          <span className="action-hint">
            Uzimaš <b>{r.discard.length - pileSel}</b> {r.discard.length - pileSel === 1 ? 'kartu' : 'karata'} — najdonja {cardLabel(g.cardsById[r.discard[pileSel]])} mora odmah na stol.
          </span>
          <button className="btn primary" onClick={onConfirmTake}>Uzmi</button>
          <button className="btn ghost" onClick={onCancelTake}>Odustani</button>
        </>
      )}
      {r.phase === 'meld' && (
        <>
          {pending && (
            <span className="pending-chip">⚠ Izloži {cardLabel(pending)} (najdonja iz kupa)</span>
          )}
          {pendingJoker && (
            <span className="pending-chip">⚠ Izloži otkupljenog jokera (bilo gdje na svojoj strani)</span>
          )}
          {!pending && !pendingJoker && <span className="action-hint">Izloži kombinacije, dodaj na svoje, pa odbaci jednu kartu.</span>}
          <button className="btn primary" disabled={n < 3} onClick={onMeld}>Izloži ({n})</button>
          <button className="btn" disabled={n !== 1 || handLen === 1 || !!pending || pendingJoker} onClick={onDiscard}>Odbaci</button>
          {handLen === 1 && !pending && !pendingJoker && (
            <button className="btn close-btn" onClick={onClose}>Zatvori krug 🏁</button>
          )}
          {r.takeSnapshot && <button className="btn ghost" onClick={onUndoTake}>Poništi uzimanje</button>}
        </>
      )}
      <span className="action-spacer" />
      <button className="btn ghost sm" onClick={() => onSort('suit')}>Sortiraj ♠♥</button>
      <button className="btn ghost sm" onClick={() => onSort('rank')}>Sortiraj 123</button>
    </div>
  );
}

function ChoiceDialog({ title, options, onPick, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal choice" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2></div>
        <div className="choice-list">
          {options.map((label, i) => (
            <button key={i} className="btn choice-btn" onClick={() => onPick(i)}>{label}</button>
          ))}
        </div>
        <button className="btn ghost" onClick={onCancel}>Odustani</button>
      </div>
    </div>
  );
}

function BinakulaOverlay() {
  return (
    <div className="binakula-overlay">
      <div className="binakula-burst">
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className="spark" style={{ '--i': i }}>{['♠', '♥', '♦', '♣'][i % 4]}</span>
        ))}
        <div className="binakula-text">BINAKULA!</div>
        <div className="binakula-sub">kompletan niz od asa do asa</div>
      </div>
    </div>
  );
}

function RoundSummary({ g, result, onNext, onExit }) {
  const sides = Array.from({ length: g.nSides }, (_, i) => i);
  const closerName = g.config.players[result.closerSeat].name;
  return (
    <div className="modal-backdrop">
      <div className="modal summary">
        <div className="modal-head">
          <h2>{g.gameOver ? '🏆 Kraj partije!' : `Kraj ${g.roundNo}. kruga`}</h2>
        </div>
        <p className="summary-closer"><b>{closerName}</b> je zatvorio krug (+100 bonusa).</p>
        <table className="score-table">
          <thead>
            <tr><th></th>{sides.map((s) => <th key={s}>{sideName(g, s)}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td>Izloženo</td>{sides.map((s) => <td key={s}>+{result.meldPts[s]}</td>)}</tr>
            <tr><td>Ostalo u ruci</td>{sides.map((s) => <td key={s}>−{result.handPts[s]}</td>)}</tr>
            <tr><td>Bonus izlaska</td>{sides.map((s) => <td key={s}>{s === result.closerSide ? '+100' : '—'}</td>)}</tr>
            <tr className="summary-round"><td>Krug</td>{sides.map((s) => <td key={s}><b>{result.perSide[s]}</b></td>)}</tr>
          </tbody>
          <tfoot>
            <tr><td>Ukupno</td>{sides.map((s) => <td key={s}><b>{g.totals[s]}</b></td>)}</tr>
          </tfoot>
        </table>
        <p className="score-legend">Zapis ×10: 22,5 boda → „225”. Cilj: {g.config.target}.</p>
        {g.gameOver ? (
          <>
            <p className="summary-winner">Pobjednik: <b>{sideName(g, g.winnerSide)}</b> 🎉</p>
            <button className="btn primary big" onClick={onExit}>Nova partija</button>
          </>
        ) : (
          <button className="btn primary big" onClick={onNext}>Sljedeći krug</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pomoćne funkcije
// ---------------------------------------------------------------------------

function asLabel(as) {
  return `${SUIT_SYMBOLS[as.suit]}${RANK_LABELS[as.rank]}`;
}

function solutionLabel(g, newIds, sol) {
  const typeName = { run: 'niz', set: 'tris', binakula: 'BINAKULA' }[sol.type];
  const parts = newIds
    .filter((id) => g.cardsById[id].joker && sol.map[id])
    .map((id) => `joker = ${asLabel(sol.map[id])}`);
  return `${typeName}: ${parts.join(', ') || '—'}`;
}

function applyBotAction(g, seat, a) {
  if (!a) return null;
  switch (a.type) {
    case 'drawStock': return drawFromStock(g, seat);
    case 'takePile': return takeFromDiscard(g, seat, a.index);
    case 'meldNew': return meldNew(g, seat, a.cardIds, a.jokerMap);
    case 'meldAdd': return meldAdd(g, seat, a.meldId, a.cardIds, a.jokerMap);
    case 'redeemJoker': return redeemJoker(g, seat, a.args);
    case 'discard': return discard(g, seat, a.cardId);
    case 'close': return closeRound(g, seat, a.cardId);
    default: return null;
  }
}

// Sigurnosna mreža: bot nikad ne smije zamrznuti igru.
function botFallback(g, seat) {
  const r = g.round;
  try {
    if (r.phase === 'draw') return drawFromStock(g, seat);
    if (r.takeSnapshot) return undoTake(g, seat);
    if (r.hands[seat].length === 1) return closeRound(g, seat, r.hands[seat][0]);
    for (const id of [...r.hands[seat]]) {
      try { return discard(g, seat, id); } catch { /* sljedeća */ }
    }
  } catch (e) {
    console.error('Bot fallback nije uspio:', e);
  }
  return null;
}
