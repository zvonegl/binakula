import React, { useState } from 'react';
import { seedFromString } from '../engine/rng.js';

const DEFAULT_TARGETS = { 2: 1500, 3: 2000, 4: 3000 };
const PAIR_OF_SEAT = ['Par 1', 'Par 2', 'Par 1', 'Par 2'];

export default function Lobby({ onStart }) {
  const [num, setNum] = useState(2);
  const [seats, setSeats] = useState([
    { name: 'Igrač 1', type: 'human', difficulty: 'medium' },
    { name: 'Bot 2', type: 'bot', difficulty: 'medium' },
    { name: 'Bot 3', type: 'bot', difficulty: 'medium' },
    { name: 'Bot 4', type: 'bot', difficulty: 'medium' },
  ]);
  const [target, setTarget] = useState('');
  const [seedText, setSeedText] = useState('');

  const update = (i, patch) =>
    setSeats((s) => s.map((seat, j) => (j === i ? { ...seat, ...patch } : seat)));

  const start = () => {
    const players = seats.slice(0, num).map((s, i) => ({
      name: s.name.trim() || `Igrač ${i + 1}`,
      type: s.type,
      difficulty: s.difficulty,
    }));
    const cfg = { players };
    const t = parseInt(target, 10);
    if (!Number.isNaN(t) && t > 0) cfg.target = t;
    if (seedText.trim()) cfg.seed = seedFromString(seedText.trim());
    onStart(cfg);
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="lobby-title">♠ Binakula ♥</h1>
        <p className="lobby-sub">Dalmatinska kartaška igra iz porodice remija — 108 karata, 2–4 igrača</p>

        <div className="lobby-section">
          <label className="lobby-label">Broj igrača</label>
          <div className="num-picker">
            {[2, 3, 4].map((n) => (
              <button key={n} className={`num-btn ${num === n ? 'active' : ''}`} onClick={() => setNum(n)}>
                {n}
              </button>
            ))}
          </div>
          {num === 4 && (
            <p className="lobby-hint">Igra se 2 na 2: mjesta 1 i 3 su Par 1, mjesta 2 i 4 su Par 2 (partneri sjede nasuprot).</p>
          )}
        </div>

        <div className="lobby-section">
          <label className="lobby-label">Za stolom</label>
          {seats.slice(0, num).map((s, i) => (
            <div className="seat-row" key={i}>
              <span className="seat-no">
                {i + 1}.{num === 4 && <span className={`pair-dot pair-${i % 2}`} title={PAIR_OF_SEAT[i]} />}
              </span>
              <input
                className="seat-name"
                value={s.name}
                maxLength={14}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <select
                value={s.type}
                onChange={(e) => update(i, {
                  type: e.target.value,
                  name: /^(Igrač|Bot) \d$/.test(s.name)
                    ? `${e.target.value === 'bot' ? 'Bot' : 'Igrač'} ${i + 1}` : s.name,
                })}
              >
                <option value="human">Čovjek</option>
                <option value="bot">Bot</option>
              </select>
              {s.type === 'bot' ? (
                <select value={s.difficulty} onChange={(e) => update(i, { difficulty: e.target.value })}>
                  <option value="easy">lagano</option>
                  <option value="medium">srednje</option>
                  <option value="hard">teško</option>
                </select>
              ) : (
                <span className="seat-filler" />
              )}
            </div>
          ))}
          <p className="lobby-hint">Više ljudi za istim uređajem? Nema problema — između poteza uređaj se predaje sljedećem igraču.</p>
        </div>

        <div className="lobby-section lobby-row2">
          <div>
            <label className="lobby-label">Cilj (bodovi ×10)</label>
            <input
              className="lobby-input"
              placeholder={String(DEFAULT_TARGETS[num])}
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div>
            <label className="lobby-label">Seed (neobavezno)</label>
            <input
              className="lobby-input"
              placeholder="za ponovljivo miješanje"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
            />
          </div>
        </div>

        <button className="btn primary big" onClick={start}>Podijeli karte</button>
      </div>
    </div>
  );
}
