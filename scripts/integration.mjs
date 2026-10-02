// Run against Wrangler local: npm run dev:worker && npm run test:integration
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=process.env.API_URL||'http://localhost:8788';
const origin=process.env.WEB_ORIGIN||'http://localhost:5173';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await delay(25);}throw new Error('Timed out: '+fn.toString());}
async function post(path,data){const r=await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()};}
const clients=[];
async function connect(session,token=session.token){
 const c={session,messages:[],state:null,ws:new WebSocket(base.replace(/^http/,'ws')+`/api/rooms/${session.room}/ws`,{origin})};
 c.ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.type==='state')c.state=m.state;});
 await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
 c.ws.send(JSON.stringify({type:'auth',player:session.player,token}));clients.push(c);return c;
}
async function command(c,type,extra={}){
 const id=crypto.randomUUID(),msg={id,type,version:c.state.version,...extra};c.ws.send(JSON.stringify(msg));
 await until(()=>c.messages.some(m=>m.id===id));const response=c.messages.find(m=>m.id===id);
 assert.equal(response.type,'ack',response.message);await until(()=>c.state.version>msg.version);return msg;
}
async function sync(cs){await until(()=>cs.every(c=>c.state && c.state.version===cs[0].state.version));}
try {
 const host=await post('/api/rooms',{name:'房主',initial:1000,small:5,big:10});assert.equal(host.status,200);
 const cs=[await connect(host)];await until(()=>cs[0].state);
 const denied=await fetch(base+'/api/rooms',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 const bad=await connect(host,'wrong-token');await until(()=>bad.messages.some(m=>m.type==='error'));assert(!bad.messages.some(m=>m.type==='state'));
 for(let i=1;i<9;i++){const s=await post(`/api/rooms/${host.room}/join`,{name:`玩家${i}`});assert.equal(s.status,200);cs.push(await connect(s));await until(()=>cs[i].state);}
 const full=await post(`/api/rooms/${host.room}/join`,{name:'第十人'});assert.equal(full.status,400);
 await sync(cs);
 for(const c of cs){await command(c,'ready');await sync(cs);}
 await command(cs[0],'start');await sync(cs);
 assert.equal(cs[0].state.players.length,9);assert.equal(cs[0].state.stage,'preflop');
 for(const c of cs){assert(!('deck' in c.state));for(const p of c.state.players)assert.equal(p.cards.filter(x=>x!==null).length,p.id===c.session.player?2:0);}
 const actor=cs.find(c=>c.session.player===cs[0].state.actor),other=cs.find(c=>c!==actor);
 const forged=crypto.randomUUID();other.ws.send(JSON.stringify({type:'move',move:'fold',player:actor.session.player,id:forged,version:other.state.version}));await until(()=>other.messages.some(m=>m.id===forged));assert.equal(other.messages.find(m=>m.id===forged).type,'error');
 const msg=await command(actor,'move',{move:'call'});await sync(cs);const chips=actor.state.players.find(p=>p.id===actor.session.player).chips;
 actor.ws.send(JSON.stringify(msg));await until(()=>actor.messages.some(m=>m.id===msg.id&&m.duplicate));assert.equal(actor.state.players.find(p=>p.id===actor.session.player).chips,chips);
 let turns=0;while(cs[0].state.stage!=='settled' && turns++<100){const c=cs.find(c=>c.session.player===cs[0].state.actor);await command(c,'move',{move:c.state.legal.call?'call':'check'});await sync(cs);}
 assert.equal(cs[0].state.stage,'settled');assert.equal(cs[0].state.board.length,5);assert.equal(cs[0].state.players.reduce((n,p)=>n+p.chips,0),9000);
 const old=cs[4];old.ws.close();await until(()=>!cs[0].state.players.find(p=>p.id===old.session.player).connected);
 cs[4]=await connect(old.session);await until(()=>cs[4].state);assert.equal(cs[4].state.me,old.session.player);assert.equal(cs[4].state.players.find(p=>p.id===old.session.player).cards.length,2);
 console.log('PASS: 9 seats, capacity, origin, auth, private cards, actor authorization, duplicate command, full showdown, chip conservation, reconnect');
 // Independent heads-up room: joins during a hand, queued chips/leave and durable timeout.
 const h=await post('/api/rooms',{name:'甲'}),hc=await connect(h);await until(()=>hc.state);
 const j=await post(`/api/rooms/${h.room}/join`,{name:'乙'}),jc=await connect(j);await until(()=>jc.state);await sync([hc,jc]);
 await command(hc,'ready');await sync([hc,jc]);await command(jc,'ready');await sync([hc,jc]);await command(hc,'start');await sync([hc,jc]);
 const later=await post(`/api/rooms/${h.room}/join`,{name:'丙'}),lc=await connect(later);await until(()=>lc.state);await sync([hc,jc,lc]);assert.equal(lc.state.players.find(p=>p.id===later.player).inHand,false);
 await command(lc,'ready');await sync([hc,jc,lc]);await command(hc,'topup',{player:j.player,amount:500});await sync([hc,jc,lc]);assert.equal(jc.state.players.find(p=>p.id===j.player).pendingChips,500);
 await command(jc,'leave');await sync([hc,jc,lc]);assert(jc.state.players.find(p=>p.id===j.player).leaving);
 // Wait for real Alarm, no setTimeout in Worker.
 await until(()=>hc.state.stage==='settled',35000);assert.equal(hc.state.hand,1);
 await until(()=>hc.state.hand===2,7000);assert.equal(hc.state.players.length,2);assert(hc.state.players.some(p=>p.id===later.player&&p.inHand));
 console.log('PASS: mid-hand join, queued topup/leave, 30s alarm timeout and 5s automatic next hand');
 hc.ws.close();await until(()=>lc.state.players.find(p=>p.id===h.player)?.connected===false);
 await until(()=>lc.state.host===later.player,65000);
 console.log('PASS: host transfer after 60s offline');
} finally {for(const c of clients)c.ws.close();}
