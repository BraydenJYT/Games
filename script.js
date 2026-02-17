// Texas Hold'em with bots, betting, blinds, bank, and real-ish hand eval.
// Not a casino simulator. Just enough to be fun and not totally fake lol.

const SB = 10;
const BB = 20;
const BOT_COUNT = 3;
const START_BANK = 2000;

const LS_KEY = "holdem_bank_v1";

// ---------- deck ----------
class Deck {
  constructor(){ this.reset(); }
  reset(){
    const suits = ["Hearts","Diamonds","Clubs","Spades"];
    const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    this.cards = [];
    for (const s of suits) for (const r of ranks) this.cards.push({rank:r, suit:s});
    this.shuffle();
  }
  shuffle(){
    for (let i=this.cards.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
  draw(){
    if (!this.cards.length) throw new Error("Deck empty");
    return this.cards.pop();
  }
  remaining(){ return this.cards.length; }
}

function isRed(s){ return s==="Hearts" || s==="Diamonds"; }
function sym(s){
  return s==="Hearts"?"♥":s==="Diamonds"?"♦":s==="Clubs"?"♣":"♠";
}
function makeCardEl(card, opts={}){
  const el = document.createElement("div");
  el.className = "card" + (isRed(card.suit) ? " red":"");
  if (opts.faceDown){
    el.innerHTML = `<div class="big">🂠</div><div class="small">Hidden</div>`;
    return el;
  }
  el.innerHTML = `<div class="big">${card.rank} ${sym(card.suit)}</div><div class="small">${card.suit}</div>`;
  return el;
}

// ---------- UI refs ----------
const communityEl = document.getElementById("community");
const seatsEl = document.getElementById("seats");
const potEl = document.getElementById("pot");
const toCallEl = document.getElementById("toCall");
const minRaiseEl = document.getElementById("minRaise");
const stageInfoEl = document.getElementById("stageInfo");
const dealerInfoEl = document.getElementById("dealerInfo");
const handInfoEl = document.getElementById("handInfo");
const yourBankEl = document.getElementById("yourBank");
const yourBetEl = document.getElementById("yourBet");
const msgEl = document.getElementById("msg");

document.getElementById("sbVal").textContent = SB;
document.getElementById("bbVal").textContent = BB;
document.getElementById("botCount").textContent = BOT_COUNT;

const newHandBtn = document.getElementById("newHandBtn");
const nextBtn = document.getElementById("nextBtn");
const resetBankBtn = document.getElementById("resetBankBtn");
const foldBtn = document.getElementById("foldBtn");
const callBtn = document.getElementById("callBtn");
const raiseBtn = document.getElementById("raiseBtn");
const raiseAmtEl = document.getElementById("raiseAmt");

// ---------- game state ----------
const deck = new Deck();

const STAGES = ["Preflop","Flop","Turn","River","Showdown"];

let g = null;

function loadBank(){
  const raw = localStorage.getItem(LS_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : START_BANK;
}
function saveBank(n){ localStorage.setItem(LS_KEY, String(n)); }

function setMsg(t){ msgEl.textContent = t; }

// players: seat 0 = You
function makePlayers(){
  const players = [];
  const yourBank = loadBank();
  players.push({
    id:0, name:"You", bank: yourBank, hole:[], bet:0,
    folded:false, allIn:false, isBot:false
  });
  for (let i=1; i<=BOT_COUNT; i++){
    players.push({
      id:i, name:`Bot ${i}`, bank: START_BANK, hole:[], bet:0,
      folded:false, allIn:false, isBot:true
    });
  }
  return players;
}

function newGameHand(){
  deck.reset();

  g = {
    handNo: (g?.handNo ?? 0) + 1,
    stageIndex: 0,
    community: [],
    pot: 0,
    players: makePlayers(),
    dealer: (g?.dealer ?? -1),
    acting: 0,
    toActCount: 0,
    currentBet: 0,
    minRaise: BB,
    lastAggressor: null,
    settled: false
  };

  // rotate dealer
  g.dealer = (g.dealer + 1) % g.players.length;

  // reset per-hand
  for (const p of g.players){
    p.hole = [deck.draw(), deck.draw()];
    p.bet = 0;
    p.folded = false;
    p.allIn = false;
  }

  // post blinds
  const sbSeat = nextSeat(g.dealer);
  const bbSeat = nextSeat(sbSeat);

  postBlind(sbSeat, SB);
  postBlind(bbSeat, BB);

  g.currentBet = BB;
  g.minRaise = BB;

  // preflop first to act = seat after big blind
  g.acting = nextSeat(bbSeat);
  g.settled = false;

  renderAll();
  setMsg("New hand dealt. Try not to go broke in 30 seconds.");
  runBotsUntilHumanOrSettled();
}

function nextSeat(i){
  const n = g.players.length;
  for (let step=1; step<=n; step++){
    const j = (i + step) % n;
    if (!g.players[j].folded && !g.players[j].allIn && g.players[j].bank > 0) return j;
    // if bank==0 but not allIn? treat as can't act, but this is rare. still skip.
    if (!g.players[j].folded && g.players[j].allIn) continue;
  }
  return i;
}

function activePlayers(){
  return g.players.filter(p => !p.folded);
}

function postBlind(seat, amt){
  const p = g.players[seat];
  const pay = Math.min(amt, p.bank);
  p.bank -= pay;
  p.bet += pay;
  if (p.bank === 0) p.allIn = true;
  g.pot += pay;
}

function maxBet(){
  return Math.max(...g.players.map(p => p.bet));
}

function toCallFor(seat){
  const p = g.players[seat];
  return Math.max(0, maxBet() - p.bet);
}

function isBettingSettled(){
  const m = maxBet();
  const actives = activePlayers();
  // settled if everyone active is either all-in OR has bet == m
  return actives.every(p => p.allIn || p.bet === m);
}

// ---------- betting actions ----------
function doFold(seat){
  const p = g.players[seat];
  p.folded = true;
  if (activePlayers().length === 1){
    // award pot immediately
    const winner = activePlayers()[0];
    winner.bank += g.pot;
    if (!winner.isBot) saveBank(winner.bank);
    setMsg(`${winner.name} wins (everyone folded). Brutal.`);
    g.stageIndex = 4; // Showdown-ish
    g.settled = true;
  }
}

function doCallOrCheck(seat){
  const p = g.players[seat];
  const need = toCallFor(seat);
  if (need <= 0) return; // check
  const pay = Math.min(need, p.bank);
  p.bank -= pay;
  p.bet += pay;
  g.pot += pay;
  if (p.bank === 0) p.allIn = true;
}

function doRaise(seat, raiseTo){
  const p = g.players[seat];
  const m = maxBet();
  const minTo = m + g.minRaise;

  const target = Math.max(minTo, raiseTo);
  const wantPutIn = target - p.bet;
  const pay = Math.min(wantPutIn, p.bank);

  p.bank -= pay;
  p.bet += pay;
  g.pot += pay;

  if (p.bank === 0) p.allIn = true;

  // only count as raise if it actually increased maxBet
  if (p.bet > m){
    g.currentBet = p.bet;
    g.lastAggressor = seat;
    // minRaise becomes amount increased (classic no-limit-ish rule)
    g.minRaise = Math.max(BB, p.bet - m);
  }
}

function advanceActing(){
  if (g.settled) return;

  if (activePlayers().length === 1){
    g.settled = true;
    renderAll();
    return;
  }

  if (isBettingSettled()){
    // move to next street
    nextStreetOrShowdown();
    return;
  }

  g.acting = nextSeat(g.acting);
}

function endBettingRoundCleanup(){
  // in a real game bets move to pot already; we tracked pot live, so just reset bets.
  for (const p of g.players) p.bet = 0;
  g.currentBet = 0;
  g.minRaise = BB;
  g.lastAggressor = null;
}

function nextStreetOrShowdown(){
  // reset for next street
  endBettingRoundCleanup();

  if (activePlayers().length === 1){
    g.settled = true;
    renderAll();
    return;
  }

  if (g.stageIndex === 0){
    // flop
    g.stageIndex = 1;
    g.community.push(deck.draw(), deck.draw(), deck.draw());
  } else if (g.stageIndex === 1){
    g.stageIndex = 2;
    g.community.push(deck.draw());
  } else if (g.stageIndex === 2){
    g.stageIndex = 3;
    g.community.push(deck.draw());
  } else if (g.stageIndex === 3){
    g.stageIndex = 4; // showdown
    settleShowdown();
    g.settled = true;
    renderAll();
    return;
  }

  // first to act postflop = seat after dealer (small blind position)
  g.acting = nextSeat(g.dealer);
  renderAll();
  setMsg(`${STAGES[g.stageIndex]}: betting time. Try not to panic.`);
  runBotsUntilHumanOrSettled();
}

function settleShowdown(){
  const contenders = activePlayers();
  const board = g.community;

  // evaluate each
  let best = null;
  for (const p of contenders){
    const score = eval7([...p.hole, ...board]);
    p._score = score;
    if (!best || compareScore(score, best._score) > 0) best = p;
  }

  // handle ties
  const winners = contenders.filter(p => compareScore(p._score, best._score) === 0);

  const share = Math.floor(g.pot / winners.length);
  const remainder = g.pot - share * winners.length;

  winners.forEach((p, idx) => {
    p.bank += share + (idx === 0 ? remainder : 0);
    if (!p.isBot) saveBank(p.bank);
  });

  const winNames = winners.map(w=>w.name).join(", ");
  const handName = scoreToName(best._score);
  setMsg(`Showdown: ${winNames} wins with ${handName}.`);
}

// ---------- bots ----------
function botAction(seat){
  const p = g.players[seat];
  if (p.folded || p.allIn) return;

  const need = toCallFor(seat);
  const stage = STAGES[g.stageIndex];

  // cheap "strength" estimate:
  let strength = 0.0;

  if (g.stageIndex === 0){
    // preflop: pocket quality
    const r1 = rankVal(p.hole[0].rank);
    const r2 = rankVal(p.hole[1].rank);
    const hi = Math.max(r1,r2), lo = Math.min(r1,r2);
    const pair = r1 === r2;
    const suited = p.hole[0].suit === p.hole[1].suit;

    strength = (hi/14)*0.55 + (lo/14)*0.25 + (pair?0.35:0) + (suited?0.08:0);
  } else {
    // postflop: use actual current best category
    const score = eval7([...p.hole, ...g.community]);
    const cat = score[0]; // 0..8
    strength = cat / 8;   // 0..1
    // little kicker bump
    strength += (score[1] ?? 0) / 14 * 0.08;
  }

  // randomness so it's not a calculator
  strength += (Math.random() - 0.5) * 0.18;
  strength = Math.max(0, Math.min(1, strength));

  // decision
  const m = maxBet();
  const canRaise = p.bank > need + g.minRaise;

  // fold some trash when facing a bet
  if (need > 0 && strength < 0.25 && Math.random() < 0.55){
    doFold(seat);
    return;
  }

  // call/check mostly
  if (!canRaise || strength < 0.62 || Math.random() < 0.65){
    doCallOrCheck(seat);
    return;
  }

  // raise
  const base = m + g.minRaise;
  const extra = Math.floor((strength * 3) * BB);
  const target = base + extra;
  doRaise(seat, target);
}

function runBotsUntilHumanOrSettled(){
  if (!g || g.settled) return;

  // loop safety
  let steps = 0;

  while (!g.settled && steps < 200){
    const seat = g.acting;
    const p = g.players[seat];

    // if human's turn, stop
    if (!p.isBot && !p.folded && !p.allIn && p.bank >= 0){
      renderAll();
      return;
    }

    // bots act
    if (p.isBot && !p.folded && !p.allIn){
      botAction(seat);
    }

    // after action, check settle or move turn
    if (!g.settled && isBettingSettled()){
      nextStreetOrShowdown();
      // nextStreetOrShowdown calls render and then loops back into bots
      steps++;
      continue;
    }

    if (!g.settled) g.acting = nextSeat(seat);
    steps++;
  }

  renderAll();
}

// ---------- player buttons ----------
function ensureHand(){
  if (!g){ setMsg("Hit New Hand first. Like… c’mon."); return false; }
  if (g.settled){ setMsg("Hand is over. Start a new one."); return false; }
  const you = g.players[0];
  if (you.folded){ setMsg("You folded. You don’t get to un-fold. That's life."); return false; }
  return true;
}

foldBtn.addEventListener("click", () => {
  if (!ensureHand()) return;
  if (g.acting !== 0){ setMsg("Not your turn."); return; }
  doFold(0);
  g.acting = nextSeat(0);
  renderAll();
  if (!g.settled) {
    if (isBettingSettled()) nextStreetOrShowdown();
    else runBotsUntilHumanOrSettled();
  } else {
    saveBank(g.players[0].bank);
    renderAll();
  }
});

callBtn.addEventListener("click", () => {
  if (!ensureHand()) return;
  if (g.acting !== 0){ setMsg("Not your turn."); return; }
  doCallOrCheck(0);
  g.acting = nextSeat(0);
  renderAll();
  if (isBettingSettled()) nextStreetOrShowdown();
  else runBotsUntilHumanOrSettled();
});

raiseBtn.addEventListener("click", () => {
  if (!ensureHand()) return;
  if (g.acting !== 0){ setMsg("Not your turn."); return; }

  const you = g.players[0];
  const m = maxBet();
  const minTo = m + g.minRaise;
  let want = Number(raiseAmtEl.value);

  if (!Number.isFinite(want) || want <= 0) {
    setMsg("Raise amount is busted. Put a number.");
    return;
  }

  // interpret input as "raise TO" if >= minTo, else treat as "raise by"
  if (want < minTo) want = minTo;

  const need = toCallFor(0);
  if (you.bank <= need){
    setMsg("You can’t raise. You're basically all-in or broke.");
    return;
  }

  doRaise(0, want);
  g.acting = nextSeat(0);
  renderAll();
  if (isBettingSettled()) nextStreetOrShowdown();
  else runBotsUntilHumanOrSettled();
});

newHandBtn.addEventListener("click", () => newGameHand());

nextBtn.addEventListener("click", () => {
  if (!g){ setMsg("No hand yet."); return; }
  if (!g.settled){
    setMsg("Finish betting first. You can’t teleport to river, sorry.");
    return;
  }
  newGameHand();
});

resetBankBtn.addEventListener("click", () => {
  saveBank(START_BANK);
  if (g) g.players[0].bank = START_BANK;
  renderAll();
  setMsg("Bank reset. Enjoy your temporary wealth.");
});

// ---------- render ----------
function renderAll(){
  if (!g){
    yourBankEl.textContent = loadBank();
    yourBetEl.textContent = "0";
    potEl.textContent = "0";
    toCallEl.textContent = "0";
    minRaiseEl.textContent = String(BB);
    stageInfoEl.textContent = "Stage: —";
    dealerInfoEl.textContent = "Dealer: —";
    handInfoEl.textContent = "Hand: —";
    communityEl.innerHTML = "";
    seatsEl.innerHTML = "";
    return;
  }

  handInfoEl.textContent = `Hand: ${g.handNo}`;
  stageInfoEl.textContent = `Stage: ${STAGES[g.stageIndex]}`;
  dealerInfoEl.textContent = `Dealer: ${g.players[g.dealer].name}`;

  communityEl.innerHTML = "";
  g.community.forEach(c => communityEl.appendChild(makeCardEl(c)));

  potEl.textContent = String(g.pot);

  const toCall = toCallFor(0);
  toCallEl.textContent = String(toCall);
  minRaiseEl.textContent = String(maxBet() + g.minRaise);

  yourBankEl.textContent = String(g.players[0].bank);
  yourBetEl.textContent = String(g.players[0].bet);

  seatsEl.innerHTML = "";
  g.players.forEach((p, idx) => {
    const seat = document.createElement("div");
    seat.className = "seat";

    const acting = (!g.settled && g.acting === idx) ? " • ACTING" : "";
    const flags = [
      idx === g.dealer ? "Dealer" : null,
      p.folded ? "Folded" : null,
      p.allIn ? "All-in" : null
    ].filter(Boolean);

    const head = document.createElement("div");
    head.className = "seathead";
    head.innerHTML = `
      <div class="name">${p.name}${acting}</div>
      <div class="meta">Bank: ${p.bank} • Bet: ${p.bet}</div>
    `;

    const cards = document.createElement("div");
    cards.className = "cards";

    // hide opponent cards until showdown; always show yours
    const hide = (idx !== 0) && (STAGES[g.stageIndex] !== "Showdown") && !g.settled;
    const showDownNow = (STAGES[g.stageIndex] === "Showdown") || g.settled;

    p.hole.forEach(c => {
      // If opponent folded, keep them hidden (they don't get revealed in many casual games)
      const facedown = (idx !== 0) && !showDownNow;
      const alsoHideIfFolded = (idx !== 0) && p.folded;
      cards.appendChild(makeCardEl(c, { faceDown: facedown || alsoHideIfFolded }));
    });

    const badgeWrap = document.createElement("div");
    badgeWrap.className = "badges";
    flags.forEach(f => {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = f;
      badgeWrap.appendChild(b);
    });

    // show winner hand name for you at showdown (and bots too)
    if (showDownNow && !p.folded && p._score){
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = scoreToName(p._score);
      badgeWrap.appendChild(b);
    }

    seat.appendChild(head);
    seat.appendChild(cards);
    seat.appendChild(badgeWrap);
    seatsEl.appendChild(seat);
  });
}

// ---------- hand evaluation (best 5 out of 7) ----------
// Score format: array [category, t1, t2, ...] category 0..8 higher better
// compare lexicographically.
const RV = { "2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14 };
function rankVal(r){ return RV[r]; }

function compareScore(a,b){
  const n = Math.max(a.length,b.length);
  for (let i=0; i<n; i++){
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function scoreToName(score){
  const cat = score[0];
  return [
    "High Card","One Pair","Two Pair","Three of a Kind","Straight",
    "Flush","Full House","Four of a Kind","Straight Flush"
  ][cat] ?? "—";
}

function eval7(cards7){
  // generate all 5-card combos from 7 (21 combos)
  let best = null;
  const n = cards7.length;
  for (let a=0; a<n-4; a++)
    for (let b=a+1; b<n-3; b++)
      for (let c=b+1; c<n-2; c++)
        for (let d=c+1; d<n-1; d++)
          for (let e=d+1; e<n; e++){
            const five = [cards7[a], cards7[b], cards7[c], cards7[d], cards7[e]];
            const s = eval5(five);
            if (!best || compareScore(s,best) > 0) best = s;
          }
  return best;
}

function eval5(cards){
  const ranks = cards.map(c => rankVal(c.rank)).sort((x,y)=>y-x);
  const suits = cards.map(c => c.suit);

  // counts
  const countMap = new Map();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);

  const counts = [...countMap.entries()]
    .map(([r,c]) => ({r, c}))
    .sort((a,b) => (b.c - a.c) || (b.r - a.r)); // by count then rank

  const isFlush = suits.every(s => s === suits[0]);
  const straightHigh = straightHighCard(ranks);

  // Straight Flush
  if (isFlush && straightHigh){
    return [8, straightHigh];
  }

  // Quads
  if (counts[0].c === 4){
    const quad = counts[0].r;
    const kicker = counts.find(x=>x.c===1).r;
    return [7, quad, kicker];
  }

  // Full house
  if (counts[0].c === 3 && counts[1].c === 2){
    return [6, counts[0].r, counts[1].r];
  }

  // Flush
  if (isFlush){
    return [5, ...ranks];
  }

  // Straight
  if (straightHigh){
    return [4, straightHigh];
  }

  // Trips
  if (counts[0].c === 3){
    const trip = counts[0].r;
    const kickers = counts.filter(x=>x.c===1).map(x=>x.r).sort((a,b)=>b-a);
    return [3, trip, ...kickers];
  }

  // Two pair
  if (counts[0].c === 2 && counts[1].c === 2){
    const highPair = Math.max(counts[0].r, counts[1].r);
    const lowPair  = Math.min(counts[0].r, counts[1].r);
    const kicker = counts.find(x=>x.c===1).r;
    return [2, highPair, lowPair, kicker];
  }

  // One pair
  if (counts[0].c === 2){
    const pair = counts[0].r;
    const kickers = counts.filter(x=>x.c===1).map(x=>x.r).sort((a,b)=>b-a);
    return [1, pair, ...kickers];
  }

  // High card
  return [0, ...ranks];
}

function straightHighCard(sortedRanksDesc){
  // sorted desc, but can contain duplicates
  const uniq = [...new Set(sortedRanksDesc)].sort((a,b)=>b-a);

  // wheel straight (A 5 4 3 2) => treat as 5-high
  const wheel = [14,5,4,3,2];
  if (wheel.every(v => uniq.includes(v))) return 5;

  for (let i=0; i<=uniq.length-5; i++){
    const run = uniq.slice(i,i+5);
    if (run[0]-run[4] === 4){
      // ensure consecutive
      let ok = true;
      for (let j=0; j<4; j++) if (run[j] - run[j+1] !== 1) ok = false;
      if (ok) return run[0];
    }
  }
  return 0;
}

// ---------- init ----------
renderAll();
setMsg("Hit New Hand to start. Or stare at the screen dramatically. Either works.");
