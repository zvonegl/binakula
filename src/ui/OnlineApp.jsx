import React, { useState } from 'react';
import { useOnlineRoom } from '../net/useOnlineRoom.js';
import { ONLINE_ENABLED } from '../net/config.js';
import OnlineLobby from './OnlineLobby.jsx';
import Game from './Game.jsx';

const randomCode = () => Array.from({ length: 4 }, () =>
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

export default function OnlineApp({ onExit }) {
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState('');
  const [code, setCode] = useState((params.get('room') || '').toUpperCase());
  const [joined, setJoined] = useState(false);

  // Hook se uvijek poziva; dok nismo "joined", room/name su prazni pa miruje.
  const net = useOnlineRoom({ room: joined ? code : null, name: joined ? name : null });

  if (!ONLINE_ENABLED) {
    return (
      <div className="lobby"><div className="lobby-card">
        <h1 className="lobby-title">Online</h1>
        <p className="lobby-sub">Online server još nije objavljen. Čim postavimo PartyKit, ovdje se igra s prijateljima preko interneta.</p>
        <button className="btn primary big" style={{ width: '100%' }} onClick={onExit}>Natrag</button>
      </div></div>
    );
  }

  // 1) Ulazni ekran: ime + (kreiraj ili upiši kod)
  if (!joined) {
    const enter = (roomCode) => {
      if (!name.trim()) return;
      setCode(roomCode);
      setJoined(true);
    };
    return (
      <div className="lobby"><div className="lobby-card">
        <h1 className="lobby-title">Igraj online</h1>
        <p className="lobby-sub">Napravi stol i pošalji prijateljima kod, ili se pridruži upisom koda.</p>

        <div className="lobby-section">
          <label className="lobby-label">Tvoje ime</label>
          <input className="lobby-input" value={name} maxLength={14}
            placeholder="npr. Zvonimir" onChange={(e) => setName(e.target.value)} />
        </div>

        <button className="btn primary big" style={{ width: '100%' }}
          disabled={!name.trim()} onClick={() => enter(randomCode())}>
          Napravi novi stol
        </button>

        <div className="lobby-or">ili se pridruži</div>
        <div className="join-row">
          <input className="lobby-input" value={code} maxLength={6}
            placeholder="KOD" style={{ textTransform: 'uppercase' }}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <button className="btn" disabled={!name.trim() || code.length < 4} onClick={() => enter(code)}>Pridruži se</button>
        </div>

        <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={onExit}>Natrag</button>
      </div></div>
    );
  }

  const leave = () => { setJoined(false); onExit(); };

  if (net.status === 'closed') {
    return (
      <div className="lobby"><div className="lobby-card">
        <h1 className="lobby-title">Veza prekinuta</h1>
        <p className="lobby-sub">Izgubljena je veza sa serverom. Pokušaj ponovno.</p>
        <button className="btn primary big" style={{ width: '100%' }} onClick={() => setJoined(false)}>Natrag</button>
      </div></div>
    );
  }

  // 1b) Spajanje (Render besplatni server zna "spavati" pa se budi do ~minute)
  if (!net.lobby) {
    return (
      <div className="lobby"><div className="lobby-card">
        <h1 className="lobby-title">Spajanje…</h1>
        <p className="lobby-sub">Povezujem te sa stolom <b>{code}</b>.</p>
        <p className="lobby-hint" style={{ textAlign: 'center' }}>
          Ako je server neko vrijeme mirovao, budi se i to zna potrajati do tridesetak sekundi — samo pričekaj.
        </p>
        <div className="connecting-spinner" />
        <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={leave}>Odustani</button>
      </div></div>
    );
  }

  // 2) Čekaonica dok partija ne krene
  const phase = net.lobby?.phase;
  if (!net.lobby || phase === 'lobby' || !net.view?.round) {
    return (
      <OnlineLobby
        lobby={net.lobby} you={net.you} room={code}
        onConfig={net.setConfig} onStart={net.start} onExit={leave}
      />
    );
  }

  // 3) Igra — Game radi u online načinu, vođen serverom
  return (
    <Game
      online={{
        view: net.view,
        viewerSeat: net.view.youSeat,
        event: net.event,
        error: net.error,
        sendAction: net.sendAction,
        nextRound: net.nextRound,
        isHost: net.lobby.hostId === net.you,
      }}
      onExit={leave}
    />
  );
}
