// Samostalni WebSocket server za online Binakulu (za Render i sl.).
// Više soba; svaka soba = jedna RoomSession. Klijent (partysocket) spaja se na
// putanju /parties/main/<KOD>, a stabilan id veze dolazi iz upita ?_pk=<id>.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { RoomSession } from '../src/net/session.js';

const PORT = process.env.PORT || 1999;
const sessions = new Map(); // KOD → { session, conns: Map<id, ws> }

function getSession(code) {
  let s = sessions.get(code);
  if (!s) {
    const entry = { conns: new Map(), session: null };
    entry.session = new RoomSession(code, {
      send: (id, obj) => { const ws = entry.conns.get(id); if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
      broadcast: (obj) => { const p = JSON.stringify(obj); for (const ws of entry.conns.values()) if (ws.readyState === 1) ws.send(p); },
      connIds: () => [...entry.conns.keys()],
    });
    sessions.set(code, entry);
    s = entry;
  }
  return s;
}

const server = http.createServer((req, res) => {
  // jednostavna provjera zdravlja (Render je koristi)
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Binakula online server radi.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['parties','main','<KOD>']
  const code = decodeURIComponent(parts[2] || 'LOBBY').toUpperCase().slice(0, 6);
  const id = url.searchParams.get('_pk') || Math.random().toString(36).slice(2, 12);

  const entry = getSession(code);
  // Ako se isti id ponovo spaja (npr. nakon osvježenja), zamijeni staru vezu.
  entry.conns.set(id, ws);
  entry.session.welcome(id);

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    entry.session.message(id, msg);
  });

  ws.on('close', () => {
    // Ukloni samo ako veza nije već zamijenjena novom istom id-om.
    if (entry.conns.get(id) === ws) {
      entry.conns.delete(id);
      entry.session.close(id);
      if (entry.conns.size === 0) { entry.session.dispose(); sessions.delete(code); }
    }
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`Binakula WebSocket server sluša na portu ${PORT}`);
});
