// Compiles contracts/perma with the settings the repo documents: optimizer on, 200 runs.
const solc = require('solc'), fs = require('fs'), path = require('path')
const dir = path.join(__dirname, '..', 'contracts/perma')
const sources = {}
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sol'))) sources[f] = { content: fs.readFileSync(path.join(dir, f), 'utf8') }
const input = { language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', // the local test chain predates Cancun
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } }
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: (p) => ({ contents: fs.readFileSync(path.join(dir, p.replace(/^\.\//, '')), 'utf8') }) }))
let bad = false
for (const e of out.errors || []) { if (e.severity === 'error') bad = true; console.log(e.severity.toUpperCase() + ': ' + e.formattedMessage.split('\n').slice(0, 6).join('\n')) }
if (bad) process.exit(1)
const art = {}
for (const f of Object.keys(out.contracts)) for (const [n, c] of Object.entries(out.contracts[f])) {
  art[n] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }
  const size = c.evm.deployedBytecode.object.length / 2
  if (size) console.log(n.padEnd(24) + String(size).padStart(6) + ' bytes' + (size > 24576 ? '   OVER THE 24,576 LIMIT' : ''))
}
fs.writeFileSync(path.join(__dirname, 'artifacts.json'), JSON.stringify(art))
