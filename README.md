# Binakula

Dalmatinska kartaška igra iz porodice remija — kompletna, igriva single-page web aplikacija.
Sve se odvija lokalno u browseru, bez backenda. Za 2, 3 ili 4 igrača (4 = parovi 2 na 2);
mjesta za stolom popunjavaju ljudi (hot-seat na istom uređaju) i/ili botovi u tri težine.

## Pokretanje

Potreban je Node.js (≥ 18) i npm. Ako Node nije na PATH-u, na ovom računalu postoji
portabilna instalacija: `export PATH="$HOME/.local/share/node22/bin:$PATH"`.

```bash
npm install
npm run dev        # razvojni server (Vite) — otvori ispisani localhost URL
npm test           # unit testovi enginea i bota (Vitest)
npm run build      # produkcijski build u dist/
npm run preview    # posluživanje builda
```

## Arhitektura

Game engine je strogo odvojen od UI sloja — čista logika bez DOM-a, unit-testabilna:

```
src/
  engine/
    cards.js    karte (2×52 + 4 jokera), vrijednosti, tradicionalni zapis ×10
    rng.js      deterministički RNG (mulberry32) + Fisher–Yates — reproducibilan seed
    combos.js   validacija kombinacija (niz / tris / BINAKULA) i bodovanje s dupliranjem
    plans.js    pretraga planova: deklaracije jokera, "može li se kup uzeti od indeksa i"
    game.js     tijek igre: dijeljenje, faze poteza, uzimanje kupa, otkup jokera,
                zatvaranje kruga, bodovanje, kraj partije
  bot/
    bot.js      heuristički bot (lagano/srednje/teško): brojanje karata, procjena kupa,
                sigurna odbacivanja, blef, otkup jokera, taktika deklaracije jokera
  ui/           React komponente (lobby, stol, ruka, kup, kombinacije, dijalozi, semafor)
tests/          combos.test.js, game.test.js, bot.test.js (45 testova)
```

Stanje igre je običan objekt; akcije enginea (`drawFromStock`, `takeFromDiscard`, `meldNew`,
`meldAdd`, `redeemJoker`, `discard`, `closeRound`…) ga mutiraju i vraćaju događaj za UI.
Ilegalni potezi bacaju `GameError` s porukom na hrvatskom — UI je prikaže kao toast, pa se
nevaljani potez nikad ne može odigrati. Bodovi se interno vode kao cijeli brojevi u
"desetinkama boda", što se 1:1 poklapa s tradicionalnim zapisom ×10 (22,5 boda → „225”).

Bot je stateless: `nextBotAction(state, seat, difficulty)` vraća jednu sljedeću akciju,
a UI je izvodi s malim zadrškama radi animacija. Testovi simuliraju cijele partije
bot-protiv-bota (sve veličine stola i težine) uz provjeru invarijanti (108 karata, bez duplih).

## Pravila (sažetak je i u igri, gumb „Pravila”)

- 108 karata: dva pokeraška špila + 4 jokera; svaka karta postoji u dvije identične kopije.
- Svatko dobiva 19 karata; jedna karta otvara kup, ostatak je zatvoreni špil.
- Potez: **vuci** (špil ili kup — iz kupa biraš bilo koju kartu i uzimaš nju i sve iznad nje,
  uz uvjet da najdonju odmah izložiš) → **izloži** (neobavezno; u paru i na partnerove
  kombinacije) → **odbaci** jednu kartu.
- Kombinacije ≥ 3 karte: niz iste boje (ciklički — smije preko asa: Q,K,A,2,3), tris = 3 ili 4 karte iste
  oznake **sve različitih boja** (npr. 9♥ 9♣ 9♠ 9♦ — duplikat boje nije dopušten),
  **BINAKULA** = kompletan niz od asa do asa (14 karata iste boje).
- Joker mijenja bilo koju kartu uz deklaraciju, ali **ne smije predstavljati kartu koja
  je već u toj kombinaciji**. Tko ima pravu kartu, na svom je potezu polaže na mjesto
  jokera (s bilo čije kombinacije) i uzima joker u ruku — slaže ga gdje god želi, ali ga
  mora izložiti do kraja istog poteza.
- Izlazak: sve osim jedne karte izloženo, zadnja karta ide licem dolje na zatvoreni špil.
- Bodovi: joker 3 · as 1,5 · 2–6 pola boda · 7–K 1 bod; izloženo plus, ruka minus;
  čiste kombinacije od 6+ karata i čisti tris 4 karte u 4 boje duplo; bonus izlaska 10.
- Cilj (×10 zapis): 1500 (2 igrača) / 2000 (3) / 3000 (4, po paru).

## Odluke o interpretaciji pravila

Tamo gdje izvorna pravila ostavljaju prostor, odabrane su ove varijante (sve su u engineu
na jednom mjestu pa ih je lako promijeniti):

1. **Cilj partije je u tradicionalnom zapisu ×10** (1500 ≈ 7–8 krugova). Polje „Cilj”
   u lobby-ju je slobodno podesivo po partiji.
2. **Meldanje do zadnje karte = zatvaranje.** Engine ne dopušta izlaganje koje bi ruku
   ispraznilo na 0 karata; kad ostane točno jedna, jedini legalan završetak poteza je
   zatvaranje kruga (karta na zatvoreni špil). Odbaciti zadnju kartu na kup nije moguće.
3. **Tris je strogo 3 ili 4 karte različitih boja** (duplikati boje zabranjeni, max 4);
   čisti tris od 4 karte broji se duplo, pa se pravilo „6+ duplo” u praksi odnosi na nizove.
   Joker u trisu zauzima jednu od preostalih boja i ne smije dublirati kartu iz kombinacije.
4. **Niz je ciklički**: as spaja kralja i dvojku, pa je valjano K-A-2 i nastavak preko asa
   (Q,K,A,2,3…). Dva asa u istom nizu ima samo binakula (14 karata). Karte kombinacije
   uvijek stoje pravilno poslagane: najniža dolje, više prema gore, joker na svom mjestu.
5. **Otkup jokera dopušten je iz bilo čije kombinacije** (svoje, partnerove ili protivničke),
   uvijek na vlastitom potezu, u fazi izlaganja. Otkupljeni joker ulazi u ruku i slobodno se
   kombinira, ali se mora izložiti do kraja istog poteza (odbacivanje je dotad blokirano);
   otkup je zato dopušten samo kad se joker ima kamo izložiti.
6. **Najdonja karta uzeta iz kupa** smije se izložiti i kao nova kombinacija i dodavanjem na
   postojeću kombinaciju vlastite strane; legalnost se provjerava već pri odabiru u kupu
   (nelegalan „dokle” se ne može potvrditi). Dok najdonja karta nije izložena, odbacivanje je
   blokirano; klikom „Poništi uzimanje” potez se vraća (sve uzete karte ionako su bile javne).
7. **Kad se špil potroši**, otvoreni kup osim gornje karte se promiješa u novi zatvoreni špil
   (deterministički, istim RNG-om partije).
8. U 4 igrača **parovi su mjesta 1+3 i 2+4** (nasuprot); kombinacije i bodovi vode se po paru.
9. **Smjer igre**: prvi djelitelj bira se nasumično (deterministički iz seeda) i dijeli počevši
   od igrača sa svoje desne strane; igra teče udesno. Kad dijeljenje obiđe pun krug i vrati se
   na prvog djelitelja, smjer se mijenja ulijevo — i tako naizmjence svaki puni krug.

## Botovi

- **Lagano**: gleda samo vrh kupa, izlaže sve odmah, ne mari za protivnika.
- **Srednje**: skenira kup (ograničena dubina), izbjegava odbaciti kartu koja očito igra
  protivniku (proširenja njihovih kombinacija, javno uzete karte), ponekad blefira.
- **Teško**: puno skeniranje kupa s procjenom dobitka, broji viđene karte, drži jaku ruku
  za zatvaranje a slabu izlaže rano da smanji minus, blefira odbacivanjem karte čiju kopiju
  drži, jokere deklarira kao karte čije su obje kopije već viđene (protivnik ih ne može
  otkupiti), otkupljuje jokere kad god ima zamjensku kartu i mjesto za joker.
