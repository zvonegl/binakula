import React from 'react';

export default function RulesModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rules" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Pravila Binakule</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="rules-body">
          <h3>Osnovno</h3>
          <p>Igra se sa 108 karata: dva špila od 52 karte + 4 jokera (svaka karta postoji u dvije kopije).
            Svaki igrač dobiva 19 karata; jedna karta otvara kup za odbacivanje, ostatak je zatvoreni špil.
            U igri za 4 igra se 2 na 2 — partneri sjede nasuprot, dijele rezultat i smiju dodavati na
            partnerove kombinacije. Prvi djelitelj bira se nasumično i dijeli počevši od igrača sa
            svoje desne strane; kad dijeljenje obiđe pun krug i vrati se na njega, smjer se mijenja
            ulijevo (i tako naizmjence).</p>

          <h3>Potez</h3>
          <ol>
            <li><b>Vuci</b> — povuci kartu sa zatvorenog špila ILI uzmi iz otvorenog kupa: odaberi bilo
              koju kartu u kupu i uzimaš nju i <b>sve karte iznad nje</b>. Uvjet: tu najdonju kartu moraš
              <b> odmah izložiti</b> u valjanoj kombinaciji. Ostale uzete karte smiješ zadržati u ruci.</li>
            <li><b>Izloži</b> (neobavezno) — izloži nove kombinacije i/ili dodaj karte na svoje
              (u paru i partnerove) izložene kombinacije. Na protivničke se ne dodaje.</li>
            <li><b>Odbaci</b> — baci točno jednu kartu na vrh otvorenog kupa.</li>
          </ol>

          <h3>Kombinacije (najmanje 3 karte)</h3>
          <ul>
            <li><b>Niz</b>: 3+ uzastopne karte iste boje (♠6-♠7-♠8). As spaja kralja i dvojku,
              pa se niz smije nastaviti preko asa (npr. Q,K,A,2,3).</li>
            <li><b>Tris</b>: 3 ili 4 karte iste oznake, sve <b>različitih boja</b> (npr. 9♥ 9♣ 9♠ 9♦).</li>
            <li><b>BINAKULA</b>: kompletan niz iste boje od asa do asa (A,2,…,K,A — 14 karata).</li>
          </ul>

          <h3>Joker</h3>
          <p>Joker zamjenjuje bilo koju kartu; pri izlaganju se deklarira koju točno kartu
            predstavlja — ali ne smije predstavljati kartu koja je već u toj kombinaciji.
            <b> Otkup</b>: tko ima tu kartu, na svom je potezu polaže na mjesto jokera (s bilo čije
            kombinacije — protivnikove ili partnerove) i uzima joker u ruku. Slaže ga gdje god
            želi, ali ga mora izložiti do kraja istog poteza.</p>

          <h3>Zatvaranje kruga</h3>
          <p>Krug zatvaraš kad sve karte osim jedne izložiš, a zadnju kartu staviš licem prema dolje
            na vrh <b>zatvorenog špila</b> (ne na kup). Ako se špil potroši, kup (osim gornje karte)
            se promiješa u novi špil.</p>

          <h3>Bodovanje</h3>
          <ul>
            <li>Joker = 3 boda · As = 1,5 · 2–6 = 0,5 · 7–K = 1 bod.</li>
            <li>Izloženo = plus; ostalo u ruci = minus (možeš završiti krug u minusu).</li>
            <li><b>Duplo</b>: kombinacija od 6+ karata i tris od 4 karte u 4 različite boje —
              ali samo „čiste” kombinacije: s jokerom nema dupliranja.</li>
            <li>Tko zatvori krug dobiva bonus 10 bodova.</li>
            <li>Zapis je tradicionalni, <b>×10 bez decimala</b>: 22,5 boda piše se „225”.</li>
          </ul>

          <h3>Cilj</h3>
          <p>Bodovi se zbrajaju kroz krugove: 2 igrača do 1500, 3 igrača do 2000, parovi do 3000 (×10 zapis).</p>
        </div>
      </div>
    </div>
  );
}
