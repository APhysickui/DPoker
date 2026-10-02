import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,open} from 'node:fs/promises';
import WebSocket from 'ws';
const base='http://127.0.0.1:8790',origin='http://localhost:5173';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,limit=40000){const end=Date.now()+limit;while(Date.now()<end){if(await fn())return;await delay(50);}throw new Error('Timeout: '+fn.toString());}
await mkdir('artifacts',{recursive:true});
const logfile=await open('artifacts/restart-worker.log','a');
let server;const sockets=[];
async function boot(){server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--ip','127.0.0.1','--port','8790','--inspector-port','9231','--persist-to','artifacts/restart-state'],{stdio:['ignore',logfile.fd,logfile.fd]});await until(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}});}
async function stop(){if(!server||server.exitCode!==null)return;const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([stopped,delay(5000)]);if(server.exitCode===null){server.kill('SIGKILL');await stopped;}}
async function post(path,data){const r=await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});assert(r.ok);return r.json();}
async function connect(session){const c={session,state:null,messages:[],ws:new WebSocket(base.replace('http','ws')+`/api/rooms/${session.room}/ws`,{origin})};sockets.push(c.ws);c.ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.type==='state')c.state=m.state;});await new Promise((r,j)=>{c.ws.once('open',r);c.ws.once('error',j);});c.ws.send(JSON.stringify({type:'auth',player:session.player,token:session.token}));await until(()=>c.state,6000);return c;}
async function command(c,type,extra={}){const id=crypto.randomUUID(),v=c.state.version;c.ws.send(JSON.stringify({type,id,version:v,...extra}));await until(()=>c.messages.some(m=>m.id===id),6000);const response=c.messages.find(m=>m.id===id);assert.equal(response.type,'ack',response.message);await until(()=>c.state.version>v,6000);}
try{
 await boot();const a=await post('/api/rooms',{name:'恢复甲'}),ca=await connect(a);const b=await post(`/api/rooms/${a.room}/join`,{name:'恢复乙'}),cb=await connect(b);await until(()=>ca.state.version===cb.state.version,6000);
 await command(ca,'ready');await until(()=>ca.state.version===cb.state.version,6000);await command(cb,'ready');await until(()=>ca.state.version===cb.state.version,6000);await command(ca,'start');await until(()=>ca.state.version===cb.state.version,6000);
 const before=structuredClone(ca.state),own=before.players.find(p=>p.id===a.player);
 // Terminate the owned server while the hand and its WebSockets are live.
 await stop();for(const ws of sockets)ws.terminate();await boot();const restored=await connect(a),after=restored.state;
 assert.equal(after.hand,before.hand);assert.deepEqual(after.players.find(p=>p.id===a.player).cards,own.cards);
 assert.equal(after.players.find(p=>p.id===b.player).connected,false);
 if(Date.now()<before.deadline){assert.equal(after.stage,before.stage);assert.equal(after.deadline,before.deadline);assert.equal(after.actor,before.actor);assert.deepEqual(after.players.map(p=>[p.id,p.chips,p.bet,p.total]),before.players.map(p=>[p.id,p.chips,p.bet,p.total]));}
 else {assert.equal(after.stage,'settled');assert.equal(after.players.reduce((n,p)=>n+p.chips,0),2000);}
 console.log('PASS: real Worker restart preserves room identity, own cards, hand number, chips, and deadline; lost sockets become offline');
}finally{for(const ws of sockets)ws.terminate();await stop();await logfile.close();}
