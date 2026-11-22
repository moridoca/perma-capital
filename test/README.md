# Tests

    cd test
    npm install
    npm test

`compile.js` compiles every contract in `contracts/perma` (optimizer on, 200 runs) and
prints the deployed size of each against the 24,576-byte limit. `book.test.js` deploys
them on a local chain and checks the order book: the ladder around NAV, market and limit
orders, cancelling, the session-key account, the buyback from NAV -10% down, the reserve top-up, and
a run of random trading in which the book must hold exactly the ladder plus the escrow of
open orders.

`vault.test.js` checks the leader-run vaults: opening, deposits and the leader's 5%, trading
by the leader only, the two valuations (new shares at the higher of market and NAV, profit
at the lower), the lock, the 10% profit share, redemption in kind with and without
cancelling open orders, and closing.

The previews of the dashboard are part of the test: the book maths is cut out of
`docs/app.js` and compared with the contract's own quotes, unit for unit. `STEPS=400 npm
test` lengthens the random run.

The local chain prints a notice about a missing native module and falls back to
JavaScript; that is harmless.
