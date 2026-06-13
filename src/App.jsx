import React, { useState } from 'react';
import Lobby from './ui/Lobby.jsx';
import Game from './ui/Game.jsx';
import OnlineApp from './ui/OnlineApp.jsx';

export default function App() {
  // Ako veza sadrži ?room=, odmah idi na online (prijatelj je kliknuo pozivnicu).
  const hasRoomParam = new URLSearchParams(location.search).has('room');
  const [mode, setMode] = useState(hasRoomParam ? 'online' : null);
  const [config, setConfig] = useState(null);
  const [gameKey, setGameKey] = useState(0);

  if (mode === 'online') return <OnlineApp onExit={() => setMode(null)} />;

  if (mode === 'local') {
    if (!config) return <Lobby onStart={(cfg) => { setConfig(cfg); setGameKey((k) => k + 1); }} onBack={() => setMode(null)} />;
    return <Game key={gameKey} config={config} onExit={() => setConfig(null)} />;
  }

  return (
    <div className="lobby">
      <div className="lobby-card menu-card">
        <h1 className="lobby-title">♠ Binakula ♥</h1>
        <p className="lobby-sub">Dalmatinska kartaška igra — 2 do 4 igrača</p>
        <button className="btn primary big menu-btn" onClick={() => setMode('online')}>
          🌐 Igraj online s prijateljima
        </button>
        <button className="btn big menu-btn" onClick={() => setMode('local')}>
          🤖 Igraj ovdje (botovi / hot-seat)
        </button>
      </div>
    </div>
  );
}
