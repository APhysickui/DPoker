import { DurableObject } from 'cloudflare:workers';
import { act, active, addPlayer, int, newGame, prepareBetweenHands, publicView, requireThat, start, tick, type Game, type Move } from '../shared/game';
interface Env { ROOMS: DurableObjectNamespace<PokerRoom>; ALLOWED_ORIGINS: string }
interface Saved { game: Game; credentials: Record<string,string>; receipts: Record<string,string[]> }
interface Attachment { player?: string; expires: number; count: number; window: number }
const json = (data: unknown, status = 200) => Response.json(data, {status});
async function body(request: Request) {
  requireThat(Number(request.headers.get('Content-Length') || 0) <= 4096,'请求过大');
  const reader=request.body?.getReader(); requireThat(reader,'请求内容为空');
  const chunks: Uint8Array[]=[]; let size=0;
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new Error('请求过大');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function digest(token: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join(''); }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url=new URL(request.url), origin=request.headers.get('Origin') || '';
    const allowed=env.ALLOWED_ORIGINS.split(',').map(s=>s.trim()).includes(origin) && !!origin;
    if(url.pathname==='/api/health') return json({ok:true});
    if(!allowed) return json({error:'不允许的网页来源'},403);
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    try {
      let response: Response;
      if(url.pathname==='/api/rooms' && request.method==='POST') {
        const input=await body(request), room=crypto.randomUUID().replaceAll('-','').slice(0,12);
        const stub=env.ROOMS.get(env.ROOMS.idFromName(room));
        response=await stub.fetch(new Request('https://room/initialize',{method:'POST',body:JSON.stringify({...input,room})}));
      } else {
        const match=url.pathname.match(/^\/api\/rooms\/([a-f0-9]{12})\/(join|ws)$/);
        if(!match) return json({error:'房间地址无效'},404);
        const stub=env.ROOMS.get(env.ROOMS.idFromName(match[1]));
        response=await stub.fetch(request);
      }
      if(response.status===101) return response;
      const result=new Response(response.body,response); Object.entries(headers).forEach(([k,v])=>result.headers.set(k,v)); return result;
    } catch(e) { return new Response(JSON.stringify({error:e instanceof Error?e.message:'请求失败'}),{status:400,headers:{...headers,'Content-Type':'application/json'}}); }
  }
} satisfies ExportedHandler<Env>;
export class PokerRoom extends DurableObject<Env> {
  private saved: Saved | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      this.saved=await ctx.storage.get<Saved>('room');
      if(this.saved) {
        const next=structuredClone(this.saved), now=Date.now(); let changed=false;
        const live=new Set(ctx.getWebSockets().map(ws=>(ws.deserializeAttachment() as Attachment).player));
        for(const p of next.game.players) if(p.connected!==live.has(p.id)) {
          p.connected=live.has(p.id); p.offlineAt=p.connected?null:(p.offlineAt??now); changed=true;
        }
        if(changed) {next.game.version++;await this.save(next);}
      }
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  private serial<T>(fn:()=>Promise<T>): Promise<T> { const result=this.queue.then(fn); this.queue=result.catch(()=>{}); return result; }
  private async save(next: Saved) {
    // KV is backed by the room's SQLite database. State + alarm commit together.
    const g=next.game, now=Date.now(), times: number[]=[];
    if(g.deadline!==null) times.push(g.deadline);
    if(g.nextHandAt!==null) times.push(g.nextHandAt);
    const host=g.players.find(p=>p.id===g.host);
    if(host && !host.connected && host.offlineAt!==null && g.players.some(p=>p.connected && !p.leaving)) times.push(Math.max(now+1,host.offlineAt+60000));
    for(const ws of this.ctx.getWebSockets()) { const a=ws.deserializeAttachment() as Attachment; if(!a.player) times.push(a.expires); }
    await this.ctx.storage.transaction(async tx=>{await tx.put('room',next); if(times.length) await tx.setAlarm(Math.max(now+1,Math.min(...times))); else await tx.deleteAlarm();});
    this.saved=next;
  }
  private broadcast() {
    if(!this.saved) return;
    for(const ws of this.ctx.getWebSockets()) {
      const a=ws.deserializeAttachment() as Attachment;
      if(a.player && this.saved.game.players.some(p=>p.id===a.player)) {
        try {ws.send(JSON.stringify({type:'state',state:publicView(this.saved.game,a.player)}));} catch { /* close callback updates presence */ }
      } else if(a.player) {try{ws.close(4001,'已离桌');}catch{}}
    }
  }
  async fetch(request: Request): Promise<Response> {
    return this.serial(async()=>{
      try {
        const path=new URL(request.url).pathname;
        if(path==='/initialize' || path.endsWith('/join')) {
          requireThat(request.method==='POST','请使用 POST');
          const input=await body(request);
          if(path==='/initialize') requireThat(!this.saved,'房间已存在'); else requireThat(this.saved,'房间不存在');
          const next: Saved = path==='/initialize'?{game:newGame(input.room,input.initial??1000,input.small??5,input.big??10),credentials:{},receipts:{}}:structuredClone(this.saved!);
          const id=crypto.randomUUID(), token=crypto.randomUUID()+crypto.randomUUID();
          addPlayer(next.game,id,input.name,Date.now()); next.credentials[id]=await digest(token); next.receipts[id]=[]; next.game.version++;
          await this.save(next); this.broadcast(); return json({room:next.game.room,player:id,token});
        }
        requireThat(this.saved,'房间不存在');
        requireThat(path.endsWith('/ws') && request.headers.get('Upgrade')?.toLowerCase()==='websocket','需要 WebSocket');
        requireThat(this.ctx.getWebSockets().length<27,'连接过多，请稍后重试');
        const pair=new WebSocketPair(), client=pair[0], server=pair[1];
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({expires:Date.now()+10000,count:0,window:Date.now()} satisfies Attachment);
        await this.save(this.saved!);
        return new Response(null,{status:101,webSocket:client});
      } catch(e) { return json({error:e instanceof Error?e.message:'请求失败'},400); }
    });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.serial(async()=>{
      let requestId: string | undefined;
      try {
        requireThat(typeof raw==='string' && raw.length<=2048,'消息过大');
        const a=ws.deserializeAttachment() as Attachment, now=Date.now();
        if(now-a.window>10000) {a.window=now;a.count=0;} requireThat(++a.count<=40,'操作太频繁'); ws.serializeAttachment(a);
        const message=JSON.parse(raw); requestId=typeof message.id==='string'?message.id:undefined;
        const next=structuredClone(this.saved!); const g=next.game;
        if(!a.player) {
          requireThat(now<=a.expires && message.type==='auth' && typeof message.player==='string' && typeof message.token==='string','请先鉴权');
          requireThat(next.credentials[message.player]===await digest(message.token),'房间凭证无效');
          const p=g.players.find(p=>p.id===message.player); requireThat(p,'玩家已离桌');
          a.player=p.id; ws.serializeAttachment(a); p.connected=true; p.offlineAt=null;
          // One active tab per seat, with identity recorded before old sockets close.
          for(const other of this.ctx.getWebSockets()) if(other!==ws && (other.deserializeAttachment() as Attachment).player===p.id) {other.serializeAttachment({...other.deserializeAttachment(),player:undefined});other.close(4002,'此座位已在另一个页面打开');}
          tick(g,now); g.version++; await this.save(next); this.broadcast(); return;
        }
        requireThat(requestId && /^[\w-]{1,80}$/.test(requestId),'缺少有效指令编号');
        const receipts=next.receipts[a.player] ?? [];
        if(receipts.includes(requestId)) { ws.send(JSON.stringify({type:'ack',id:requestId,duplicate:true})); ws.send(JSON.stringify({type:'state',state:publicView(g,a.player)})); return; }
        // Deadlines take precedence even if an alarm is delivered late.
        if((g.deadline!==null && now>=g.deadline) || (g.nextHandAt!==null && now>=g.nextHandAt)) {tick(g,now);g.version++;await this.save(next);this.broadcast();throw new Error('牌局已更新，请重试');}
        requireThat(message.version===g.version,'牌局已更新，请重试');
        const p=g.players.find(p=>p.id===a.player); requireThat(p,'玩家已离桌');
        switch(message.type) {
          case 'ready': requireThat(!p.leaving,'正在离桌'); p.ready=!p.ready; p.label=p.ready?'已准备':'未准备'; break;
          case 'start': requireThat(g.host===p.id,'仅房主可开始'); requireThat(!active(g) && g.stage!=='settled','请等待本手结算'); start(g,now); break;
          case 'move': act(g,p.id,message.move as Move,message.amount,now); break;
          case 'leave': p.leaving=true;p.ready=false;if(!active(g) && g.stage!=='settled') prepareBetweenHands(g); break;
          case 'topup': {
            requireThat(g.host===p.id,'仅房主可补筹码'); const target=g.players.find(q=>q.id===message.player); requireThat(target,'玩家不存在');
            requireThat(int(message.amount,1,1000000) && target.chips+target.pendingChips+target.total+message.amount<=10000000,'补筹码金额无效');
            target.pendingChips+=message.amount; if(!active(g) && g.stage!=='settled') prepareBetweenHands(g); break;
          }
          default: throw new Error('未知指令');
        }
        receipts.push(requestId); next.receipts[a.player]=receipts.slice(-128);
        for(const id of Object.keys(next.credentials)) if(!g.players.some(p=>p.id===id)){delete next.credentials[id];delete next.receipts[id];}
        g.version++; await this.save(next);
        ws.send(JSON.stringify({type:'ack',id:requestId}));this.broadcast();
      } catch(e) {try {ws.send(JSON.stringify({type:'error',id:requestId,message:e instanceof Error?e.message:'操作失败'})); if(!(ws.deserializeAttachment() as Attachment).player) ws.close(4003,'鉴权失败');}catch{}}
    });
  }
  async webSocketClose(ws: WebSocket, code = 1000, reason = '') { ws.close(code, reason); await this.disconnect(ws); }
  async webSocketError(ws: WebSocket) { try {ws.close(1011, '连接异常');} catch {} await this.disconnect(ws); }
  private async disconnect(ws: WebSocket) {
    await this.serial(async()=>{
      const a=ws.deserializeAttachment() as Attachment;if(!a.player || !this.saved) return;
      const another=this.ctx.getWebSockets().some(s=>s!==ws && (s.deserializeAttachment() as Attachment).player===a.player);
      if(another) return;
      const next=structuredClone(this.saved),p=next.game.players.find(p=>p.id===a.player);if(!p)return;
      p.connected=false;p.offlineAt=Date.now();next.game.version++;await this.save(next);this.broadcast();
    });
  }
  async alarm() {
    await this.serial(async()=>{
      if(!this.saved)return;const now=Date.now();
      for(const ws of this.ctx.getWebSockets()) {const a=ws.deserializeAttachment() as Attachment;if(!a.player && now>=a.expires)ws.close(4003,'鉴权超时');}
      const next=structuredClone(this.saved);tick(next.game,now);next.game.version++;await this.save(next);this.broadcast();
    });
  }
}
