import React from 'react';
import { seatsOfSide } from '../engine/game.js';
import { formatReal } from '../engine/cards.js';

export function sideName(g, side) {
  const seats = seatsOfSide(g, side);
  const names = seats.map((s) => g.config.players[s].name);
  return g.nPlayers === 4 ? `Par ${side + 1} (${names.join(' & ')})` : names[0];
}

export default function Scoreboard({ g, onClose }) {
  const sides = Array.from({ length: g.nSides }, (_, i) => i);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal scoreboard" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Semafor</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <p className="score-legend" title="22,5 boda zapisuje se kao 225">
          Tradicionalni zapis: bodovi ×10, bez decimalnog zareza (22,5 → „225”). Cilj: <b>{g.config.target}</b>.
        </p>
        <table className="score-table">
          <thead>
            <tr>
              <th>Krug</th>
              {sides.map((s) => (
                <th key={s} className={`side-${s}`}>{sideName(g, s)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.scores.length === 0 && (
              <tr><td colSpan={1 + g.nSides} className="score-empty">Još nema odigranih krugova.</td></tr>
            )}
            {g.scores.map((row, i) => (
              <tr key={i}>
                <td>{i + 1}.</td>
                {sides.map((s) => (
                  <td key={s} title={`${formatReal(row.perSide[s])} bodova`}>
                    {row.perSide[s]}
                    {row.closerSide === s && <span className="closer-star" title="zatvorio krug"> ★</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Ukupno</td>
              {sides.map((s) => (
                <td key={s} title={`${formatReal(g.totals[s])} bodova`}><b>{g.totals[s]}</b></td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
