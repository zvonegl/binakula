// PartyKit omotač oko RoomSession (zadržano za eventualnu kasniju upotrebu).
// Sva logika sobe je u src/net/session.js; ovdje je samo transport.

import { RoomSession } from '../src/net/session.js';

export default class BinakulaServer {
  constructor(party) {
    this.party = party;
    this.session = new RoomSession(party.id.slice(0, 6).toUpperCase(), {
      send: (connId, obj) => this.party.getConnection(connId)?.send(JSON.stringify(obj)),
      broadcast: (obj) => this.party.broadcast(JSON.stringify(obj)),
      connIds: () => [...this.party.getConnections()].map((c) => c.id),
    });
  }

  onConnect(conn) { this.session.welcome(conn.id); }
  onClose(conn) { this.session.close(conn.id); }
  onMessage(raw, sender) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    this.session.message(sender.id, msg);
  }
}
