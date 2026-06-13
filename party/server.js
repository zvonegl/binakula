// PartyKit server — tanki omotač oko GameRoom-a. Jedna "soba" = jedna partija.
// Sva logika je u src/net/room.js; ovdje se samo prosljeđuju poruke i šalju
// redigirani pogledi svakom igraču.

import { GameRoom } from '../src/net/room.js';
import { MSG } from '../src/net/protocol.js';

const BOT_DELAY = 850;      // pauza između bot-poteza (osjećaj "razmišljanja")
const NEXT_ROUND_DELAY = 7000; // koliko sažetak kruga stoji prije novog dijeljenja

export default class BinakulaServer {
  constructor(party) {
    this.party = party;
    this.room = new GameRoom(party.id.slice(0, 6).toUpperCase());
    this.names = new Map();   // conn.id → ime (iz JOIN poruke)
    this.botTimer = null;
    this.roundTimer = null;
  }

  onConnect(conn) {
    conn.send(JSON.stringify({ type: MSG.WELCOME, you: conn.id, roomCode: this.room.code }));
    this.sendLobby();
  }

  onClose(conn) {
    this.room.removeMember(conn.id);
    this.names.delete(conn.id);
    this.broadcastAll();
  }

  onMessage(raw, sender) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case MSG.JOIN: {
        this.names.set(sender.id, msg.name);
        this.room.addMember(sender.id, msg.name);
        this.broadcastAll();
        break;
      }
      case MSG.SET_CONFIG: {
        this.room.setConfig(sender.id, msg);
        this.sendLobby();
        break;
      }
      case MSG.START: {
        if (this.room.start(sender.id, msg.seed)) {
          this.broadcastAll();
          this.pumpBots();
        } else {
          sender.send(JSON.stringify({ type: MSG.ERROR, message: 'Nije moguće započeti (provjeri da su sva mjesta popunjena).' }));
        }
        break;
      }
      case MSG.ACTION: {
        const res = this.room.applyMemberAction(sender.id, msg.action);
        if (!res.ok) {
          sender.send(JSON.stringify({ type: MSG.ERROR, message: res.error }));
          return;
        }
        this.broadcastEvent();
        this.broadcastAll();
        this.afterTurn();
        break;
      }
      case MSG.NEXT_ROUND: {
        if (this.room.nextRound(sender.id)) {
          clearTimeout(this.roundTimer);
          this.broadcastAll();
          this.pumpBots();
        }
        break;
      }
      case MSG.CHAT: {
        const m = this.room.members.get(sender.id);
        this.party.broadcast(JSON.stringify({ type: MSG.CHAT_MSG, from: m?.name || 'Igrač', text: String(msg.text || '').slice(0, 200) }));
        break;
      }
      default: break;
    }
  }

  // Nakon poteza: pokreni botove ili, ako je krug gotov, zakaži novi.
  afterTurn() {
    if (this.room.phase !== 'playing') return;
    if (this.room.game.round.closed) {
      if (!this.room.game.gameOver) {
        clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(() => {
          if (this.room.advanceRound()) { this.broadcastAll(); this.pumpBots(); }
        }, NEXT_ROUND_DELAY);
      }
      return;
    }
    this.pumpBots();
  }

  // Odigraj bot-poteze s pauzom dok ne dođe red na čovjeka (ili kraj kruga).
  pumpBots() {
    clearTimeout(this.botTimer);
    if (this.room.phase !== 'playing') return;
    const r = this.room.game.round;
    if (r.closed || !this.room.isBotSeat(r.turn)) return;
    this.botTimer = setTimeout(() => {
      const ev = this.room.stepBot();
      if (ev) this.broadcastEvent();
      this.broadcastAll();
      this.afterTurn();
    }, BOT_DELAY);
  }

  // ---- slanje ----------------------------------------------------------

  sendLobby() {
    const payload = JSON.stringify({ type: MSG.LOBBY, lobby: this.room.lobbyView() });
    for (const conn of this.party.getConnections()) conn.send(payload);
  }

  broadcastState() {
    for (const conn of this.party.getConnections()) {
      const view = this.room.viewForMember(conn.id);
      conn.send(JSON.stringify({ type: MSG.STATE, view }));
    }
  }

  broadcastEvent() {
    const event = this.room.eventView();
    if (!event) return;
    this.party.broadcast(JSON.stringify({ type: MSG.EVENT, event }));
  }

  broadcastAll() {
    this.sendLobby();
    if (this.room.game) this.broadcastState();
  }
}
