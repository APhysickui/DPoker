import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { View } from '../shared/game';
import './style.css';
interface Session { room: string; player: string; token: string }
const configured=import.meta.env.VITE_API_URL?.replace(/\/$/,'');
const api=configured || (import.meta.env.DEV ? location.origin : '');
function roomHash() {return location.hash.match(/^#\/room\/([a-f0-9]{12})$/)?.[1] || '';}
function stored(room: string): Session | null {try{return JSON.parse(localStorage.getItem(`dpoker:${room}`)||'null');}catch{return null;}}
const phase: Record<string,string>={waiting:'等待开局',preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',settled:'本手结算'};
function Card({value,small=false}:{value:number|null;small?:boolean}) {
  const suits=['♣','♦','♥','♠'],rank=value===null?'':String(value%13+2).replace('11','J').replace('12','Q').replace('13','K').replace('14','A');
  return <span aria-label={value===null?'未公开的牌':suits[Math.floor(value/13)]+rank} className={`card ${small?'small':''} ${value===null?'back':''} ${value!==null && [1,2].includes(Math.floor(value/13))?'red':''}`}>{value===null?<span>◆</span>:<><b>{rank}</b><i>{suits[Math.floor(value/13)]}</i></>}</span>;
}
function App() {
  const [room,setRoom]=useState(roomHash),[session,setSession]=useState<Session|null>(()=>stored(roomHash()));
  const [state,setState]=useState<View|null>(null),[connection,setConnection]=useState('未连接'),[error,setError]=useState('');
  const [name,setName]=useState(()=>localStorage.getItem('dpoker:name')||''),[initial,setInitial]=useState(1000),[small,setSmall]=useState(5),[big,setBig]=useState(10);
  const [busy,setBusy]=useState(false),[pending,setPending]=useState(false),[amount,setAmount]=useState(20),[now,setNow]=useState(Date.now()),[copied,setCopied]=useState(false);
  const [settings,setSettings]=useState(false),[invite,setInvite]=useState('');
  const socket=useRef<WebSocket|null>(null),version=useRef(0),pendingTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{const changed=()=>{const r=roomHash();setRoom(r);setSession(stored(r));setState(null);setError('');};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!session || !api)return;
    let disposed=false,retry:ReturnType<typeof setTimeout>,heartbeat:ReturnType<typeof setInterval>,attempt=0;
    const connect=()=>{
      if(disposed)return;setConnection('连接中');
      const ws=new WebSocket(`${api.replace(/^http/,'ws')}/api/rooms/${session.room}/ws`);socket.current=ws;
      ws.onopen=()=>{ws.send(JSON.stringify({type:'auth',player:session.player,token:session.token}));heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send('ping');},20000);};
      ws.onmessage=e=>{
        if(e.data==='pong')return;
        const message=JSON.parse(e.data);
        if(message.type==='state') {setState(message.state);version.current=message.state.version;setConnection('已连接');attempt=0;}
        if(message.type==='ack' || message.type==='error'){setPending(false);if(pendingTimer.current)clearTimeout(pendingTimer.current);}
        if(message.type==='error')setError(message.message);
      };
      ws.onclose=e=>{
        clearInterval(heartbeat);setPending(false);if(disposed)return;
        if([4001,4002,4003].includes(e.code)){setConnection('已断开');setError(e.code===4002?'座位已在另一个页面打开，请关闭该页面后刷新。':'已离桌或凭证失效，请重新入座。');if(e.code!==4002){localStorage.removeItem(`dpoker:${session.room}`);setSession(null);setState(null);}return;}
        setConnection('正在重连');retry=setTimeout(connect,Math.min(1000*2**attempt++,10000));
      };
      ws.onerror=()=>ws.close();
    };connect();
    return()=>{disposed=true;clearTimeout(retry);clearInterval(heartbeat);socket.current?.close();};
  },[session]);
  useEffect(()=>{if(state?.legal)setAmount(Math.min(state.legal.min,state.legal.max));},[state?.actor,state?.currentBet,state?.minRaise]);
  async function enter(create:boolean) {
    setError('');if(!api){setError('后端尚未配置。请按项目说明设置 VITE_API_URL 后发布网页。');return;}
    if(!name.trim()){setError('先给自己取个昵称吧');return;}setBusy(true);
    try {
      const result=await fetch(`${api}/api/rooms${create?'':`/${room}/join`}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,initial,small,big})});
      const data=await result.json() as Session & {error?:string};if(!result.ok)throw new Error(data.error||'入座失败');
      localStorage.setItem(`dpoker:${data.room}`,JSON.stringify(data));localStorage.setItem('dpoker:name',name);setSession(data);setRoom(data.room);location.hash=`/room/${data.room}`;
    }catch(e){setError(e instanceof Error?e.message:'网络连接失败');}finally{setBusy(false);}
  }
  function send(type:string,extra:Record<string,unknown>={}) {
    if(socket.current?.readyState!==WebSocket.OPEN || connection!=='已连接' || pending)return;
    setError('');setPending(true);socket.current.send(JSON.stringify({type,...extra,id:crypto.randomUUID(),version:version.current}));
    pendingTimer.current=setTimeout(()=>{setPending(false);setError('确认超时，正在重新同步牌局。');socket.current?.close();},6000);
  }
  async function copy(){try{await navigator.clipboard.writeText(location.href);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{setInvite(location.href);}}
  const me=state?.players.find(p=>p.id===state.me),isHost=state?.host===state?.me;
  const active=state && !['waiting','settled'].includes(state.stage),myTurn=!!state?.legal;
  const blocked=pending || connection!=='已连接';
  const pot=state?.players.reduce((sum,p)=>sum+p.total,0)||0;
  const clock=state?.deadline?Math.min(30,Math.max(0,Math.ceil((state.deadline-now)/1000))):0;
  const myIndex=state?.players.find(p=>p.id===state.me)?.seat ?? 0;
  return <div className="app">
    <header className="topbar"><a className="brand" href="#" aria-label="DPoker 首页"><span className="brand-icon">♠</span> D<span>POKER</span><small>朋友的牌局</small></a><div className="top-right"><span className="free">仅限虚拟筹码</span>{state && <span className={`connection ${connection==='已连接'?'on':''}`}>{connection}</span>}</div></header>
    {error && <div className="toast" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}>×</button></div>}
    {!state ? <main className="landing">
      <section className="intro"><p className="eyebrow">GOOD COMPANY. GREAT HANDS.</p><h1>好朋友，<br/>就差<span>一手好牌。</span></h1><p className="lead">把今晚留给牌桌。<br/>无需注册，邀请朋友，随时入座。</p><div className="hero-cards"><Card value={12}/><Card value={51}/><div className="chip">D<span>100</span></div></div><div className="details"><span>02—09 <small>位朋友</small></span><span>NO LIMIT <small>无限注德州扑克</small></span></div></section>
      <section className="entry"><p className="eyebrow">{room?'YOUR SEAT IS WAITING':'A TABLE OF YOUR OWN'}</p><h2>{room?'朋友在等你':'开一桌，聚一聚'}</h2><p className="muted">{room?`受邀房间 · ${room.toUpperCase()}`:'私人房间 · 免费筹码 · 即刻开局'}</p>
        {session?<p role="status">{connection}，正在恢复你的座位…</p>:<form onSubmit={e=>{e.preventDefault();void enter(!room);}}>
          <label>你的昵称<input maxLength={16} required value={name} onChange={e=>setName(e.target.value)} placeholder="牌桌上怎么称呼你？" autoComplete="nickname"/></label>
          {!room && <><button type="button" className="settings-toggle" onClick={()=>setSettings(!settings)}>牌桌设置 <span>{initial} 筹码 · {small}/{big} 盲注 {settings?'−':'+'}</span></button>{settings && <div className="setup"><label>初始筹码<input type="number" min={20} max={1000000} value={initial} onChange={e=>setInitial(Number(e.target.value))}/></label><label>小盲<input type="number" min={1} value={small} onChange={e=>setSmall(Number(e.target.value))}/></label><label>大盲<input type="number" min={small*2} value={big} onChange={e=>setBig(Number(e.target.value))}/></label></div>}</>}
          <button className="primary enter-button" disabled={busy} type="submit">{busy?'正在入座…':room?'加入牌桌':'创建私人牌桌'}<span>↗</span></button>
        </form>}
        {!room && <><div className="divider">已有朋友开好房间？</div><form onSubmit={e=>{e.preventDefault();const match=invite.match(/[a-f0-9]{12}/i);if(match)location.hash=`/room/${match[0].toLowerCase()}`;else setError('请输入完整邀请链接或 12 位房间号');}}><label className="sr-only" htmlFor="invite">邀请链接或房间号</label><div className="join-row"><input id="invite" value={invite} onChange={e=>setInvite(e.target.value)} placeholder="粘贴邀请链接或房间号"/><button type="submit">加入 →</button></div></form></>}
        <p className="entry-note">♧ 不涉及现金、充值或兑换<br/>好的牌局，从轻松开始。</p>
      </section><footer>LESS SCROLLING. MORE PLAYING.<span>DP / 01</span></footer>
    </main>:<main className="room">
      <div className="room-heading"><div><p className="eyebrow">PRIVATE TABLE <span>#{state.room.slice(0,6).toUpperCase()}</span></p><h1>今晚这桌，都是朋友。</h1></div><button className="outline" onClick={copy}>{copied?'链接已复制 ✓':'邀请朋友 ↗'}</button></div>
      {invite && <input aria-label="邀请链接" readOnly value={invite} onFocus={e=>e.target.select()}/>}
      <div className="table-meta"><span><i className="live-dot"/> {state.players.length} / 9 已入座</span><span>盲注 {state.small} / {state.big}</span><span>第 {String(state.hand).padStart(2,'0')} 手</span></div>
      <section className="table-area" aria-label="牌桌">
        <div className="felt"><div className="felt-line"/><div className="table-center"><p className="phase">{phase[state.stage]}</p>{state.stage==='waiting'?<><span className="table-logo">DP</span><p className="waiting-copy">{state.message}</p></>:<><div className="pot"><span>{state.stage==='settled'?'本手底池':'底池'}</span><strong>{pot.toLocaleString()}</strong></div><div className="board">{Array.from({length:5},(_,i)=>state.board[i]!==undefined?<Card key={i} value={state.board[i]}/>:<span key={i} className="card-slot"/>)}</div><p className="table-caption">{state.stage==='settled'?`${Math.max(0,Math.ceil(((state.nextHandAt||now)-now)/1000))} 秒后继续`:state.actor===state.me?'轮到你了，慢慢想':`等待 ${state.players.find(p=>p.id===state.actor)?.name || '玩家'} 行动`}</p></> }</div></div>
        {Array.from({length:9},(_,position)=>{
          const seat=(myIndex+position)%9,p=state.players.find(p=>p.seat===seat),angle=position*2*Math.PI/9;
          return <div key={seat} className={`seat ${position===0?'self':''} ${p?.id===state.actor?'acting':''} ${p?.folded?'folded':''}`} style={{left:`${50+45*Math.sin(angle)}%`,top:`${50+45*Math.cos(angle)}%`}}>
            {p?<><div className="seat-cards">{p.cards.map((c,i)=><Card key={i} value={c} small/>)}</div><div className="avatar">{p.name.slice(0,1)}{p.seat===state.dealer && <b className="dealer">D</b>}{p.id===state.actor && <b className="timer">{clock}</b>}</div><div className="name">{p.name}{p.id===state.me?' · 你':''}{p.id===state.host?' ♔':''}</div><div className="stack">{p.chips.toLocaleString()}</div><div className="seat-label">{!p.connected?'离线':p.leaving?'下手离桌':p.pendingChips?`待补 +${p.pendingChips}`:p.label}</div>{active && p.bet>0 && <span className="bet">◉ {p.bet}</span>}</>:<div className="empty-seat"><span>+</span><small>空位</small></div>}
          </div>;
        })}
      </section>
      {state.stage==='settled' && <div className="results" role="status">{state.payouts.map((p,i)=><p key={i}><span>{p.winners.map(id=>state.players.find(x=>x.id===id)?.name).join(' / ')}</span><b> +{p.amount}</b><small>{p.label}{i>0?' · 边池 / 退回':''}</small></p>)}</div>}
      <section className="controls"><div className="your-hand"><span>你的手牌</span><div>{me?.cards.length?me.cards.map((c,i)=><Card key={i} value={c}/>):<span className="muted">等待发牌</span>}</div><small>{me?.chips.toLocaleString()} 筹码</small></div><div className="action-panel">
        {myTurn && state.legal?<><div className="turn-heading"><span><i className="live-dot"/> 轮到你行动</span><b>{clock}s</b></div><div className="raise-row"><label htmlFor="raise">加注至</label><input id="raise" type="number" min={Math.min(state.legal.min,state.legal.max)} max={state.legal.max} step={1} value={amount} onChange={e=>setAmount(Number(e.target.value))} disabled={!state.legal.canRaise||blocked}/><button disabled={!state.legal.canRaise||blocked} onClick={()=>setAmount(Math.min(state.legal!.max,state.currentBet+Math.max(state.minRaise,pot)))}>底池</button></div><div className="actions"><button disabled={blocked} onClick={()=>send('move',{move:'fold'})}>弃牌</button><button disabled={blocked} onClick={()=>send('move',{move:state.legal!.call?'call':'check'})}>{state.legal.call?`跟注 ${state.legal.call}`:'过牌'}</button><button className="primary" disabled={blocked||!state.legal.canRaise||amount>state.legal.max||amount<Math.min(state.legal.min,state.legal.max)||!Number.isInteger(amount)} onClick={()=>send('move',{move:'raise',amount})}>加注</button><button className="allin" disabled={blocked||(!state.legal.canRaise && state.legal.max>state.currentBet)} onClick={()=>send('move',{move:'allin'})}>全下</button></div></>:<><p className="control-message">{me?.leaving?'将在本手结束后离桌':active?'好牌值得等待。':state.stage==='settled'?'这手精彩，下一手见。':'人齐了，就开一手。'}</p><div className="actions"><button className={me?.ready?'outline':'primary'} disabled={blocked||me?.leaving} onClick={()=>send('ready')}>{me?.ready?'取消准备':'准备下一手'}</button>{isHost && state.stage==='waiting' && <button className="primary" disabled={blocked||state.players.filter(p=>p.ready&&p.connected&&p.chips>0).length<2} onClick={()=>send('start')}>开始牌局 →</button>}</div></>}
      </div></section>
      <div className="room-footer"><span>{active?'每次行动 30 秒 · 超时自动过牌或弃牌':'至少两人准备后，由房主开始'}</span><button onClick={()=>send('leave')} disabled={blocked||me?.leaving}>离开牌桌</button></div>
      {isHost && <details className="host-panel"><summary>房主管理 · 补筹码</summary><p className="muted">每次补充初始筹码数量；手牌进行中申请的补充在手牌之间生效。</p><div>{state.players.map(p=><button key={p.id} disabled={blocked} onClick={()=>send('topup',{player:p.id,amount:state.initial})}>{p.name} +{state.initial}</button>)}</div></details>}
    </main>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
