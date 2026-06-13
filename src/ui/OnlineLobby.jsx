import React from 'react';

const DIFF_LABEL = { easy: 'lagano', medium: 'srednje', hard: 'teško' };

// Čekaonica online sobe: kod za pozvati prijatelje, popis mjesta i (za hosta)
// postavke + gumb za početak.
export default function OnlineLobby({ lobby, you, room, onConfig, onStart, onExit }) {
  const isHost = lobby && lobby.hostId === you;
  const seats = lobby?.seats || [];
  const shareUrl = `${location.origin}${location.pathname}?room=${room}`;

  const canStart = seats.length > 0 &&
    seats.every((s) => s.type === 'bot' || (s.type === 'human' && s.connected));

  function setNum(n) {
    const next = Array.from({ length: n }, (_, i) => seats[i] || { type: i === 0 ? 'human' : 'bot', difficulty: 'medium' });
    onConfig({ numPlayers: n, seats: next.map((s) => ({ type: s.type, difficulty: s.difficulty })) });
  }
  function setSeat(i, patch) {
    const next = seats.map((s, j) => (j === i ? { ...s, ...patch } : { type: s.type, difficulty: s.difficulty }));
    onConfig({ seats: next });
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="lobby-title">Online stol</h1>

        <div className="room-code-box">
          <div className="room-code-label">Kod sobe — podijeli ga prijateljima</div>
          <div className="room-code">{room}</div>
          <div className="room-share">
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(room)}>Kopiraj kod</button>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(shareUrl)}>Kopiraj vezu</button>
          </div>
        </div>

        <div className="lobby-section">
          <label className="lobby-label">Za stolom</label>
          {seats.map((s, i) => (
            <div className="seat-row" key={i}>
              <span className="seat-no">{i + 1}.</span>
              <span className={`seat-online-name ${s.type === 'human' && !s.connected ? 'waiting' : ''}`}>
                {s.type === 'bot' ? `🤖 Bot (${DIFF_LABEL[s.difficulty]})`
                  : s.connected ? `👤 ${s.name}` : '… čeka igrača'}
              </span>
              {isHost && (
                <>
                  <select value={s.type} disabled={s.type === 'human' && s.connected}
                    onChange={(e) => setSeat(i, { type: e.target.value })}>
                    <option value="human">Čovjek</option>
                    <option value="bot">Bot</option>
                  </select>
                  {s.type === 'bot' && (
                    <select value={s.difficulty} onChange={(e) => setSeat(i, { difficulty: e.target.value })}>
                      <option value="easy">lagano</option>
                      <option value="medium">srednje</option>
                      <option value="hard">teško</option>
                    </select>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {isHost ? (
          <>
            <div className="lobby-section">
              <label className="lobby-label">Broj igrača</label>
              <div className="num-picker">
                {[2, 3, 4].map((n) => (
                  <button key={n} className={`num-btn ${lobby.numPlayers === n ? 'active' : ''}`} onClick={() => setNum(n)}>{n}</button>
                ))}
              </div>
              {lobby.numPlayers === 4 && <p className="lobby-hint">Igra se 2 na 2 — partneri sjede nasuprot (mjesta 1+3 i 2+4).</p>}
            </div>
            <button className="btn primary big" disabled={!canStart} onClick={() => onStart()}>
              {canStart ? 'Počni partiju' : 'Čeka se da se popune mjesta…'}
            </button>
          </>
        ) : (
          <p className="lobby-hint" style={{ textAlign: 'center', fontSize: 15 }}>
            Čeka se da domaćin pokrene partiju…
          </p>
        )}
        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={onExit}>Napusti sobu</button>
      </div>
    </div>
  );
}
