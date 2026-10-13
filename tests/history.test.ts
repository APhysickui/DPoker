import { describe, it, expect } from 'vitest';
import { newGame, addPlayer, start, act, publicView, potRaiseTo, settle } from '../shared/game';
import { historyFor } from '../shared/history';
import { validSession, readSeat } from '../src/session';
function game() { const g = newGame('000000000001', 1000, 5, 10); for (let i = 0; i < 2; i++) {
    addPlayer(g, `p${i}`, `玩家${i}`, 0);
    g.players[i].ready = g.players[i].connected = true;
} return g; }
describe('review contracts', () => {
    it('pot raise includes the call added to the pot', () => expect(potRaiseTo({ currentBet: 10, minRaise: 10 }, 5, 15, 1000)).toBe(30));
    it('snapshots contain only the board known before the action', () => { const g = game(); start(g, 0); while (g.stage !== 'settled') {
        const p = g.players.find(p => p.id === g.actor)!;
        act(g, p.id, p.bet < g.currentBet ? 'call' : 'check', 0, 100);
    } const h = historyFor(g, 'p0')[0]; expect(h.decisions[0].situation.board).toEqual([]); expect(h.decisions.find(d => d.situation.street === 'FLOP')?.situation.board).toHaveLength(3); expect(h.board).toHaveLength(5); expect(h.decisions.filter(d => d.actor === 'p1').every(d => d.situation.hero_cards.length === 0)).toBe(true); expect('history' in publicView(g, 'p0')).toBe(false); });
    it('old rooms without a history draft still settle', () => { const g = game(); start(g, 0); delete g.currentHistory; act(g, g.actor!, 'fold', 0, 100); expect(g.stage).toBe('settled'); expect(historyFor(g, 'p0')).toEqual([]); });
    it('payout shares include odd chips and sum to their pot', () => { const g = game(); start(g, 0); g.board = [8, 9, 10, 11, 12]; g.players.forEach(p => { p.total = 5; p.chips = 0; p.cards = [13, 14]; }); settle(g, 0); for (const p of g.payouts)
        expect(p.shares?.reduce((n, s) => n + s.amount, 0)).toBe(p.amount); });
    it('history stays bounded and unavailable to spectators/new seats', () => { const g = game(); for (let i = 0; i < 25; i++) {
        start(g, i * 10000);
        act(g, g.actor!, 'fold', 0, i * 10000 + 1);
    } expect(g.history).toHaveLength(20); expect(historyFor(g, 'stranger')).toEqual([]); });
    it('seat backups require an explicit format and a valid identity', async () => { const session = { room: '0123456789ab', player: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID() }; expect(validSession(session)).toBe(true); const file = new File([JSON.stringify({ format: 'dpoker.seat', schemaVersion: 1, session })], 'seat.json'); expect(await readSeat(file)).toEqual(session); await expect(readSeat(new File([JSON.stringify(session)], 'wrong.json'))).rejects.toThrow(); expect(validSession({ room: session.room, player: 'attacker', token: 2 })).toBe(false); });
});
