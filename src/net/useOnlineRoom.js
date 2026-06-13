// React hook za vezu sa sobom na PartyKit serveru. Drži lobi, redigirani
// pogled na partiju i događaje; izlaže funkcije za slanje poteza.

import { useEffect, useRef, useState, useCallback } from 'react';
import { PartySocket } from 'partysocket';
import { MSG } from './protocol.js';
import { PARTY_HOST } from './config.js';

export function useOnlineRoom({ room, name }) {
  const sockRef = useRef(null);
  const [you, setYou] = useState(null);
  const [lobby, setLobby] = useState(null);
  const [view, setView] = useState(null);
  const [event, setEvent] = useState(null);   // { event, seq } — za animacije
  const [error, setError] = useState(null);    // { msg, key }
  const [status, setStatus] = useState('connecting'); // connecting | open | closed

  useEffect(() => {
    if (!room || !name || !PARTY_HOST) return undefined;
    const sock = new PartySocket({ host: PARTY_HOST, room, party: 'main' });
    sockRef.current = sock;
    let seq = 0;

    const onOpen = () => {
      setStatus('open');
      sock.send(JSON.stringify({ type: MSG.JOIN, name }));
    };
    const onMessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      switch (m.type) {
        case MSG.WELCOME: setYou(m.you); break;
        case MSG.LOBBY: setLobby(m.lobby); break;
        case MSG.STATE: setView(m.view); break;
        case MSG.EVENT: seq += 1; setEvent({ event: m.event, seq }); break;
        case MSG.ERROR: setError({ msg: m.message, key: Date.now() }); break;
        default: break;
      }
    };
    const onClose = () => setStatus('closed');
    const onError = () => setStatus('closed');

    sock.addEventListener('open', onOpen);
    sock.addEventListener('message', onMessage);
    sock.addEventListener('close', onClose);
    sock.addEventListener('error', onError);
    return () => {
      sock.removeEventListener('open', onOpen);
      sock.removeEventListener('message', onMessage);
      sock.removeEventListener('close', onClose);
      sock.removeEventListener('error', onError);
      sock.close();
    };
  }, [room, name]);

  const send = useCallback((type, extra = {}) => {
    sockRef.current?.send(JSON.stringify({ type, ...extra }));
  }, []);

  return {
    you, lobby, view, event, error, status,
    setConfig: useCallback((cfg) => send(MSG.SET_CONFIG, cfg), [send]),
    start: useCallback((seed) => send(MSG.START, { seed }), [send]),
    sendAction: useCallback((action) => send(MSG.ACTION, { action }), [send]),
    nextRound: useCallback(() => send(MSG.NEXT_ROUND, {}), [send]),
  };
}
