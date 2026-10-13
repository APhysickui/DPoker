import React, { useRef } from 'react';
export function KineticDeck({ enabled }: {
    enabled: boolean;
}) {
    const root = useRef<HTMLDivElement>(null);
    return <div className="kinetic-deck" ref={root} aria-hidden="true" onPointerMove={e => {
            if (!enabled || e.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches)
                return;
            const rect = e.currentTarget.getBoundingClientRect();
            root.current?.style.setProperty('--turn-x', `${(e.clientX - rect.left - rect.width / 2) / 24}deg`);
            root.current?.style.setProperty('--turn-y', `${-(e.clientY - rect.top - rect.height / 2) / 24}deg`);
        }} onPointerLeave={() => { root.current?.style.setProperty('--turn-x', '0deg'); root.current?.style.setProperty('--turn-y', '0deg'); }}>
    <div className="deck-orbit orbit-one"/><div className="deck-orbit orbit-two"/>
    <div className="deck-perspective"><div className="deck-float">
      <div className="sculpture-card sculpture-back"><div className="card-weave"/><span>DP</span><small>GOOD COMPANY CLUB</small></div>
      <div className="sculpture-card sculpture-front"><span className="sculpture-index">A<small>♠</small></span><svg viewBox="0 0 100 120"><path d="M50 4C38 24 5 43 5 67C5 94 34 103 48 82C46 98 40 105 31 114H69C60 105 54 98 52 82C66 103 95 94 95 67C95 43 62 24 50 4Z"/></svg><span className="sculpture-index lower">A<small>♠</small></span><span className="sculpture-edition">THE NEXT HAND / 001</span></div>
    </div></div><div className="orbit-token"><span>DP</span></div><span className="sculpture-caption">A LITTLE LUCK.<br />A LOT OF GOOD COMPANY.</span>
  </div>;
}
