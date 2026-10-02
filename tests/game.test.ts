import { describe, it, expect } from 'vitest';
import { act, addPlayer, legal, newGame, publicView, rank, rankName, settle, shuffledDeck, start, tick, type Game, type Player } from '../shared/game';
function game(n=2,stacks?:number[]) {const g=newGame('test',1000,5,10);for(let i=0;i<n;i++){addPlayer(g,`p${i}`,`玩家${i}`,0);g.players[i].connected=true;g.players[i].ready=true;if(stacks)g.players[i].chips=stacks[i];}return g;}
function move(g:Game,m:'fold'|'call'|'check'|'raise'|'allin',amount?:number){act(g,g.actor!,m,amount,100);}
function cards(s:string) {return s.split(' ').map(c=>'23456789TJQKA'.indexOf(c[0])+13*'cdhs'.indexOf(c[1]));}
function conservation(g:Game){return g.players.reduce((a,p)=>a+p.chips+(g.stage==='settled'?0:p.total),0);}
describe('发牌与行动顺序',()=>{
 it('单挑庄家小盲先行动，翻牌后大盲先行动',()=>{const g=game();start(g,0);expect(g.dealer).toBe(0);expect(g.actor).toBe('p0');expect(g.players.map(p=>p.bet)).toEqual([5,10]);move(g,'call');expect(g.actor).toBe('p1');move(g,'check');expect(g.stage).toBe('flop');expect(g.actor).toBe('p1');});
 it('多人枪口先行动，翻牌后庄家左侧先行动',()=>{const g=game(6);start(g,0);expect(g.actor).toBe('p3');for(let i=0;i<5;i++)move(g,'call');expect(g.actor).toBe('p2');move(g,'check');expect(g.actor).toBe('p1');expect(g.board).toHaveLength(3);});
 it('九人发牌无重复且依次轮转',()=>{const g=game(9);start(g,0);expect(new Set(g.players.flatMap(p=>p.cards)).size).toBe(18);expect(g.actor).toBe('p3');for(let i=0;i<8;i++)move(g,'fold');expect(g.stage).toBe('settled');expect(conservation(g)).toBe(9000);start(g,6000);expect(g.dealer).toBe(1);});
 it('单挑大盲不足额全下时无需多余跟注',()=>{const g=game(2,[1000,3]);start(g,0);expect(g.stage).toBe('settled');expect(g.board).toHaveLength(5);expect(conservation(g)).toBe(1003);});
 it('洗牌包含完整 52 张牌',()=>{const d=shuffledDeck();expect(d).toHaveLength(52);expect(new Set(d).size).toBe(52);expect(d.every(c=>c>=0&&c<52)).toBe(true);});
});
describe('下注与加注权',()=>{
 it('拒绝越权、欠额过牌、非法数值、过小加注',()=>{const g=game();start(g,0);expect(()=>act(g,'p1','fold',0,0)).toThrow();expect(()=>move(g,'check')).toThrow();for(const n of [19,NaN,Infinity,20.5,1001,-10])expect(()=>move(g,'raise',n)).toThrow();expect(g.players[0].chips).toBe(995);});
 it('完整加注重新开放行动，最小加注随加注差额变化',()=>{const g=game(3);start(g,0);move(g,'raise',30);expect(g.minRaise).toBe(20);move(g,'call');move(g,'raise',70);expect(g.minRaise).toBe(40);expect(g.actor).toBe('p0');expect(legal(g,g.players[0]).min).toBe(110);});
 it('不足额全下不重新开放已行动玩家的加注权',()=>{const g=game(3,[1000,1000,25]);start(g,0);move(g,'raise',20);move(g,'call');move(g,'allin');expect(g.currentBet).toBe(25);expect(g.minRaise).toBe(10);expect(legal(g,g.players[0]).canRaise).toBe(false);expect(()=>move(g,'raise',35)).toThrow();move(g,'call');expect(legal(g,g.players[1]).canRaise).toBe(false);move(g,'call');expect(g.stage).toBe('flop');});
 it('累计不足额全下达到完整加注幅度时重新开放',()=>{const g=game(4,[30,1000,1000,25]);start(g,0); // actor p3, arrange action p3 -> p0 -> p1 -> p2
   g.players[3].chips=1000;g.players[0].chips=1000;g.players[1].chips=20;g.players[2].chips=20;
   move(g,'raise',20);move(g,'call');move(g,'allin');expect(g.currentBet).toBe(25);move(g,'allin');expect(g.currentBet).toBe(30);expect(legal(g,g.players[3]).canRaise).toBe(true);
 });
 it('不能对全下对手继续加注',()=>{const g=game(2,[1000,40]);start(g,0);move(g,'raise',20);move(g,'allin');expect(legal(g,g.players[0]).canRaise).toBe(false);move(g,'call');expect(g.stage).toBe('settled');expect(g.board).toHaveLength(5);expect(conservation(g)).toBe(1040);});
});
describe('牌型比较',()=>{
 it.each([
 ['As Ks Qs Js Ts 2c 3c','同花顺'],['Ac Ad Ah As Kd 2c 3c','四条'],['Ac Ad Ah Ks Kd 2c 3c','葫芦'],['Ac Jc 9c 5c 3c Ks Qh','同花'],['Ac 2d 3h 4s 5c Kd Qs','顺子'],['Ac Ad Ah Ks Qd 2c 3c','三条'],['Ac Ad Kh Ks Qd 2c 3c','两对'],['Ac Ad Kh Qs Jd 2c 3c','一对'],['Ac Kd Qh 9s 7d 2c 3c','高牌']
 ])('%s → %s',(hand,name)=>expect(rankName(rank(cards(hand)))).toBe(name));
 it('踢脚牌与 A2345 最小顺子正确',()=>{expect(rank(cards('Ac Ad Kh Qs Jd'))).toBeGreaterThan(rank(cards('Ac Ad Kh Qs Td')));expect(rank(cards('2c 3d 4h 5s 6c'))).toBeGreaterThan(rank(cards('Ac 2d 3h 4s 5c')));});
 it('双三条选取最大葫芦',()=>{expect(rank(cards('Ac Ad Ah Ks Kd Kh 2c'))).toBe(rank(cards('Ac Ad Ah Ks Kd')));});
});
function setShowdown(g:Game,amounts:number[],hands:string[],board:string,folded:number[]=[]){g.stage='river';g.dealer=0;g.board=cards(board);g.players.forEach((p,i)=>{p.inHand=true;p.total=amounts[i];p.chips=0;p.cards=cards(hands[i]);p.folded=folded.includes(i);});}
describe('结算、边池和守恒',()=>{
 it('多重边池按资格分别结算',()=>{const g=game(4);setShowdown(g,[50,100,200,200],['Ac Ad','Kc Kd','Qc Qd','Jc Jd'],'2c 3d 7h 8s 9c');settle(g,0);expect(g.players.map(p=>p.chips)).toEqual([200,150,200,0]);expect(g.payouts.map(p=>p.amount)).toEqual([200,150,200]);});
 it('未跟注部分退回，弃牌者仍向底池贡献',()=>{const g=game(3);setShowdown(g,[50,100,200],['Ac Ad','Kc Kd','Qc Qd'],'2c 3d 7h 8s 9c',[1]);settle(g,0);expect(g.players.map(p=>p.chips)).toEqual([150,0,200]);expect(g.payouts[2].label).toBe('未跟注退回');});
 it('平局分池余数从庄家左侧开始分配',()=>{const g=game(3);setShowdown(g,[5,5,5],['2c 3c','2d 3d','4c 5c'],'As Ks Qs Js Ts',[2]);settle(g,0);expect(g.players.map(p=>p.chips)).toEqual([7,8,0]);});
 it('随机 2–9 人 400 手，行动始终结束且筹码守恒',()=>{let seed=20261002;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};for(let k=0;k<400;k++){const n=2+k%8;const stacks=Array.from({length:n},()=>20+Math.floor(random()*980));const g=game(n,stacks);const total=stacks.reduce((a,b)=>a+b,0);start(g,0);let moves=0;while(g.stage!=='settled'&&moves++<200){const p=g.players.find(p=>p.id===g.actor)!;const l=legal(g,p);const r=random();if(r<.12)move(g,'fold');else if(r<.35 && (l.canRaise||l.max<=g.currentBet))move(g,'allin');else move(g,l.call?'call':'check');expect(conservation(g)).toBe(total);}expect(g.stage).toBe('settled');expect(moves).toBeLessThan(200);expect(g.players.every(p=>p.chips>=0&&Number.isInteger(p.chips))).toBe(true);}});
});
describe('房间生命周期和隐私',()=>{
 it('只公开自己的底牌；摊牌不公开弃牌者底牌',()=>{const g=game(3);start(g,0);const view=publicView(g,'p0');expect('deck' in view).toBe(false);expect(view.players[0].cards).toEqual(g.players[0].cards);expect(view.players[1].cards).toEqual([null,null]);move(g,'fold');move(g,'allin');move(g,'call');expect(publicView(g,'p1').players[0].cards).toEqual([null,null]);expect(publicView(g,'p1').players[2].cards.every(c=>c!==null)).toBe(true);});
 it('中途加入只参加下一手，离桌与补充在手间生效',()=>{const g=game();start(g,0);addPlayer(g,'p2','新朋友',0);const p=g.players[2];p.ready=true;p.connected=true;expect(p.inHand).toBe(false);g.players[0].leaving=true;g.players[1].pendingChips=500;move(g,'fold');const before=g.players[1].chips;start(g,6000);expect(g.players).toHaveLength(2);expect(g.players.find(p=>p.id==='p2')?.inHand).toBe(true);expect(g.players.find(p=>p.id==='p1')!.chips).toBeGreaterThanOrEqual(before+490);expect(g.host).toBe('p1');});
 it('到期自动弃牌或过牌；结算五秒后开局',()=>{const g=game();start(g,0);tick(g,29999);expect(g.stage).toBe('preflop');tick(g,30000);expect(g.stage).toBe('settled');tick(g,34999);expect(g.hand).toBe(1);tick(g,35000);expect(g.hand).toBe(2);move(g,'call');tick(g,30100);expect(g.stage).toBe('flop');});
 it('房主离线 60 秒后移交，人数不足暂停',()=>{const g=game();g.players[0].connected=false;g.players[0].offlineAt=0;tick(g,59999);expect(g.host).toBe('p0');tick(g,60000);expect(g.host).toBe('p1');start(g,60000);expect(g.stage).toBe('waiting');});
 it('刷新恢复后的状态可继续行动',()=>{let g=game();start(g,0);move(g,'call');g=JSON.parse(JSON.stringify(g));tick(g,30100);expect(g.stage).toBe('flop');expect(conservation(g)).toBe(2000);});
});
