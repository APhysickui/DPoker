import React, { useState } from 'react';
import type { HandRecord } from '../shared/history';
import { download } from './session';
const labels: Record<string, string> = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全下', PREFLOP: '翻前', FLOP: '翻牌', TURN: '转牌', RIVER: '河牌' };
export function HistoryPanel({ hands, close }: {
    hands: HandRecord[];
    close: () => void;
}) {
    const [selected, setSelected] = useState(0);
    const hand = hands[selected];
    return <section className="history-panel" aria-label="牌局回看">
    <div className="history-heading"><div><p className="eyebrow">AFTER THE HAND</p><h2>把这一手，看明白。</h2></div><button onClick={close}>收起回看</button></div>
    {!hands.length ? <p>还没有你参与并已结算的牌局。牌桌保存最近 20 手。</p> : <>
      <label>选择牌局 <select value={selected} onChange={e => setSelected(Number(e.target.value))}>{hands.map((h, i) => <option key={h.hand} value={i}>第 {h.hand} 手</option>)}</select></label>
      {hand && <><div className="history-stacks">{hand.players.map(p => <span key={p.id}>{p.name}<strong>{(p.ending ?? p.starting) - p.starting >= 0 ? '+' : ''}{(p.ending ?? p.starting) - p.starting}</strong></span>)}</div>
      <ol className="history-actions">{hand.decisions.map((d, i) => <li key={i}><small>{labels[d.situation.street]}</small><b>{d.name}</b><span>{labels[d.action]}{d.amount ? ` · 投入 ${d.amount}` : ''}</span></li>)}</ol>
      {hand.truncated && <p>这手行动较多，记录保留了前 128 次决策。</p>}
      <div className="actions"><button className="primary" onClick={() => download(`dpoker-hand-${hand.hand}.json`, hand)}>导出这手复盘</button><a className="outline" href="https://aphysickui.github.io/QPDS/" target="_blank" rel="noreferrer">打开 QPDS ↗</a></div>
      <p className="muted">导出的记录只包含你当时已知的底牌。在 QPDS 的「复盘与练习」中导入，逐街回看自己的决策。</p></>}
    </>}
  </section>;
}
