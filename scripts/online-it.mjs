// Integracijski test online igre: spaja DVA stvarna klijenta na pokrenuti
// PartyKit dev server (ws://127.0.0.1:1999), odigra nekoliko sinkroniziranih
// poteza i provjeri da je skrivanje tuđih karata ispravno. Izlaz 0 = prolaz.

import { PartySocket } from 'partysocket';
import { MSG, isHiddenId } from '../src/net/protocol.js';

const HOST = process.env.IT_HOST || '127.0.0.1:1999';
const ROOM = 'it-' + Math.random().toString(36).slice(2, 8);
const log = (...a) => console.log(...a);
const fail = (m) => { console.error('✗ PAD:', m); process.exit(1); };

function client(name) {
  const sock = new PartySocket({ host: HOST, room: ROOM, party: 'main' });
  const c = { name, sock, you: null, lobby: null, view: null, events: [] };
  sock.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.type === MSG.WELCOME) c.you = m.you;
    else if (m.type === MSG.LOBBY) c.lobby = m.lobby;
    else if (m.type === MSG.STATE) c.view = m.view;
    else if (m.type === MSG.EVENT) c.events.push(m.event);
    else if (m.type === MSG.ERROR) c.lastError = m.message;
  });
  return c;
}

const send = (c, type, extra = {}) => c.sock.send(JSON.stringify({ type, ...extra }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); }
  return false;
}

async function main() {
  const A = client('Ana');
  await until(() => A.you) || fail('A nije dobio WELCOME');
  send(A, MSG.JOIN, { name: 'Ana' });
  send(A, MSG.SET_CONFIG, { numPlayers: 2, seats: [{ type: 'human' }, { type: 'human' }], target: 2000 });
  await until(() => A.lobby && A.lobby.numPlayers === 2) || fail('lobi se nije ažurirao');

  const B = client('Bruno');
  await until(() => B.you) || fail('B nije dobio WELCOME');
  send(B, MSG.JOIN, { name: 'Bruno' });
  await until(() => A.lobby && A.lobby.seats[1].connected) || fail('B nije sjeo na sjedalo 1');
  log('✓ lobi: oba igrača za stolom');

  send(A, MSG.START, { seed: 123 });
  await until(() => A.view && B.view) || fail('partija nije započela / nema STATE');
  log('✓ partija započela, oba dobila stanje');

  // skrivanje karata
  if (!A.view.round.hands[0].every((id) => !isHiddenId(id))) fail('A ne vidi svoje karte');
  if (!A.view.round.hands[1].every((id) => isHiddenId(id))) fail('A vidi TUĐE karte!');
  if (!B.view.round.hands[1].every((id) => !isHiddenId(id))) fail('B ne vidi svoje karte');
  if (!B.view.round.hands[0].every((id) => isHiddenId(id))) fail('B vidi TUĐE karte!');
  if (A.view.round.hands[1].length !== 19) fail('broj tuđih karata nije točan');
  log('✓ skrivanje karata ispravno (svatko vidi samo svoje, broj tuđih točan)');

  // odigraj jedan potez igrača na potezu
  const turn = A.view.round.turn;
  const cur = turn === 0 ? A : B;
  const other = turn === 0 ? B : A;
  const discardLenBefore = cur.view.round.discard.length;
  send(cur, MSG.ACTION, { action: { type: 'drawStock' } });
  await until(() => cur.view.round.phase === 'meld') || fail('vučenje nije prošlo');
  const hand = cur.view.round.hands[turn];
  send(cur, MSG.ACTION, { action: { type: 'discard', cardId: hand[0] } });
  await until(() => other.view && other.view.round.discard.length === discardLenBefore + 1)
    || fail('odbacivanje se nije sinkroniziralo kod drugog igrača');
  log('✓ potez (vuci+odbaci) sinkroniziran kod oba igrača');

  // potez izvan reda se odbija: 'cur' je upravo odbacio pa je sada izvan reda
  cur.lastError = null;
  send(cur, MSG.ACTION, { action: { type: 'drawStock' } });
  await until(() => cur.lastError) || fail('potez izvan reda nije odbijen');
  log('✓ potez izvan reda je odbijen:', JSON.stringify(cur.lastError));

  log('\n✓✓ SVE PROŠLO — online jezgra radi preko mreže.');
  A.sock.close(); B.sock.close();
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
