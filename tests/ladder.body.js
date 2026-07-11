/* Coastline benchmark ladder — frozen-version round-robin with paired seeds.
   Runs inside the eval scope set up by tests/ladder.js (current working tree = host rules engine).

   Usage (from repo root):
     node tests/ladder.js <verA> <verB> [more versions...] [--seeds 0..167] [--out results.jsonl]
     node tests/ladder.js --report results.jsonl
     node tests/ladder.js --sanity <verA> <verB>

   A version spec is: a git ref whose coastline/index.html holds the frozen engine
   (e.g. acb7bde, HEAD~1), a path to a frozen index.html copy, or "work" (working tree).
   Versions must be >= v0.2.26 (need the AI/BOOT markers and aiStep/aiShouldJSN/keepScore).

   Design:
   - HOST RULES, FROZEN BRAINS. The working-tree engine supplies game rules; each
     version's AI section (between the AI and BOOT markers) is evaluated in its own
     closure over those rules and returns its brain API. The three global call points
     the engine uses (aiStep, aiShouldJSN, keepScore) are replaced with per-seat
     dispatchers, and player.tuneW carries each version's genome into shared engine
     code (payment DP). Limitation: structural changes to ENGINE-section AI code
     (e.g. the payment DP itself) are not captured — move such logic behind a
     dispatchable function when it first diverges.
   - PAIRED SEEDS. Math.random is a seeded PRNG per game; the same seed gives the
     identical shuffle and opening hands across all seat assignments of that seed.
     Per seed and per pair (A,B), 6 games are played: A solo vs 2xB in each of the
     3 seats, and B solo vs 2xA likewise.
   - STATS. Head-to-head share of decided wins (0.5 = equal) with a seed-clustered
     95% CI, plus each side's solo win rate vs the 33.3% baseline. Per the project
     measurement standard, a difference is real only if the CI excludes the null.
   - "0..167" means seeds 0..166 inclusive (start..end, end exclusive): 167 seeds
     x 6 games = 1002 paired games per pair. Chunk long runs across invocations
     with --seeds a..b --out FILE, then aggregate with --report FILE.
*/
(function(){
  // engine log() accumulates into a never-trimmed array (O(n^2) over long runs);
  // presentation-only, rebind to a no-op for headless play (same eval scope).
  log = function(){};
  const cp = require('child_process');
  const lpath = require('path');
  const ROOT = lpath.join(__dirname, '..');

  /* ---------- CLI ---------- */
  const argv = process.argv.slice(2);
  const opts = { seeds:'0..30', out:null, report:null, sanity:false, specs:[] };
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a==='--seeds') opts.seeds = argv[++i];
    else if(a==='--out') opts.out = argv[++i];
    else if(a==='--report') opts.report = argv[++i];
    else if(a==='--sanity') opts.sanity = true;
    else opts.specs.push(a);
  }

  /* ---------- version loading ---------- */
  const M_START = '/* ================= AI ================= */';
  const M_END   = '/* ================= BOOT ================= */';
  function sourceOf(spec){
    if(spec==='work') return fs.readFileSync(lpath.join(ROOT,'engine','index.html'),'utf8');
    if(fs.existsSync(spec)) return fs.readFileSync(spec,'utf8');
    return cp.execSync('git show '+spec+':engine/index.html', {cwd:ROOT, maxBuffer:64*1024*1024}).toString();
  }
  function brainOf(spec){
    const vsrc = sourceOf(spec);
    const a = vsrc.indexOf(M_START), b = vsrc.indexOf(M_END);
    if(a<0 || b<0 || b<=a) throw new Error('ladder: AI/BOOT markers not found in "'+spec+'" (versions >= v0.2.26 required)');
    const sect = vsrc.slice(a, b).replace(/<\/script>\s*<script>/g, ';');
    const brain = eval('(function(){\n'+sect+'\n;return {'+
      'AI_W: typeof AI_W!=="undefined" ? AI_W : null,'+
      'aiStep: typeof aiStep==="function" ? aiStep : null,'+
      'aiShouldJSN: typeof aiShouldJSN==="function" ? aiShouldJSN : null,'+
      'keepScore: typeof keepScore==="function" ? keepScore : null'+
      '};})()');
    ['AI_W','aiStep','aiShouldJSN','keepScore'].forEach(k=>{
      if(!brain[k]) throw new Error('ladder: version "'+spec+'" is missing '+k);
    });
    brain.name = spec;
    return brain;
  }

  /* ---------- per-seat brain dispatch (the 3 global call points) ---------- */
  let SEAT = [null,null,null];
  aiStep      = (p)=>SEAT[G.turn].aiStep(p);
  aiShouldJSN = (p,defIdx,atkIdx,desc,count)=>SEAT[defIdx].aiShouldJSN(p,defIdx,atkIdx,desc,count);
  keepScore   = (c,p)=>SEAT[G.players.indexOf(p)].keepScore(c,p);

  /* ---------- seeded RNG + game runner ---------- */
  function mulberry32(seed){
    let s = (seed>>>0) + 0x9E3779B9;
    return function(){
      s |= 0; s = (s + 0x6D2B79F5)|0;
      let t = Math.imul(s ^ (s>>>15), 1|s);
      t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t;
      return ((t ^ (t>>>14))>>>0) / 4294967296;
    };
  }
  const pump = ()=>{ let n=0; while(timers.length && n<20000){ const f=timers.shift(); try{f();}catch(e){} n++; } };
  const trueRandom = Math.random;
  function playGame(seed, brains){
    SEAT = brains;
    timers.length = 0; // drain queued callbacks from BOOT / the previous game — determinism depends on this
    Math.random = mulberry32(seed);
    newGame();
    G.players[0].isAI = true;
    for(let i=0;i<3;i++) G.players[i].tuneW = brains[i].AI_W;
    startTurn(); pump();
    let guard = 0;
    while(!G.over && guard<600){ if(timers.length){ pump(); } else { aiStep(cur()); pump(); } guard++; }
    Math.random = trueRandom;
    if(!G.over) return { winner:-1, turns:G.turnCount };
    return { winner: G.players.findIndex(p=>completeColors(p).length>=3), turns:G.turnCount };
  }

  /* ---------- pairing: 6 games per seed per pair ---------- */
  function runPair(A, B, seedFrom, seedTo, emit){
    for(let seed=seedFrom; seed<seedTo; seed++){
      for(const solo of [A,B]){
        const fill = solo===A ? B : A;
        for(let seat=0; seat<3; seat++){
          const brains = [fill,fill,fill]; brains[seat] = solo;
          const r = playGame(seed, brains);
          emit({ vA:A.name, vB:B.name, seed, solo:solo.name, seat,
                 winner: r.winner<0 ? null : brains[r.winner].name, turns:r.turns });
        }
      }
    }
  }

  /* ---------- stats: seed-clustered mean ± 95% CI ---------- */
  function clusterStat(perSeedValues){
    const xs = perSeedValues.filter(x=>x!=null);
    const n = xs.length;
    if(n<2) return { m:NaN, ci:NaN, n };
    const m = xs.reduce((a,b)=>a+b,0)/n;
    const v = xs.reduce((a,x)=>a+(x-m)*(x-m),0)/(n-1);
    return { m, ci: 1.96*Math.sqrt(v/n), n };
  }
  const pct = x => (x*100).toFixed(1)+'%';
  const pp  = x => (x*100).toFixed(1)+'pp';

  function report(records){
    const pairs = new Map();
    records.forEach(r=>{
      const key = r.vA+' vs '+r.vB;
      if(!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(r);
    });
    pairs.forEach((rs, key)=>{
      const [vA, vB] = [rs[0].vA, rs[0].vB];
      const seeds = new Map();
      rs.forEach(r=>{
        if(!seeds.has(r.seed)) seeds.set(r.seed, {aW:0,bW:0,undec:0, soloA:{n:0,w:0}, soloB:{n:0,w:0}});
        const s = seeds.get(r.seed);
        if(r.winner===null) s.undec++;
        else if(r.winner===vA) s.aW++; else s.bW++;
        const solo = r.solo===vA ? s.soloA : s.soloB;
        solo.n++; if(r.winner===r.solo) solo.w++;
      });
      const shareA = clusterStat([...seeds.values()].map(s=> (s.aW+s.bW)>0 ? s.aW/(s.aW+s.bW) : null));
      const soloA  = clusterStat([...seeds.values()].map(s=> s.soloA.n>0 ? s.soloA.w/s.soloA.n : null));
      const soloB  = clusterStat([...seeds.values()].map(s=> s.soloB.n>0 ? s.soloB.w/s.soloB.n : null));
      const total = rs.length, undec = rs.filter(r=>r.winner===null).length;
      let verdict = 'NO significant difference (share CI includes 50%)';
      if(shareA.m - shareA.ci > 0.5) verdict = vA+' is STRONGER (share CI excludes 50%)';
      if(shareA.m + shareA.ci < 0.5) verdict = vB+' is STRONGER (share CI excludes 50%)';
      console.log('=== LADDER: '+key+' ===');
      console.log('  games: '+total+' over '+seeds.size+' shared-deck seeds ('+(total-undec)+' decided, '+undec+' unfinished)');
      console.log('  head-to-head share of wins, '+vA+': '+pct(shareA.m)+' ± '+pp(shareA.ci)+' (95% CI, seed-clustered; 50% = equal)');
      console.log('  solo win rate '+vA+' vs 2x '+vB+': '+pct(soloA.m)+' ± '+pp(soloA.ci)+' (baseline 33.3%)');
      console.log('  solo win rate '+vB+' vs 2x '+vA+': '+pct(soloB.m)+' ± '+pp(soloB.ci)+' (baseline 33.3%)');
      console.log('  verdict: '+verdict);
    });
  }

  /* ---------- sanity mode: pairing mechanics self-check ---------- */
  function sanity(A, B){
    let ok = true;
    const check = (name, cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) ok=false; };
    const deckSnap = (seed)=>{ Math.random = mulberry32(seed); newGame(); Math.random = trueRandom;
      return JSON.stringify(G.deck.map(c=>keyOf ? keyOf(c) : c.t)) + '|' + JSON.stringify(G.players.map(p=>p.hand.map(c=>c.name||c.t))); };
    check('same seed -> identical shuffle and opening hands', deckSnap(7)===deckSnap(7));
    check('different seeds -> different shuffles', deckSnap(7)!==deckSnap(8));
    const g1 = playGame(3, [A,B,B]), g2 = playGame(3, [A,B,B]);
    check('same seed + same seats -> identical game (winner & turns)', g1.winner===g2.winner && g1.turns===g2.turns);
    const g3 = playGame(3, [B,A,B]);
    check('game completes under rotated seats', g3.turns>0);
    process.exitCode = ok ? 0 : 1;
  }

  /* ---------- main ---------- */
  if(opts.report){
    const records = fs.readFileSync(opts.report,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
    console.log('loaded '+records.length+' game records from '+opts.report);
    report(records);
    return;
  }
  if(opts.specs.length<2){ console.error('ladder: need at least two version specs (git ref, file path, or "work")'); process.exitCode=1; return; }
  const brains = opts.specs.map(brainOf);
  brains.forEach((b,i)=>{ // duplicate specs (e.g. a self-match) must stay distinguishable in win attribution
    if(brains.some((o,j)=>j!==i && o.name===b.name)) b.name = b.name+'#'+(i+1);
  });
  if(opts.sanity){ sanity(brains[0], brains[1]); return; }

  const mm = /^(\d+)\.\.(\d+)$/.exec(opts.seeds);
  if(!mm){ console.error('ladder: --seeds wants a..b (b exclusive), got "'+opts.seeds+'"'); process.exitCode=1; return; }
  const [s0, s1] = [+mm[1], +mm[2]];
  const t0 = Date.now();
  const records = [];
  const outFd = opts.out ? fs.openSync(opts.out, 'a') : null;
  const emit = r => { records.push(r); if(outFd!==null) fs.writeSync(outFd, JSON.stringify(r)+'\n'); };
  for(let i=0;i<brains.length;i++) for(let j=i+1;j<brains.length;j++) runPair(brains[i], brains[j], s0, s1, emit);
  if(outFd!==null) fs.closeSync(outFd);
  const secs = (Date.now()-t0)/1000;
  console.log(records.length+' games in '+secs.toFixed(1)+'s ('+(secs*1000/records.length).toFixed(0)+'ms/game), seeds '+s0+'..'+(s1-1));
  if(opts.out) console.log('appended to '+opts.out+' — aggregate with: node tests/ladder.js --report '+opts.out);
  else report(records);
})();
