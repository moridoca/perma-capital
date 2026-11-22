# Tests

    cd test
    npm install
    npm test

`compile.js` compiles every contract in `contracts/perma` (optimizer on, 200 runs) and
prints the deployed size of each against the 24,576-byte limit. `book.test.js` deploys
them on a local chain and checks the order book: the ladder around NAV, market and limit
orders, cancelling, the session-key account, the buyback at the bottom of the ladder, and
a run of random trading in which the book must hold exactly the ladder plus the escrow of
open orders.

The previews of the dashboard are part of the test: the book maths is cut out of
`docs/app.js` and compared with the contract's own quotes, unit for unit. `STEPS=400 npm
test` lengthens the random run.

The local chain prints a notice about a missing native module and falls back to
JavaScript; that is harmless.
