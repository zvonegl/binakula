// RoomSession — orkestracija jedne sobe neovisna o transportu (PartyKit ili ws).
// Drži GameRoom + tajmere (botovi, sljedeći krug) i šalje poruke preko zadanog
// "transporta": { send(connId, obj), broadcast(obj), connIds() }.

import { GameRoom } from './room.js';
import { MSG } from './protocol.js';

const BOT_DELAY = 850;          // pauza između bot-poteza
const NEXT_ROUND_DELAY = 7000;  // koliko sažetak kruga stoji prije novog dijeljenja

export class RoomSession {
  constructor(code, transport) {
    this.room = new GameRoom(code);
    this.tx = transport;
    this.botTimer = null;
    this.roundTimer = null;
  }

  get empty() { return this.room.members.size === 0; }

  welcome(connId) {
    this.tx.send(connId, { type: MSG.WELCOME, you: connId, roomCode: this.room.code });
    this.sendLobby();
  }

  close(connId) {
    this.room.removeMember(connId);
    this.broadcastAll();
  }

  message(connId, msg) {
    switch (msg.type) {
      case MSG.JOIN:
        this.room.addMember(connId, msg.name);
        this.broadcastAll();
        break;
      case MSG.SET_CONFIG:
        this.room.setConfig(connId, msg);
        this.sendLobby();
        break;
      case MSG.START:
        if (this.room.start(connId, msg.seed)) { this.broadcastAll(); this.pumpBots(); }
        else this.tx.send(connId, { type: MSG.ERROR, message: 'Nije moguće započeti (provjeri da su sva mjesta popunjena).' });
        break;
      case MSG.ACTION: {
        const res = this.room.applyMemberAction(connId, msg.action);
        if (!res.ok) { this.tx.send(connId, { type: MSG.ERROR, message: res.error }); return; }
        this.broadcastEvent();
        this.broadcastAll();
        this.afterTurn();
        break;
      }
      case MSG.NEXT_ROUND:
        if (this.room.nextRound(connId)) { clearTimeout(this.roundTimer); this.broadcastAll(); this.pumpBots(); }
        break;
      case MSG.CHAT: {
        const m = this.room.members.get(connId);
        this.tx.broadcast({ type: MSG.CHAT_MSG, from: m?.name || 'Igrač', text: String(msg.text || '').slice(0, 200) });
        break;
      }
      default: break;
    }
  }

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

  dispose() {
    clearTimeout(this.botTimer);
    clearTimeout(this.roundTimer);
  }

  // ---- slanje ----------------------------------------------------------

  sendLobby() {
    const payload = { type: MSG.LOBBY, lobby: this.room.lobbyView() };
    for (const id of this.tx.connIds()) this.tx.send(id, payload);
  }

  broadcastState() {
    for (const id of this.tx.connIds()) {
      this.tx.send(id, { type: MSG.STATE, view: this.room.viewForMember(id) });
    }
  }

  broadcastEvent() {
    const event = this.room.eventView();
    if (event) this.tx.broadcast({ type: MSG.EVENT, event });
  }

  broadcastAll() {
    this.sendLobby();
    if (this.room.game) this.broadcastState();
  }
}
