import React from 'react';
import { RANK_LABELS, SUIT_SYMBOLS, RED_SUITS } from '../engine/cards.js';

export default function CardView({
  card, jokerAs = null, faceDown = false, size = 'md',
  selected = false, highlight = false, dimmed = false,
  onClick, style, dragProps = {},
}) {
  const cls = ['card', size];
  if (selected) cls.push('selected');
  if (highlight) cls.push('highlight');
  if (dimmed) cls.push('dimmed');
  if (onClick) cls.push('clickable');

  if (faceDown || !card) {
    cls.push('back');
    return <div className={cls.join(' ')} style={style} onClick={onClick} {...dragProps} />;
  }

  if (card.joker) {
    cls.push('joker');
    const asRed = jokerAs && RED_SUITS.has(jokerAs.suit);
    return (
      <div className={cls.join(' ')} style={style} onClick={onClick} {...dragProps}>
        {jokerAs && (
          // Kut s kartom koju joker predstavlja — vidljiv i kad je karta u stogu.
          <div className={`corner tl ${asRed ? 'red' : 'black'}`}>
            <span>{RANK_LABELS[jokerAs.rank]}</span>
            <span>{SUIT_SYMBOLS[jokerAs.suit]}</span>
          </div>
        )}
        {jokerAs && <div className="joker-mini-star">★</div>}
        <div className="joker-star">★</div>
        <div className="joker-word">JOKER</div>
        {jokerAs && (
          <div className={`joker-as ${asRed ? 'red' : 'black'}`}>
            = {SUIT_SYMBOLS[jokerAs.suit]}{RANK_LABELS[jokerAs.rank]}
          </div>
        )}
      </div>
    );
  }

  cls.push(RED_SUITS.has(card.suit) ? 'red' : 'black');
  return (
    <div className={cls.join(' ')} style={style} onClick={onClick} {...dragProps}>
      <div className="corner tl">
        <span>{RANK_LABELS[card.rank]}</span>
        <span>{SUIT_SYMBOLS[card.suit]}</span>
      </div>
      <div className="pip">{SUIT_SYMBOLS[card.suit]}</div>
      <div className="corner br">
        <span>{RANK_LABELS[card.rank]}</span>
        <span>{SUIT_SYMBOLS[card.suit]}</span>
      </div>
    </div>
  );
}
