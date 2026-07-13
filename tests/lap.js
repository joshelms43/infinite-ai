/* AlphaZero lap — one automated generation of the value-net flywheel.

   Chains the trusted scripts (adds NO new statistics): generate net-guided self-play
   with the current champion, train a candidate net, then certify candidate-vs-champion
   on the ladder across TWO independent seed ranges (a screen, then a fresh-seed
   confirmation). Promotes the candidate ONLY if it clears the ladder's own bar —
   seed-clustered 95% CI on the head-to-head share excluding 50% — in BOTH ranges.
   Two independent one-look tests is stricter than one look: the winner's-curse
   discipline, not a way around it.

   Usage:
     node tests/lap.js [--champion nets/value-champion.json] [--games 40000] [--epochs 5]
                       [--screen 0..500] [--confirm 500..1000] [--workers N]
                       [--greedy]   # gen without search (fast; plumbing tests only)
                       [--stamp S]
*/
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };

const champion = opt('--champion', 'nets/value-champion.json');
const games    = opt('--games', '40000');
const epochs   = opt('--epochs', '5');
const screen   = opt('--screen', '0..500');
const confirm  = opt('--confirm', '500..1000');
const workers  = opt('--workers', String(os.cpus().length));
const mc       = !a.includes('--greedy');
const stamp    = opt('--stamp', new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15) + 'Z');

function run(cmd) { console.log('\n$ ' + cmd); return cp.execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 }).toString(); }

if (!fs.existsSync(path.join(ROOT, champion))) { console.error('champion net not found: ' + champion); process.exit(2); }
const cand = 'nets/candidate-' + stamp + '.json';
const data = '/tmp/lap-' + stamp + '.bin';

// 1) generate self-play with the champion (net-guided unless --greedy), sharded across cores
run('node tests/selfplay.par.js --gen ' + data + ' --games ' + games + ' ' + (mc ? '--mc --net ' + champion : '') + ' --workers ' + workers);
// 2) train the candidate net on that data
run('node tests/selfplay.js --train ' + data + ' --out ' + cand + ' --epochs ' + epochs);

// candidate is spec #1 (ladder renames it "work#1"); champion is spec #2 (stays "work")
function ladder(seeds, tag) {
  const out = '/tmp/lap-' + stamp + '-' + tag + '.jsonl';
  run('node tests/ladder.js work work --nets ' + cand + ',' + champion + ' --seeds ' + seeds + ' --out ' + out);
  const rep = run('node tests/ladder.js --report ' + out);
  console.log(rep);
  return { strongerCand: /work#1 is STRONGER/.test(rep), strongerChamp: /\bwork is STRONGER/.test(rep) };
}

console.log('\n=== SCREEN: candidate vs champion, seeds ' + screen + ' ===');
const s = ladder(screen, 'screen');
let promoted = false, note;
if (s.strongerCand) {
  console.log('\n=== CONFIRM: fresh seeds ' + confirm + ' ===');
  const c = ladder(confirm, 'confirm');
  if (c.strongerCand) { promoted = true; note = 'candidate STRONGER in screen AND fresh-seed confirmation'; }
  else note = "candidate won the screen but FAILED fresh-seed confirmation (winner's curse) — kept champion";
} else {
  note = s.strongerChamp ? 'candidate is WEAKER than champion — kept champion'
                         : 'no significant difference — kept champion';
}

if (promoted) fs.copyFileSync(path.join(ROOT, cand), path.join(ROOT, champion));

const md = '# AlphaZero lap ' + stamp + '\n\n'
  + '- champion: `' + champion + '`\n'
  + '- candidate: `' + cand + '`\n'
  + '- generation: ' + games + ' games ' + (mc ? '(net-guided by champion)' : '(greedy)') + ' | epochs ' + epochs + ' | workers ' + workers + '\n'
  + '- screen seeds: ' + screen + ' | confirm seeds: ' + confirm + '\n'
  + '- **DECISION: ' + (promoted ? 'PROMOTED candidate -> champion' : 'kept champion') + '**\n'
  + '- ' + note + '\n';
fs.mkdirSync(path.join(ROOT, 'ladder-results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'ladder-results/' + stamp + '-az-lap.md'), md);
console.log('\n' + md + '\nRESULT: ' + (promoted ? 'PROMOTED' : 'kept champion'));
