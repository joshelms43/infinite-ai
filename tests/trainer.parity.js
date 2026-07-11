// Coastline trainer parity + boot suite (`npm run test:trainer`).
// Guards the contract between tests/trainer.body.js and coastline/trainer.html:
//   1. LOGIC PARITY — the page's shared-logic block, driven the way the worker pool
//      drives it (batch dispatch, WORST-CASE reverse-order completion through the
//      commit buffer), must reproduce a `node tests/trainer.js` run bit-for-bit.
//   2. WORKER BOOT — the page's worker-boot block is executed exactly as a browser
//      worker would: stubs up, then boot message with engine+core. This regression-
//      tests the v0.4.3 bug where 'ready' read AI_W outside the eval scope (engine
//      consts are eval-scoped — the documented harness quirk) and every page load
//      died with "AI_W is not defined".
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TINY = {LAMBDA:4, MU:2, RUNG_SEEDS:[3,8], RUNG_KEEP:[2], CONFIRM_SEEDS:5};
const TMP = path.join(require('os').tmpdir(), 'coastline-parity-'+process.pid+'.json');

let fails = 0;
const check = (name, cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) fails++; };

const html = fs.readFileSync(path.join(ROOT,'engine','trainer.html'),'utf8');
const grab = id => new RegExp('<script type="text/plain" id="'+id+'">([\\s\\S]*?)</script>').exec(html)[1];
const logic = grab('trainer-logic');
const bootSrc = grab('worker-boot');
const coreSrc = grab('worker-core');
const engineHtml = fs.readFileSync(path.join(ROOT,'engine','index.html'),'utf8');
const engine = [...engineHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');

/* ---------- part 1: logic parity (in-process stubs, like tests/trainer.js) ---------- */
const el = () => new Proxy({classList:{add(){},remove(){},toggle(){}},style:{}},{
  get(t,k){ if(k in t) return t[k]; return ()=>{}; }, set(){ return true; }
});
global.document = { querySelector:()=>el(), querySelectorAll:()=>[], createElement:()=>el(), getElementById:()=>el(), addEventListener:()=>{}, body:{appendChild(){}} };
global.window = global; global.addEventListener = ()=>{};
global.requestAnimationFrame = fn=>fn(); global.navigator = {}; global.location = {reload(){}};
const timers=[]; global.setTimeout=(fn)=>{timers.push(fn); return timers.length;}; global.clearTimeout=()=>{};

const wcoreFns = coreSrc.replace(/self\.onmessage[\s\S]*$/, ''); // strip worker plumbing, keep playGame/seedBlock
const browserFingerprint = eval(engine + '\n;\n' + wcoreFns + '\n;\n' + logic + `
;(function(){
  const logs0 = (typeof logs==='undefined' ? -1 : logs.length); // BOOT logs a line or two during engine eval — only growth during play matters
  const S = freshState(AI_W, ${JSON.stringify(TINY)});
  let guard = 0;
  while(S.gen<=3 && guard++<100000){
    advance(S, ()=>{});
    if(S.gen>3) break;
    const need = needsGames(S);
    if(!need) continue;
    const cb = makeCommitBuffer(S, need.rec);
    const jobs = [];
    for(let i=need.rec.seedsDone; i<need.target; i++) jobs.push({idx:i, seed:need.seedOf(i)});
    jobs.reverse().forEach(j=>{ cb.push(j.idx, seedBlock(j.seed, need.rec.genome, S.champion)); }); // worst-case order
  }
  advance(S, ()=>{});
  // logsLen guards the O(n^2) engine-logger leak: headless drivers rebind log() to a
  // no-op, so the never-trimmed logs array must stay empty across thousands of games.
  return JSON.stringify({gen:S.gen, history:S.history, mean:S.mean, sigma:S.sigma, champion:S.champion, totalGames:S.totalGames,
                         logsGrowth: (typeof logs==='undefined' ? -1 : logs.length - logs0)});
})();`);

try{ fs.unlinkSync(TMP); }catch(e){}
cp.execSync('node '+JSON.stringify(path.join(ROOT,'tests','trainer.js'))+
  ' --state '+JSON.stringify(TMP)+" --config '"+JSON.stringify(TINY)+"' --gens 3 --seconds 60",
  {cwd:ROOT, stdio:'ignore'});
const N = JSON.parse(fs.readFileSync(TMP,'utf8'));
const B = JSON.parse(browserFingerprint);
check('engine logger stays silent across thousands of headless games (O(n^2) leak regression)', B.logsGrowth===0);
check('page shared-logic (reverse-order commits) matches node trainer bit-for-bit over 3 generations',
  JSON.stringify(B.history)===JSON.stringify(N.history) && JSON.stringify(B.mean)===JSON.stringify(N.mean) &&
  Math.abs(B.sigma-N.sigma)<1e-12 && JSON.stringify(B.champion)===JSON.stringify(N.champion) &&
  B.totalGames===N.totalGames && B.gen===N.gen);
try{ fs.unlinkSync(TMP); }catch(e){}

/* ---------- part 2: worker boot, exactly as a browser worker runs it ---------- */
global.self = global;
const outbox = [];
global.postMessage = m => outbox.push(m); // worker-global postMessage
eval(bootSrc); // installs stubs + boot onmessage handler on self
self.onmessage({ data: { type:'boot', engine, core: coreSrc } });
const ready = outbox.find(m=>m.type==='ready');
const fatal = outbox.find(m=>m.type==='fatal');
check('worker boot posts ready (no eval-scope errors)', !!ready && !fatal || (console.log('   fatal was: '+(fatal&&fatal.msg)), false));
check('ready carries the engine AI_W genome (the v0.4.3 regression)',
  !!ready && ready.AI_W && typeof ready.AI_W==='object' && Object.keys(ready.AI_W).length>=20);
if(ready){
  // NB: cand and champ must be distinct objects (seedBlock attributes wins by
  // reference) — in real runs postMessage's structured clone guarantees this.
  const candClone = JSON.parse(JSON.stringify(ready.AI_W));
  outbox.length = 0;
  self.onmessage({ data: { type:'block', id:1, seed:42, cand:candClone, champ:ready.AI_W } });
  const r1 = outbox.find(m=>m.type==='res');
  check('booted worker plays a seed block (6 decided games)', !!r1 && r1.cW + r1.kW === 6);
  check('mirror block splits exactly 3–3 (candidate === champion)', !!r1 && r1.cW===3 && r1.kW===3);
  outbox.length = 0;
  self.onmessage({ data: { type:'block', id:2, seed:42, cand:candClone, champ:ready.AI_W } });
  const r2 = outbox.find(m=>m.type==='res');
  check('block replay is deterministic', !!r1 && !!r2 && r1.cW===r2.cW && r1.kW===r2.kW);
}

/* ---------- part 3: main-thread eval scope (the v0.4.4 regression) ----------
   The page's main script does `eval(trainer-logic)` and then calls the helpers from
   OUTSIDE the eval. In a direct eval, function declarations leak to the caller's
   scope but const/let do NOT — so every helper the main script touches must be a
   function declaration. cfg/pct/clone/shareOf were const arrows once; every page
   load crashed in render() with "cfg is not defined". */
const MAIN_API = ['cfg','pct','clone','shareOf','advance','needsGames','makeCommitBuffer','migrate','freshState','evalRec','commitBlock','sampleCandidate'];
const mainScope = (function(){
  eval(logic);
  const out = {};
  MAIN_API.forEach(n=>{ try{ out[n] = eval('typeof '+n); }catch(e){ out[n]='error'; } });
  let smoke = false;
  try{ smoke = typeof cfg({}).LAMBDA==='number' && pct(0.5)==='50.0%' && typeof shareOf({shares:[0.5,0.5]}).m==='number'; }catch(e){}
  return {out, smoke};
})();
MAIN_API.forEach(n=>{
  check("main-thread eval exposes '"+n+"' (function declaration, not const)", mainScope.out[n]==='function');
});
check('main-thread helpers work outside the eval (cfg/pct/shareOf smoke)', mainScope.smoke);

/* ---------- part 4: full pipeline — real scheduler, hostile fake workers ----------
   Drives the page's pool-scheduler block with fake workers that complete blocks in
   RANDOMIZED order and crash once mid-run. Asserts the run is bit-identical to the
   sequential node run AND that no seed block is ever played twice (the v0.4.5
   scheduler derived indices from seedsDone + inflight, which duplicated dispatches
   after out-of-order returns, and a stranded job could freeze the run at 0 games/s). */
(function(){
  // part 2's boot sim pointed global.setTimeout at ITS timer queue; part 4 replays
  // games through part 1's playGame, which drains the module-scope queue — realign.
  global.setTimeout = (fn)=>{ timers.push(fn); return timers.length; };
  const schedSrc = grab('pool-scheduler');
  eval(schedSrc); // function declaration leaks to this scope — same mechanism as the page
  const baseAI = JSON.parse(JSON.stringify((typeof ready!=='undefined' && ready && ready.AI_W) || null));
  check('scheduler sim has the engine genome from boot', !!baseAI);
  if(!baseAI) return;

  const S = freshState(baseAI, TINY);
  const queue = []; // in-flight fake jobs
  let plays = 0, crashed = false;
  const seen = new Set(); // duplicate-dispatch detector: one play per (genome, seed)
  const rng = (()=>{ let x = 12345; return ()=>{ x = (x*48271)%2147483647; return x/2147483647; }; })();
  const logs = [];
  const env = {
    S, workerCount: 3,
    post: (slot, job)=>{ queue.push({slot, job}); },
    log: m=>logs.push(m),
    checkpoint: ()=>{},
    stop: ()=>S.gen>3,
  };
  const sim = makeScheduler(env);
  sim.start();
  let guard = 0;
  while(queue.length && guard++<100000){
    const pick = Math.floor(rng()*queue.length); // hostile completion order
    const {slot, job} = queue.splice(pick,1)[0];
    if(!crashed && S.totalGames>60){ // one worker "crashes" mid-run: job vanishes, error event fires
      crashed = true;
      sim.onWorkerError(slot, 'simulated crash');
      continue;
    }
    const key = job.seed+'|'+JSON.stringify(job.cand);
    check.dup = check.dup || seen.has(key);
    seen.add(key);
    plays++;
    const res = seedBlock(job.seed, job.cand, job.champ);
    sim.onResult({id:job.id, cW:res.cW, kW:res.kW});
  }
  check('pipeline reaches the generation cap without stalling', S.gen>3);
  check('no seed block ever dispatched twice (duplicate-dispatch regression)', !check.dup);
  check('crashed worker\'s block recycled and replayed (run self-heals)', crashed && logs.some(m=>/recycled/.test(m)));
  check('zero wasted games: plays x 6 === committed games', plays*6===S.totalGames);
  check('pipeline state matches the sequential node run bit-for-bit',
    JSON.stringify(S.history)===JSON.stringify(N.history) && JSON.stringify(S.mean)===JSON.stringify(N.mean) &&
    Math.abs(S.sigma-N.sigma)<1e-12 && JSON.stringify(S.champion)===JSON.stringify(N.champion) &&
    S.totalGames===N.totalGames && S.gen===N.gen);
})();

console.log(fails===0 ? 'ALL TRAINER PARITY TESTS PASS' : 'FAILURES: '+fails);
process.exit(fails===0?0:1);
