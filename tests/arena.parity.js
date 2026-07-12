// Arena parity suite (`npm run test:arena`).
// Guards engine/arena.html the way trainer/learn parity guards their pages:
//   1. DUEL WORKER — boot worker-boot + arena-core exactly as the browser does;
//      arm brains with and without a net; play real seed blocks. Contracts:
//      self-match must be perfectly symmetric (d_i = 0: the ± 0.0pp fingerprint),
//      the same seed must replay bit-identically, a net must actually arm and
//      change play eventually (weights reachable ≠ decorative).
//   2. STATS — the Robbins-mixture boundary must match the page's pre-committed
//      constants, be monotone, keep a true null running (no crossing over a long
//      simulated stream) and certify a large true effect quickly.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const check = (name, cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) fails++; };

const html = fs.readFileSync(path.join(ROOT,'engine','arena.html'),'utf8');
const grab = id => new RegExp('<script type="text/plain" id="'+id+'">([\\s\\S]*?)</script>').exec(html)[1];
const bootSrc = grab('worker-boot');
const core = grab('arena-core');
const engineHtml = fs.readFileSync(path.join(ROOT,'engine','index.html'),'utf8');
const engine = [...engineHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
const M_START = '/* ================= AI ================= */';
const M_END   = '/* ================= BOOT ================= */';
const a = engine.indexOf(M_START), b = engine.indexOf(M_END);
const aiSection = engine.slice(a,b).replace(/<\/script>\s*<script>/g, ';');

/* ---------- node worker sim (standard stubs; real workers provide these) ---------- */
global.self = global;
global.addEventListener = global.addEventListener || (()=>{});
global.navigator = global.navigator || {};
global.location = global.location || { reload(){} };
let outbox = [];
global.postMessage = (m)=>outbox.push(m);
function bootWorker(){ // fresh function scope per boot — bootSrc declares consts
  outbox = [];
  (function(){ eval(bootSrc); })();
  self.onmessage({ data: { type:'boot', engine, core } });
  return outbox;
}
const msg = (m)=>{ self.onmessage({ data:m }); };
const last = (t)=>{ for(let i=outbox.length-1;i>=0;i--) if(outbox[i].type===t) return outbox[i]; return null; };

/* ---------- part 1: self-match symmetry (the ladder's ±0.0pp law) ---------- */
bootWorker();
check('worker boots and core posts ready from inside the eval', !!last('ready') && !last('fatal') || (console.log('   fatal: '+(last('fatal')||{}).msg), false));
msg({type:'setup', aiSection, net:null});
check('brains arm without a net', !!last('armed') && last('armed').net===false);
msg({type:'play', seed:70001});
const s1 = last('seed');
check('a seed block returns 6 games', !!s1 && s1.decided>0 && s1.decided<=6 && s1.sn===3 && s1.bn===3);
check('self-match is perfectly symmetric (work wins exactly half)', !!s1 && s1.W === s1.decided/2);
msg({type:'play', seed:70002});
const s2 = last('seed');
check('second self-match seed also symmetric', !!s2 && s2.W === s2.decided/2);
outbox.length = 0;
msg({type:'play', seed:70001});
const s1b = last('seed');
check('same seed replays bit-identically', !!s1b && JSON.stringify({W:s1b.W,d:s1b.decided,sw:s1b.sw,bw:s1b.bw})===JSON.stringify({W:s1.W,d:s1.decided,sw:s1.sw,bw:s1.bw}));

/* ---------- part 2: net actually arms and reaches play ---------- */
const netFile = path.join(ROOT,'nets','value-gym-v1.json');
const net = JSON.parse(fs.readFileSync(netFile,'utf8'));
msg({type:'setup', aiSection, net});
check('brains re-arm with the real net', !!last('armed') && last('armed').net===true);
let diverged = false, blocks = 0;
for(let seed=70001; seed<70009 && !diverged; seed++){
  outbox.length = 0;
  msg({type:'play', seed});
  const r = last('seed');
  if(!r) break;
  blocks++;
  if(r.W !== r.decided/2) diverged = true; // any asymmetry proves the net changed play
}
check('net changes play within a few seeds (weights are live, not decorative)', diverged);
console.log('   ('+blocks+' seed blocks to diverge)');

/* ---------- part 3: the pre-committed anytime boundary ---------- */
const ALPHA = 0.05, RHO = 100;
const mBound = /const ALPHA = ([\d.]+), RHO = (\d+), PRACTICAL = ([\d.]+)/.exec(html);
check('page pins the pre-committed constants (alpha 0.05, rho 100, practical 0.5pp)',
  !!mBound && +mBound[1]===ALPHA && +mBound[2]===RHO && +mBound[3]===0.005);
const boundary = V => Math.sqrt((V+RHO) * Math.log((V+RHO)/(RHO*ALPHA*ALPHA)));
check('boundary is monotone in V', boundary(100)<boundary(1000) && boundary(1000)<boundary(10000));
// a true null must survive a long adversarial stream without crossing
let s = 99, S=0, V=0, crossed=false;
const rnd = ()=>{ s=(s*48271)%2147483647; return s/2147483647; };
for(let i=0;i<20000;i++){
  let d=0; for(let g=0;g<6;g++) d += rnd()<0.5 ? 0.5 : -0.5; // fair 6-game block
  S += d; V += d*d;
  if(Math.abs(S) >= boundary(V)){ crossed = true; break; }
}
check('a true null runs 20,000 seed blocks without a false verdict', !crossed);
// a real +5pp effect must certify, and fast
S=0; V=0; let crossAt=0;
for(let i=0;i<20000;i++){
  let d=0; for(let g=0;g<6;g++) d += rnd()<0.55 ? 0.5 : -0.5;
  S += d; V += d*d;
  if(S >= boundary(V)){ crossAt = (i+1)*6; break; }
}
check('a true +5pp edge certifies (crossed at '+crossAt+' games)', crossAt>0 && crossAt<20000);

console.log(fails===0 ? 'ALL ARENA PARITY TESTS PASS' : 'FAILURES: '+fails);
process.exit(fails===0?0:1);
