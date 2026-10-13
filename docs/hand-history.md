# Private hand export v1

The `history` WebSocket request is authenticated and read-only. It returns only finished hands in which the requesting identity participated. No request version or command receipt is required. The Worker persists the latest 20 completed hands under individual `hand:<padded number>` keys, in the same transaction as room state; history is excluded from normal state broadcasts.

Each record has `format: "dpoker.hand"`, `schemaVersion: 1`, `viewer`, room/hand identifiers, blinds/dealer, starting/ending player stacks, decisions, final board and payouts. Each decision records the state **before** the action. `amount` is additional chips invested by that action.

`situation` contains `hero_cards`, `board`, `street`, `position`, `num_opponents`, `pot_size`, `to_call`, `hero_stack`, `villain_stack`, `hero_bet`, `min_raise`, `can_raise`, `hero_invested`, `side_pot`. Cards use `As`, `Td`, etc. `min_raise` is the minimum full increment, not a raise-to amount. `villain_stack` is the largest remaining opponent stack; multiway strategic EV is only approximate.

Other actors' `situation.hero_cards` are always removed in a private export. Final player cards expose only cards shown at showdown; folded cards remain hidden. Credentials and deck order are never included. QPDS imports only the viewer's decision snapshots, ignoring the final board and other players' showdown cards. Side-pot snapshots allow equity analysis but disable action-EV recommendations.

A hand keeps at most 128 decisions so its Durable Object KV value stays bounded. Longer hands set `truncated: true`; settlement and the live game still continue normally. Each room keeps at most 20 archived hands. Existing persisted rooms need no migration; a hand begun on the old code has no history, and recording begins with the next hand. Export before leaving: leaving invalidates that seat's identity.

`tests/fixtures/dpoker-hand-v1.json` is a deterministic engine-generated reference shared with QPDS. The local cross-project browser test verifies the actual producer/consumer flow.

Seat backups are a separate `dpoker.seat` v1 format containing the private room/player/token tuple. They are possession credentials, not invitation links. Importing one authenticates normally and replaces the old tab only after successful authentication. Server expiry uses retryable close code 4004; invalid identity remains terminal (4003), removed seat 4001, replaced tab 4002.
