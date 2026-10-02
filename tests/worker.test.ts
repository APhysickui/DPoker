import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers',()=>({DurableObject:class {constructor(public ctx:unknown,public env:unknown){}}}));
import { PokerRoom } from '../worker/index';
import type { View } from '../shared/game';
class Socket {
  attachment:Record<string,unknown>={expires:Date.now()+10000,count:0,window:Date.now()};
  messages: any[]=[]; closed=false;
  serializeAttachment(value:Record<string,unknown>){this.attachment=structuredClone(value);}
  deserializeAttachment(){return structuredClone(this.attachment);}
  send(message:string){this.messages.push(JSON.parse(message));}
  close(){this.closed=true;}
  get state():View {return this.messages.filter(m=>m.type==='state').at(-1)?.state;}
}
class Context {
  data=new Map<string,unknown>();alarm:number|null=null;sockets:Socket[]=[];initialized=Promise.resolve();fail=false;
  storage={
    get:async<T>(key:string)=>structuredClone(this.data.get(key)) as T,
    transaction:async(fn:(tx:any)=>Promise<void>)=>{
      if(this.fail)throw new Error('simulated disk failure');
      const next=new Map(this.data);let alarm=this.alarm;
      await fn({put:async(k:string,v:unknown)=>{next.set(k,structuredClone(v));},setAlarm:async(t:number)=>{alarm=t;},deleteAlarm:async()=>{alarm=null;}});
      this.data=next;this.alarm=alarm;
    }
  };
  blockConcurrencyWhile(fn:()=>Promise<void>){this.initialized=fn();}
  setWebSocketAutoResponse(){}
  getWebSockets(){return this.sockets.filter(s=>!s.closed);}
}
function make(ctx=new Context()){return {ctx,room:new PokerRoom(ctx as unknown as DurableObjectState,{} as any)};}
async function create(room:PokerRoom,name='甲',join?:string){const res=await room.fetch(new Request(join?'https://room/api/rooms/abcd/join':'https://room/initialize',{method:'POST',body:JSON.stringify({name,room:'abcd',initial:1000,small:5,big:10})}));return await res.json() as {player:string;token:string;room:string};}
async function auth(room:PokerRoom,ctx:Context,session:{player:string;token:string},token=session.token){const socket=new Socket();ctx.sockets.push(socket);await room.webSocketMessage(socket as unknown as WebSocket,JSON.stringify({type:'auth',player:session.player,token}));return socket;}
async function command(room:PokerRoom,socket:Socket,type:string,extra:Record<string,unknown>={}){const msg={type,id:crypto.randomUUID(),version:socket.state.version,...extra};await room.webSocketMessage(socket as unknown as WebSocket,JSON.stringify(msg));return msg;}
beforeEach(()=>{vi.stubGlobal('WebSocketRequestResponsePair',class{});vi.spyOn(Date,'now').mockReturnValue(100000);});
describe('Durable Object 服务层（内存存储与 socket 替身）',()=>{
 it('鉴权前不泄漏状态，错误凭证拒绝',async()=>{const {ctx,room}=make();await ctx.initialized;const session=await create(room);const bad=await auth(room,ctx,session,'bad');expect(bad.state).toBeUndefined();expect(bad.closed).toBe(true);const good=await auth(room,ctx,session);expect(good.state.me).toBe(session.player);expect(JSON.stringify(good.state)).not.toContain(session.token);});
 it('指令持久化后确认，重复指令不会反复切换准备',async()=>{const {ctx,room}=make();await ctx.initialized;const session=await create(room),s=await auth(room,ctx,session);const msg=await command(room,s,'ready');expect(s.state.players[0].ready).toBe(true);const version=s.state.version;await room.webSocketMessage(s as unknown as WebSocket,JSON.stringify(msg));expect(s.state.version).toBe(version);expect(s.messages.at(-2).duplicate).toBe(true);expect((ctx.data.get('room') as any).game.players[0].ready).toBe(true);});
 it('旧版本拒绝执行，伪造 player 字段不能获得房主权限',async()=>{const {ctx,room}=make();await ctx.initialized;const a=await create(room),sa=await auth(room,ctx,a);const b=await create(room,'乙','join'),sb=await auth(room,ctx,b);await command(room,sb,'topup',{player:a.player,amount:100});expect(sb.messages.at(-1).type).toBe('error');await command(room,sa,'ready',{version:0});expect(sa.messages.at(-1).type).toBe('error');expect(sa.state.players[0].ready).toBe(false);});
 it('存储失败不确认、不广播，也不污染已提交状态',async()=>{const {ctx,room}=make();await ctx.initialized;const a=await create(room),s=await auth(room,ctx,a);const version=s.state.version;ctx.fail=true;await command(room,s,'ready');expect(s.messages.at(-1).type).toBe('error');expect(s.state.version).toBe(version);ctx.fail=false;await command(room,s,'ready');expect(s.state.players[0].ready).toBe(true);});
 it('完整九人对局经服务层动作验证后结算，重放下注只返回回执',async()=>{const {ctx,room}=make();await ctx.initialized;const sockets:Socket[]=[];for(let i=0;i<9;i++){const s=await create(room,String(i),i?'join':undefined);sockets.push(await auth(room,ctx,s));}for(const s of sockets)await command(room,s,'ready');await command(room,sockets[0],'start');for(const s of sockets){expect('deck' in s.state).toBe(false);expect(s.state.players.filter(p=>p.id!==s.state.me).every(p=>p.cards.every(c=>c===null))).toBe(true);}
   let turns=0;while(sockets[0].state.stage!=='settled'&&turns++<80){const s=sockets.find(s=>s.state.actor===s.state.me)!;const msg=await command(room,s,'move',{move:s.state.legal!.call?'call':'check'});const version=s.state.version;await room.webSocketMessage(s as unknown as WebSocket,JSON.stringify(msg));expect(s.state.version).toBe(version);}
   expect(sockets[0].state.stage).toBe('settled');expect(sockets[0].state.players.reduce((n,p)=>n+p.chips,0)).toBe(9000);expect(ctx.alarm).toBe(105000);
 });
 it('实例重建保留牌局与截止时间，已失去的连接标记离线',async()=>{const {ctx,room}=make();await ctx.initialized;const a=await create(room),sa=await auth(room,ctx,a);const b=await create(room,'乙','join'),sb=await auth(room,ctx,b);await command(room,sa,'ready');await command(room,sb,'ready');await command(room,sa,'start');const before=sa.state;ctx.sockets=[];const restarted=make(ctx).room;await ctx.initialized;const restored=await auth(restarted,ctx,a);expect(restored.state.hand).toBe(before.hand);expect(restored.state.deadline).toBe(before.deadline);expect(restored.state.players.find(p=>p.id===a.player)!.cards).toEqual(before.players.find(p=>p.id===a.player)!.cards);expect(restored.state.players.find(p=>p.id===b.player)!.connected).toBe(false);vi.mocked(Date.now).mockReturnValue(130000);await restarted.alarm();expect(restored.state.stage).toBe('settled');});
 it('真实 Alarm 入口处理房主移交',async()=>{const {ctx,room}=make();await ctx.initialized;const a=await create(room),sa=await auth(room,ctx,a);const b=await create(room,'乙','join'),sb=await auth(room,ctx,b);sa.closed=true;await room.webSocketClose(sa as unknown as WebSocket);expect(ctx.alarm).toBe(160000);vi.mocked(Date.now).mockReturnValue(160000);await room.alarm();expect(sb.state.host).toBe(b.player);});
});
