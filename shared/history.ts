import type { Game, Move } from './game';
export interface DecisionPoint {
    actor: string;
    name: string;
    action: Move;
    amount: number;
    at: number;
    situation: {
        hero_cards: string[];
        board: string[];
        pot_size: number;
        to_call: number;
        hero_stack: number;
        villain_stack: number;
        hero_bet: number;
        min_raise: number;
        can_raise: boolean;
        position: string;
        street: string;
        num_opponents: number;
        hero_invested: number;
        side_pot: boolean;
    };
}
export interface HandRecord {
    format: 'dpoker.hand';
    schemaVersion: 1;
    room: string;
    hand: number;
    viewer?: string;
    startedAt: number;
    endedAt?: number;
    truncated?: boolean;
    small: number;
    big: number;
    dealer: number;
    players: {
        id: string;
        name: string;
        seat: number;
        starting: number;
        ending?: number;
        cards?: (number | null)[];
    }[];
    decisions: DecisionPoint[];
    board: number[];
    payouts: Game['payouts'];
}
const cardString = (c: number) => '23456789TJQKA'[c % 13] + 'cdhs'[Math.floor(c / 13)];
export function beginHistory(g: Game, now: number): HandRecord {
    return { format: 'dpoker.hand', schemaVersion: 1, room: g.room, hand: g.hand, startedAt: now,
        small: g.small, big: g.big, dealer: g.dealer,
        players: g.players.filter(p => p.inHand).map(p => ({ id: p.id, name: p.name, seat: p.seat, starting: p.chips + p.total })),
        decisions: [], board: [], payouts: [] };
}
export function decisionPoint(g: Game, id: string, canRaise: boolean, now: number): DecisionPoint {
    const p = g.players.find(p => p.id === id)!;
    const live = g.players.filter(q => q.inHand && !q.folded && q.id !== id);
    const seated = g.players.filter(q => q.inHand).sort((a, b) => (a.seat - g.dealer + 9) % 9 - (b.seat - g.dealer + 9) % 9);
    const positions: Record<number, string[]> = {
        2: ['BTN', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'UTG'],
        5: ['BTN', 'SB', 'BB', 'UTG', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
        7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'], 8: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO'],
        9: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP1', 'LJ', 'HJ', 'CO'],
    };
    return { actor: id, name: p.name, action: 'check', amount: 0, at: now, situation: {
            hero_cards: p.cards.map(cardString), board: g.board.map(cardString),
            pot_size: g.players.reduce((sum, q) => sum + q.total, 0), to_call: Math.min(p.chips, Math.max(0, g.currentBet - p.bet)),
            hero_stack: p.chips, villain_stack: Math.max(0, ...live.map(q => q.chips)), hero_bet: p.bet, min_raise: g.minRaise,
            can_raise: canRaise, position: positions[seated.length]?.[seated.findIndex(q => q.id === id)] || 'BTN',
            street: g.stage.toUpperCase(), num_opponents: live.length, hero_invested: p.total,
            side_pot: live.some(q => q.total > p.total + Math.min(p.chips, Math.max(0, g.currentBet - p.bet))) || (live.length > 1 && live.some(q => q.chips === 0 && q.total < Math.max(...live.map(x => x.total), p.total + Math.min(p.chips, Math.max(0, g.currentBet - p.bet))))),
        } };
}
export function finishHistory(g: Game, now: number) {
    if (!g.currentHistory)
        return; // Rooms persisted before history support.
    const record = g.currentHistory;
    record.endedAt = now;
    record.board = [...g.board];
    record.payouts = structuredClone(g.payouts);
    const showdown = g.players.filter(p => p.inHand && !p.folded).length > 1;
    for (const entry of record.players) {
        const p = g.players.find(p => p.id === entry.id)!;
        entry.ending = p.chips;
        entry.cards = p.cards.map(c => showdown && !p.folded ? c : null);
    }
    g.history = [...(g.history || []), record].slice(-20);
    delete g.currentHistory;
}
export function historyFor(g: Game, viewer: string): HandRecord[] {
    return (g.history || []).filter(h => h.players.some(p => p.id === viewer)).map(h => {
        const safe = structuredClone(h);
        safe.viewer = viewer;
        for (const d of safe.decisions)
            if (d.actor !== viewer)
                d.situation.hero_cards = [];
        return safe;
    });
}
