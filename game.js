'use strict';

const SUITS     = ['♠', '♥', '♦', '♣'];
const RANKS     = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const BET_STEP  = 50;
const START_BAL = 1000;
const MAX_SPLIT = 4;

let state = {};

// ── State factories ──────────────────────────────────────────────────────────

function freshState() {
  return {
    balance: START_BAL,
    deck: buildDeck(),
    dealer: { cards: [] },
    dealerHidden: null,
    slots: [newSlot(), newSlot(), newSlot()],
    playQueue: [],
    playPos: 0,
    phase: 'betting',
  };
}

function newSlot() {
  return { originalBet: 0, subHands: [], active: false };
}

function newSubHand(bet, splitAces = false) {
  return { cards: [], bet, status: 'playing', isNatural: false, splitAces, result: null };
}

// ── Deck ─────────────────────────────────────────────────────────────────────

function buildDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard() {
  if (state.deck.length < 15) state.deck = buildDeck();
  return state.deck.pop();
}

// ── Hand value ────────────────────────────────────────────────────────────────

function calcValue(cards) {
  let val = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 'A')                         { val += 11; aces++; }
    else if (['J','Q','K'].includes(c.rank))    { val += 10; }
    else                                         { val += parseInt(c.rank); }
  }
  while (val > 21 && aces > 0) { val -= 10; aces--; }
  return val;
}

function isNatural(cards) {
  if (cards.length !== 2) return false;
  return cards.some(c => c.rank === 'A') &&
         cards.some(c => ['10','J','Q','K'].includes(c.rank));
}

// ── Betting ───────────────────────────────────────────────────────────────────

function adjustBet(slotIdx, delta) {
  if (state.phase !== 'betting') return;
  const slot = state.slots[slotIdx];
  const otherBets = state.slots.reduce((s, sl, i) => i !== slotIdx ? s + sl.originalBet : s, 0);
  const maxBet = state.balance - otherBets;
  let next = slot.originalBet + delta;
  next = Math.max(0, Math.min(next, maxBet));
  next = Math.round(next / BET_STEP) * BET_STEP;
  slot.originalBet = next;
  slot.active = next > 0;
  render();
}

// ── Deal ──────────────────────────────────────────────────────────────────────

function dealAll() {
  if (!state.slots.some(s => s.active)) return;
  state.phase = 'playing';

  // Deduct bets and init sub-hands
  for (const slot of state.slots) {
    if (!slot.active) continue;
    state.balance -= slot.originalBet;
    slot.subHands = [newSubHand(slot.originalBet)];
  }

  // Deal: first card to each slot, dealer up-card, second card to each slot, dealer hole card
  for (const slot of state.slots) if (slot.active) slot.subHands[0].cards.push(drawCard());
  state.dealer.cards = [drawCard()];
  for (const slot of state.slots) if (slot.active) slot.subHands[0].cards.push(drawCard());
  state.dealerHidden = drawCard();

  // Check naturals
  for (const slot of state.slots) {
    if (!slot.active) continue;
    const sh = slot.subHands[0];
    if (isNatural(sh.cards)) { sh.isNatural = true; sh.status = 'natural'; }
  }

  // Build play queue — skip natural-blackjack hands
  state.playQueue = [];
  for (let i = 0; i < 3; i++) {
    if (state.slots[i].active && state.slots[i].subHands[0].status !== 'natural')
      state.playQueue.push({ slotIdx: i, subIdx: 0 });
  }
  state.playPos = 0;

  if (state.playQueue.length === 0) dealerTurn();
  else render();
}

// ── Queue helpers ─────────────────────────────────────────────────────────────

function currentEntry()   { return state.playQueue[state.playPos] || null; }
function currentSubHand() {
  const e = currentEntry();
  return e ? state.slots[e.slotIdx].subHands[e.subIdx] : null;
}

function advanceQueue() {
  state.playPos++;
  if (state.playPos >= state.playQueue.length) dealerTurn();
}

// ── Player actions ────────────────────────────────────────────────────────────

function hit() {
  const sh = currentSubHand();
  if (!sh || sh.status !== 'playing') return;
  sh.cards.push(drawCard());
  const v = calcValue(sh.cards);
  if (v > 21)     { sh.status = 'bust';  advanceQueue(); }
  else if (v === 21) { sh.status = 'stood'; advanceQueue(); }
  render();
}

function stand() {
  const sh = currentSubHand();
  if (!sh || sh.status !== 'playing') return;
  sh.status = 'stood';
  advanceQueue();
  render();
}

function doubleDown() {
  const sh = currentSubHand();
  if (!sh || sh.status !== 'playing' || sh.cards.length !== 2) return;
  if (state.balance < sh.bet) return;
  state.balance -= sh.bet;
  sh.bet *= 2;
  sh.cards.push(drawCard());
  sh.status = calcValue(sh.cards) > 21 ? 'bust' : 'stood';
  advanceQueue();
  render();
}

function split() {
  const entry = currentEntry();
  if (!entry) return;
  const slot = state.slots[entry.slotIdx];
  const sh   = currentSubHand();
  if (!sh || sh.status !== 'playing' || sh.cards.length !== 2) return;
  if (sh.cards[0].rank !== sh.cards[1].rank) return;
  if (state.balance < slot.originalBet) return;
  if (slot.subHands.length >= MAX_SPLIT) return;

  state.balance -= slot.originalBet;
  const aces = sh.cards[0].rank === 'A';

  // Move second card to new sub-hand
  const newSH = newSubHand(slot.originalBet, aces);
  newSH.cards  = [sh.cards.pop()];
  sh.cards.push(drawCard());
  newSH.cards.push(drawCard());

  if (aces) {
    sh.splitAces  = true;
    sh.status     = 'stood';
    newSH.status  = 'stood';
  }

  const newSubIdx = entry.subIdx + 1;
  slot.subHands.splice(newSubIdx, 0, newSH);

  // Shift queue indices for this slot that fall after the insertion point
  for (let i = state.playPos + 1; i < state.playQueue.length; i++) {
    if (state.playQueue[i].slotIdx === entry.slotIdx &&
        state.playQueue[i].subIdx  >= newSubIdx)
      state.playQueue[i].subIdx++;
  }

  if (!aces) {
    state.playQueue.splice(state.playPos + 1, 0, { slotIdx: entry.slotIdx, subIdx: newSubIdx });
  }

  if (sh.status === 'stood') advanceQueue();
  render();
}

// ── Dealer turn ───────────────────────────────────────────────────────────────

function dealerTurn() {
  state.phase = 'dealer';
  state.dealer.cards.push(state.dealerHidden);
  state.dealerHidden = null;
  while (calcValue(state.dealer.cards) < 17) state.dealer.cards.push(drawCard());
  payout();
}

// ── Payout ────────────────────────────────────────────────────────────────────

function payout() {
  state.phase = 'payout';
  const dVal     = calcValue(state.dealer.cards);
  const dBust    = dVal > 21;
  const dNatural = isNatural(state.dealer.cards);

  for (const slot of state.slots) {
    if (!slot.active) continue;
    for (const sh of slot.subHands) {
      if (sh.status === 'bust') { sh.result = 'lost'; continue; }
      const hVal = calcValue(sh.cards);

      if (sh.isNatural) {
        if (dNatural) {
          sh.result = 'push';
          state.balance += sh.bet;
        } else {
          sh.result = 'blackjack';
          state.balance += Math.floor(sh.bet * 2.5);  // 3:2 payout
        }
        continue;
      }

      if (dBust || hVal > dVal)     { sh.result = 'won';  state.balance += sh.bet * 2; }
      else if (hVal === dVal)       { sh.result = 'push'; state.balance += sh.bet; }
      else                          { sh.result = 'lost'; }
    }
  }

  if (state.balance <= 0) state.phase = 'gameover';
  render();
}

// ── New round ─────────────────────────────────────────────────────────────────

function newRound() {
  const prev = state.slots.map(s => s.originalBet);
  state.phase       = 'betting';
  state.dealer      = { cards: [] };
  state.dealerHidden = null;
  state.playQueue   = [];
  state.playPos     = 0;
  state.slots       = [newSlot(), newSlot(), newSlot()];

  // Restore previous bets where affordable
  let rem = state.balance;
  for (let i = 0; i < 3; i++) {
    if (prev[i] > 0 && prev[i] <= rem) {
      state.slots[i].originalBet = prev[i];
      state.slots[i].active      = true;
      rem -= prev[i];
    }
  }
  render();
}

function restart() {
  state = freshState();
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────

function cardHTML(card, faceDown = false) {
  if (faceDown) return '<div class="card card-back"></div>';
  const red = card.suit === '♥' || card.suit === '♦';
  return `<div class="card ${red ? 'red' : 'black'}"><span class="cr">${card.rank}</span><span class="cs">${card.suit}</span></div>`;
}

function valueLabel(val) {
  return val > 21 ? `<span class="v-bust">${val}</span>` : String(val);
}

function resultBadge(r) {
  const labels = { won: 'WIN', lost: 'LOSE', push: 'PUSH', blackjack: 'BLACKJACK!' };
  const cls    = { won: 'r-won', lost: 'r-lost', push: 'r-push', blackjack: 'r-bj' };
  return r ? `<span class="${cls[r]}">${labels[r]}</span>` : '';
}

function render() {
  // Balance
  document.getElementById('balance-display').textContent =
    `Balance: $${state.balance.toLocaleString()}`;

  // Dealer cards
  let dHTML = state.dealer.cards.map(c => cardHTML(c)).join('');
  if (state.dealerHidden) dHTML += cardHTML(null, true);
  document.getElementById('dealer-cards').innerHTML = dHTML;

  // Dealer value
  const dvEl = document.getElementById('dealer-value');
  if (state.dealer.cards.length > 0) {
    const shown = calcValue(state.dealer.cards);
    dvEl.innerHTML = state.dealerHidden
      ? `Value: ${shown} + <span class="v-hidden">?</span>`
      : `Value: ${valueLabel(shown)}`;
  } else {
    dvEl.textContent = '';
  }

  // Status message
  const sm = document.getElementById('status-message');
  if      (state.phase === 'betting') sm.textContent = 'Place your bets!';
  else if (state.phase === 'playing') {
    const e = currentEntry();
    sm.textContent = e ? `Hand ${e.slotIdx + 1} — your turn` : '';
  }
  else if (state.phase === 'dealer') sm.textContent = "Dealer's turn…";
  else if (state.phase === 'payout') sm.textContent = 'Round over!';
  else sm.textContent = '';

  // Slots
  for (let i = 0; i < 3; i++) renderSlot(i);

  // Buttons
  const anyBet = state.slots.some(s => s.originalBet > 0);
  const dealBtn = document.getElementById('deal-btn');
  const nextBtn = document.getElementById('next-btn');
  dealBtn.classList.toggle('hidden', state.phase !== 'betting');
  dealBtn.disabled = !anyBet;
  nextBtn.classList.toggle('hidden', state.phase !== 'payout');

  // Game over overlay
  document.getElementById('game-over').classList.toggle('hidden', state.phase !== 'gameover');
}

function renderSlot(i) {
  const slot    = state.slots[i];
  const el      = document.getElementById(`slot-${i}`);
  const cardsEl = el.querySelector('.slot-cards');
  const valueEl = el.querySelector('.slot-value');
  const betEl   = el.querySelector('.slot-bet');
  const actEl   = el.querySelector('.slot-actions');
  const resEl   = el.querySelector('.slot-result');
  const betCtrl = el.querySelector('.bet-controls');
  const betAmt  = el.querySelector('.bet-amount');
  const minusBtn= el.querySelector('.bet-minus');
  const plusBtn = el.querySelector('.bet-plus');

  el.classList.remove('slot-current', 'slot-empty');

  // ── Betting phase ──
  if (state.phase === 'betting') {
    betCtrl.classList.remove('hidden');
    cardsEl.innerHTML = '';
    valueEl.innerHTML = '';
    betEl.textContent = '';
    actEl.innerHTML   = '';
    resEl.innerHTML   = '';
    betAmt.textContent = `$${slot.originalBet}`;
    const otherBets = state.slots.reduce((s, sl, j) => j !== i ? s + sl.originalBet : s, 0);
    plusBtn.disabled  = (slot.originalBet + BET_STEP) > (state.balance - otherBets);
    minusBtn.disabled = slot.originalBet <= 0;
    if (!slot.active) el.classList.add('slot-empty');
    return;
  }

  betCtrl.classList.add('hidden');

  if (!slot.active) {
    cardsEl.innerHTML = '';
    valueEl.innerHTML = '';
    betEl.textContent = '';
    actEl.innerHTML   = '';
    resEl.innerHTML   = '';
    el.classList.add('slot-empty');
    return;
  }

  // ── Cards, values, results ──
  let cHTML = '', vHTML = '', rHTML = '';
  for (let si = 0; si < slot.subHands.length; si++) {
    const sh = slot.subHands[si];
    if (si > 0) cHTML += '<span class="split-sep">|</span>';
    cHTML += sh.cards.map(c => cardHTML(c)).join('');
    vHTML += `<span>${valueLabel(calcValue(sh.cards))}</span>`;
    if (sh.result) rHTML += resultBadge(sh.result);
  }
  cardsEl.innerHTML = cHTML;
  valueEl.innerHTML = vHTML;
  resEl.innerHTML   = rHTML;
  betEl.textContent = `Bet: $${slot.subHands.reduce((s, sh) => s + sh.bet, 0)}`;

  // ── Action buttons for current hand ──
  actEl.innerHTML = '';
  const entry     = currentEntry();
  const isCurrent = entry && entry.slotIdx === i;

  if (state.phase === 'playing' && isCurrent) {
    el.classList.add('slot-current');
    const sh = slot.subHands[entry.subIdx];
    if (sh && sh.status === 'playing') {
      const canDouble = sh.cards.length === 2 && state.balance >= sh.bet;
      const canSplit  = sh.cards.length === 2 &&
                        sh.cards[0].rank === sh.cards[1].rank &&
                        state.balance >= slot.originalBet &&
                        slot.subHands.length < MAX_SPLIT;

      const actions = [
        ['Hit',    hit],
        ['Stand',  stand],
        ...(canDouble ? [['Double', doubleDown]] : []),
        ...(canSplit  ? [['Split',  split]]      : []),
      ];

      for (const [label, fn] of actions) {
        const b = document.createElement('button');
        b.textContent = label;
        b.className   = 'action-btn';
        b.onclick     = fn;
        actEl.appendChild(b);
      }
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  state = freshState();

  for (let i = 0; i < 3; i++) {
    const el = document.getElementById(`slot-${i}`);
    el.querySelector('.bet-minus').onclick = () => adjustBet(i, -BET_STEP);
    el.querySelector('.bet-plus').onclick  = () => adjustBet(i, +BET_STEP);
  }

  document.getElementById('deal-btn').onclick    = dealAll;
  document.getElementById('next-btn').onclick    = newRound;
  document.getElementById('restart-btn').onclick = restart;

  render();
});
