export type Stage = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'settled';
export type Move = 'fold' | 'check' | 'call' | 'raise' | 'allin';
export interface Player {
  id: string; name: string; seat: number; chips: number; ready: boolean; leaving: boolean;
  connected: boolean; offlineAt: number | null; pendingChips: number;
  cards: number[]; inHand: boolean; folded: boolean; bet: number; total: number;
  actedAt: number | null; label: string;
}
export interface Payout { amount: number; winners: string[]; label: string }
export interface Game {
  room: string; host: string; version: number; hand: number; initial: number; small: number; big: number;
  players: Player[]; stage: Stage; dealer: number; actor: string | null; board: number[]; deck: number[];
  currentBet: number; minRaise: number; deadline: number | null; nextHandAt: number | null;
  running: boolean; payouts: Payout[]; message: string;
}
export type PublicPlayer = Omit<Player, 'cards' | 'actedAt' | 'offlineAt'> & { cards: (number | null)[] };
export interface View extends Omit<Game, 'deck' | 'players'> { players: PublicPlayer[]; me: string; legal: { call: number; min: number; max: number; canRaise: boolean } | null }
export function requireThat(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export function int(n: unknown, min: number, max: number): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max; }
export function newGame(room: string, initial: number, small: number, big: number): Game {
  requireThat(int(initial, 20, 1000000) && int(small, 1, 10000) && int(big, small * 2, 20000) && initial >= big * 2, '筹码或盲注设置不正确');
  return { room, host: '', version: 0, hand: 0, initial, small, big, players: [], stage: 'waiting', dealer: -1, actor: null, board: [], deck: [], currentBet: 0, minRaise: big, deadline: null, nextHandAt: null, running: false, payouts: [], message: '等待至少两位玩家准备' };
}
export function addPlayer(g: Game, id: string, name: string, now: number) {
  requireThat(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 16, '昵称需为 1–16 个字符');
  requireThat(g.players.length < 9, '房间已满（最多 9 人）');
  const seat = Array.from({length: 9}, (_, i) => i).find(i => !g.players.some(p => p.seat === i))!;
  g.players.push({ id, name: name.trim(), seat, chips: g.initial, ready: false, leaving: false, connected: false, offlineAt: now, pendingChips: 0, cards: [], inHand: false, folded: false, bet: 0, total: 0, actedAt: null, label: '未准备' });
  if (!g.host) g.host = id;
}
export function shuffledDeck(): number[] {
  const deck = Array.from({length: 52}, (_, i) => i);
  const buffer = new Uint32Array(1);
  for (let i = 51; i > 0; i--) {
    const range = i + 1, limit = Math.floor(0x100000000 / range) * range;
    do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
    const j = buffer[0] % range; [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function active(g: Game) { return g.stage !== 'waiting' && g.stage !== 'settled'; }
function ordered(g: Game, after: number, predicate: (p: Player) => boolean): Player[] {
  return g.players.filter(predicate).sort((a, b) => ((a.seat - after + 8) % 9) - ((b.seat - after + 8) % 9));
}
function pay(p: Player, amount: number) { const n = Math.min(p.chips, amount); p.chips -= n; p.bet += n; p.total += n; }
export function prepareBetweenHands(g: Game) {
  g.players = g.players.filter(p => !p.leaving);
  for (const p of g.players) { p.chips += p.pendingChips; p.pendingChips = 0; }
  if (!g.players.some(p => p.id === g.host)) g.host = g.players.find(p => p.connected)?.id ?? g.players[0]?.id ?? '';
}
export function start(g: Game, now: number, deck = shuffledDeck()) {
  requireThat(!active(g), '本手尚未结束');
  prepareBetweenHands(g);
  const playing = g.players.filter(p => p.ready && p.connected && p.chips > 0);
  if (playing.length < 2) { g.stage = 'waiting'; g.running = false; g.actor = null; g.deadline = null; g.nextHandAt = null; g.message = '人数不足，等待至少两位玩家准备'; return; }
  g.running = true; g.hand++; g.stage = 'preflop'; g.deck = [...deck]; g.board = []; g.payouts = []; g.nextHandAt = null;
  g.dealer = ordered(g, g.dealer, p => playing.includes(p))[0].seat;
  for (const p of g.players) { p.inHand = playing.includes(p); p.folded = false; p.bet = 0; p.total = 0; p.actedAt = null; p.cards = []; p.label = p.inHand ? '' : '等待下一手'; }
  for (let i = 0; i < 2; i++) for (const p of ordered(g, g.dealer, p => p.inHand)) p.cards.push(g.deck.pop()!);
  const sb = playing.length === 2 ? playing.find(p => p.seat === g.dealer)! : ordered(g, g.dealer, p => p.inHand)[0];
  const bb = ordered(g, sb.seat, p => p.inHand)[0];
  pay(sb, g.small); pay(bb, g.big); sb.label = '小盲'; bb.label = '大盲';
  g.currentBet = g.big; g.minRaise = g.big; g.message = `第 ${g.hand} 手 · 翻牌前`;
  advance(g, bb.seat, now);
}
function contenders(g: Game) { return g.players.filter(p => p.inHand && !p.folded); }
function needs(g: Game, p: Player) { return p.inHand && !p.folded && p.chips > 0 && (p.actedAt === null || p.bet < g.currentBet); }
function advance(g: Game, after: number, now: number) {
  if (contenders(g).length === 1) { settle(g, now); return; }
  const funded = contenders(g).filter(p => p.chips > 0);
  if (funded.length === 1) g.currentBet = Math.max(...contenders(g).map(p => p.bet));
  const next = ordered(g, after, p => needs(g, p))[0];
  if (next && !(funded.length === 1 && next.bet >= g.currentBet)) { g.actor = next.id; g.deadline = now + 30000; return; }
  if (g.stage === 'river') { settle(g, now); return; }
  g.deck.pop(); // burn one card
  if (g.stage === 'preflop') { g.stage = 'flop'; g.board.push(g.deck.pop()!, g.deck.pop()!, g.deck.pop()!); }
  else { g.stage = g.stage === 'flop' ? 'turn' : 'river'; g.board.push(g.deck.pop()!); }
  g.currentBet = 0; g.minRaise = g.big;
  for (const p of g.players) { p.bet = 0; p.actedAt = null; }
  g.message = {flop:'翻牌',turn:'转牌',river:'河牌'}[g.stage];
  advance(g, g.dealer, now);
}
export function legal(g: Game, p: Player) {
  return { call: Math.min(p.chips, Math.max(0, g.currentBet - p.bet)), min: g.currentBet + g.minRaise, max: p.bet + p.chips,
    canRaise: (p.actedAt === null || g.currentBet - p.actedAt >= g.minRaise) && p.bet + p.chips > g.currentBet && contenders(g).some(q => q.id !== p.id && q.chips > 0) };
}
export function act(g: Game, id: string, move: Move, target: unknown, now: number) {
  requireThat(active(g) && g.actor === id, '尚未轮到你行动');
  const p = g.players.find(p => p.id === id)!;
  const l = legal(g, p);
  if (move === 'fold') { p.folded = true; p.label = '弃牌'; }
  else if (move === 'check') { requireThat(p.bet >= g.currentBet, '必须跟注或弃牌'); p.label = '过牌'; }
  else if (move === 'call') { requireThat(l.call > 0, '当前可以过牌'); pay(p, l.call); p.label = p.chips === 0 ? '全下' : '跟注'; }
  else if (move === 'raise' || move === 'allin') {
    const amount = move === 'allin' ? l.max : target;
    requireThat(int(amount, 1, l.max), '加注金额无效');
    if (amount <= g.currentBet) { requireThat(move === 'allin', '加注必须高于当前下注'); pay(p, p.chips); }
    else {
      requireThat(l.canRaise, '不足额加注尚未重新开放你的加注权');
      requireThat(amount >= l.min || amount === l.max, `最小加注至 ${l.min}`);
      const increase = amount - g.currentBet;
      if (increase >= g.minRaise) g.minRaise = increase;
      pay(p, amount - p.bet); g.currentBet = amount;
    }
    p.label = p.chips === 0 ? '全下' : `加注至 ${amount}`;
  } else throw new Error('未知操作');
  p.actedAt = g.currentBet;
  advance(g, p.seat, now);
}
// Fixed-length base-15 ranks, lexicographically ordered by category then kickers.
function five(cards: number[]): number {
  const ranks = cards.map(c => c % 13 + 2).sort((a,b) => b-a);
  const groups = [...new Set(ranks)].map(r => ({ r, n:ranks.filter(x => x===r).length })).sort((a,b) => b.n-a.n || b.r-a.r);
  const flush = cards.every(c => Math.floor(c/13) === Math.floor(cards[0]/13));
  const unique = [...new Set(ranks)]; if (unique[0] === 14) unique.push(1);
  let straight = 0;
  for (let i=0; i<=unique.length-5; i++) if (unique[i]-unique[i+4]===4) { straight=unique[i]; break; }
  let score: number[];
  if (flush && straight) score=[8,straight];
  else if (groups[0].n===4) score=[7,groups[0].r,groups[1].r];
  else if (groups[0].n===3 && groups[1].n===2) score=[6,groups[0].r,groups[1].r];
  else if (flush) score=[5,...ranks];
  else if (straight) score=[4,straight];
  else if (groups[0].n===3) score=[3,...groups.map(x=>x.r)];
  else if (groups[0].n===2 && groups[1].n===2) score=[2,...groups.map(x=>x.r)];
  else if (groups[0].n===2) score=[1,...groups.map(x=>x.r)];
  else score=[0,...ranks];
  while(score.length<6) score.push(0);
  return score.reduce((a,b)=>a*15+b,0);
}
export function rank(cards: number[]): number {
  requireThat(cards.length >= 5 && cards.length <= 7, '需 5–7 张牌');
  let best = 0;
  for(let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++) for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++) for(let e=d+1;e<cards.length;e++) best=Math.max(best,five([cards[a],cards[b],cards[c],cards[d],cards[e]]));
  return best;
}
export function rankName(score: number) { return ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'][Math.floor(score / 15**5)]; }
export function settle(g: Game, now: number) {
  const live = contenders(g);
  const levels = [...new Set(g.players.map(p=>p.total).filter(x=>x>0))].sort((a,b)=>a-b);
  let previous=0; g.payouts=[];
  for(const level of levels) {
    const contributors=g.players.filter(p=>p.total>=level);
    const amount=(level-previous)*contributors.length; previous=level;
    let winners: Player[], label: string;
    if (contributors.length===1) { winners=contributors; label='未跟注退回'; }
    else if (live.length===1) { winners=live; label='其余玩家弃牌'; }
    else {
      const eligible=contributors.filter(p=>!p.folded && p.inHand);
      requireThat(eligible.length>0, '底池无人可领取');
      const best=Math.max(...eligible.map(p=>rank([...g.board,...p.cards])));
      winners=eligible.filter(p=>rank([...g.board,...p.cards])===best); label=rankName(best);
    }
    winners=ordered(g,g.dealer,p=>winners.includes(p));
    const share=Math.floor(amount/winners.length), remainder=amount%winners.length;
    winners.forEach((p,i)=>{p.chips+=share+(i<remainder?1:0);});
    g.payouts.push({amount,winners:winners.map(p=>p.id),label});
  }
  g.stage='settled'; g.actor=null; g.deadline=null; g.nextHandAt=now+5000; g.message='本手结束 · 5 秒后继续';
}
export function tick(g: Game, now: number) {
  const host=g.players.find(p=>p.id===g.host);
  if(host && !host.connected && host.offlineAt!==null && now>=host.offlineAt+60000) {
    const successor=ordered(g,host.seat,p=>p.connected && !p.leaving)[0]; if(successor) g.host=successor.id;
  }
  if(active(g) && g.deadline!==null && now>=g.deadline) {
    const p=g.players.find(p=>p.id===g.actor)!;
    act(g,p.id,p.bet>=g.currentBet?'check':'fold',undefined,now);
  }
  if(g.stage==='settled' && g.nextHandAt!==null && now>=g.nextHandAt) start(g,now);
}
export function publicView(g: Game, id: string): View {
  const {deck: _deck,players,...rest}=g;
  const showdown=g.stage==='settled' && contenders(g).length>1;
  const me=players.find(p=>p.id===id);
  return {...rest,me:id,players:players.map(p=>{const {cards,actedAt:_acted,offlineAt:_offline,...safe}=p;return {...safe,cards:cards.map(c=>p.id===id || (showdown && p.inHand && !p.folded)?c:null)};}),legal:me && g.actor===id?legal(g,me):null};
}
