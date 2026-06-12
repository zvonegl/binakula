import React, { useState } from 'react';
import Lobby from './ui/Lobby.jsx';
import Game from './ui/Game.jsx';

export default function App() {
  const [config, setConfig] = useState(null);
  const [gameKey, setGameKey] = useState(0);

  if (!config) return <Lobby onStart={(cfg) => { setConfig(cfg); setGameKey((k) => k + 1); }} />;
  return <Game key={gameKey} config={config} onExit={() => setConfig(null)} />;
}
