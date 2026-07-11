/* Coastline genome trainer — paired-seed evolution strategy with successive-halving
   rungs and CI-gated promotion. Runs inside the eval scope set up by tests/trainer.js.
   Supersedes the retired train.js: the 10k-game null result showed naive mutation
   with 105-game evals is winner's-curse noise, so this trainer is built around the
   project measurement standard instead.

   Usage (from repo root):
     node tests/trainer.js --state FILE.json [--seconds 30] [--gens N]  # start/resume
     node tests/trainer.js --state FILE.json --status                   # progress, no games
     node tests/trainer.js --state FILE.json --export CH.json           # champion genome
     node tests/trainer.js --state FILE.json --config '{"LAMBDA":16}'   # fresh state w/ overrides
     node tests/trainer.js --sanity                                     # mechanics self-checks

   Design:
   - GENOME-SPACE (log-normal) ES. Each generation samples LAMBDA candidates around a
     search mean (multiplicative noise, genes floored at 0.01) and evaluates them
     against the reigning champion with PAIRED SEEDS and common random numbers: every
     candidate in a generation sees the same seed blocks; each seed plays 6 games —
     candidate solo in all 3 seats vs 2x champion, and the mirror.
   - SUCCESSIVE-HALVING RUNGS (the efficiency lever): every candidate first gets a
     cheap screen (RUNG_SEEDS[0] paired seeds); only the RUNG_KEEP[0] best advance to
     the full eval (RUNG_SEEDS[1] seeds). Losers stop early — with the default config
     that cuts games per generation by ~45% at the same selection quality, because
     most of a flat generation is losers.
   - CI-GATED PROMOTION (unchanged, non-negotiable): the generation best is confirmed
     on CONFIRM_SEEDS x 6 >= 1,000 fresh paired games only if its search CI already
     excludes 50%; the champion is replaced only if the confirmation CI excludes 50%
     too. Rungs and parallelism buy more search per hour, never a lower bar.
   - RESUMABLE + DETERMINISTIC. State checkpoints to --state FILE after every seed
     block; candidate sampling is derived from (generation, index); a resumed run is
     bit-identical to an uninterrupted one (sanity-checked). Config lives in the
     state file, so a run keeps its own parameters even if defaults change later.
   - BROWSER TWIN: coastline/trainer.html runs the same logic with a Web Worker POOL
     (one engine per core) for overnight runs. The shared-logic functions there are
     VERBATIM copies of the ones marked below — change here first, mirror there.
     State JSON is interchangeable in both directions. v1 (pre-rung) states are
     migrated on load: champion/history/ES state survive, the in-progress generation
     restarts.
*/
(function(){
  /* ---------- CLI ---------- */
  const argv = process.argv.slice(2);
  const opts = { state:null, seconds:30, gens:Infinity, status:false, export:null, sanity:false, config:null };
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a==='--state') opts.state = argv[++i];
    else if(a==='--seconds') opts.seconds = +argv[++i];
    else if(a==='--gens') opts.gens = +argv[++i];
    else if(a==='--status') opts.status = true;
    else if(a==='--export') opts.export = argv[++i];
    else if(a==='--config') opts.config = JSON.parse(argv[++i]);
    else if(a==='--sanity') opts.sanity = true;
  }

  /* ================================================================
     SHARED LOGIC — everything between these markers is copied VERBATIM
     into coastline/trainer.html (trainer-logic block). Edit here first.
     ================================================================ */
  const DEFAULTS = {
    LAMBDA: 12, MU: 4,
    RUNG_SEEDS: [16, 50], RUNG_KEEP: [4],
    CONFIRM_SEEDS: 167,
    SIGMA0: 0.15, SIGMA_MIN: 0.03, SIGMA_MAX: 0.5,
  };
  const GENE_MIN = 0.01;
  const CONFIRM_SEED_BASE = 10000000; // confirmation seeds never overlap search seeds
  function cfg(S){ return Object.assign({}, DEFAULTS, S.config||{}); } // function decl — must survive direct eval on the page's main thread

  function mulberry32(seed){
    let s = (seed>>>0) + 0x9E3779B9;
    return function(){
      s |= 0; s = (s + 0x6D2B79F5)|0;
      let t = Math.imul(s ^ (s>>>15), 1|s);
      t = (t + Math.imul(t ^ (t>>>7), 61|t)) ^ t;
      return ((t ^ (t>>>14))>>>0) / 4294967296;
    };
  }
  function gauss(rand){ // Box–Muller
    let u = 0, v = 0;
    while(u===0) u = rand();
    while(v===0) v = rand();
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }
  function clusterStat(perSeedValues){ // seed-clustered mean ± 95% CI
    const xs = perSeedValues.filter(x=>x!=null);
    const n = xs.length;
    if(n<2) return { m:NaN, ci:NaN, n };
    const m = xs.reduce((a,b)=>a+b,0)/n;
    const v = xs.reduce((a,x)=>a+(x-m)*(x-m),0)/(n-1);
    return { m, ci: 1.96*Math.sqrt(v/n), n };
  }
  function pct(x){ return (x*100).toFixed(1)+'%'; }
  function clone(w){ return JSON.parse(JSON.stringify(w)); }
  function sampleCandidate(mean, sigma, gen, k){ // deterministic in (gen,k) — resume-safe
    const rand = mulberry32(0x5EED ^ (gen*2654435761>>>0) ^ (k*40503));
    const g = {};
    Object.keys(mean).forEach(key=>{ g[key] = +Math.max(GENE_MIN, mean[key]*Math.exp(sigma*gauss(rand))).toFixed(4); });
    return g;
  }
  function geoMean(genomes){
    const g = {};
    Object.keys(genomes[0]).forEach(key=>{
      const m = Math.exp(genomes.reduce((s,x)=>s+Math.log(Math.max(GENE_MIN,x[key])),0)/genomes.length);
      g[key] = +m.toFixed(4);
    });
    return g;
  }
  function freshState(baseGenome, config){
    const S = { schema:2, config: Object.assign({}, DEFAULTS, config||{}) };
    return Object.assign(S, {
      champion: clone(baseGenome), championAge: 0, promotions: 0,
      gen: 1, mean: clone(baseGenome), sigma: S.config.SIGMA0,
      phase: 'search', rung: 0, candIdx: 0,
      candidates: [],           // [{genome, active, seedsDone, cW, kW, shares:[]}]
      confirm: null,            // {genome, seedsDone, cW, kW, shares:[]}
      history: [],              // per-generation summaries
      totalGames: 0,
    });
  }
  function migrate(S, logFn){ // v1 (pre-rung) -> v2: keep the run, restart the open generation
    if(S.schema>=2) return S;
    S.schema = 2; S.config = Object.assign({}, DEFAULTS);
    S.rung = 0; S.phase = 'search'; S.candidates = []; S.candIdx = 0; S.confirm = null;
    (S.history||[]).forEach(h=>{ if(h.challenged && !h.confirm) h.challenged=false; }); // no orphaned confirms
    logFn('state migrated v1 -> v2 (rung schedule): champion, history and ES state kept; in-progress generation restarted');
    return S;
  }
  function evalRec(genome){ return {genome, active:true, seedsDone:0, cW:0, kW:0, shares:[]}; }
  function shareOf(rec){ return clusterStat(rec.shares); }
  function commitBlock(S, rec, res){ // apply one seed block's result (in seed order)
    rec.cW += res.cW; rec.kW += res.kW;
    rec.shares.push((res.cW+res.kW)>0 ? res.cW/(res.cW+res.kW) : null);
    rec.seedsDone++;
    S.totalGames += 6;
  }
  // needsGames: what the run wants next — {rec, seedOf(i)} or null (advance() first).
  function needsGames(S){
    const C = cfg(S);
    if(S.phase==='confirm'){
      const rec = S.confirm;
      if(rec.seedsDone < C.CONFIRM_SEEDS) return { rec, target:C.CONFIRM_SEEDS, seedOf:i=>CONFIRM_SEED_BASE + S.gen*C.CONFIRM_SEEDS + i };
      return null;
    }
    if(!S.candidates.length) return null;
    const rec = S.candidates[S.candIdx];
    const target = C.RUNG_SEEDS[S.rung];
    if(rec && rec.active && rec.seedsDone < target) return { rec, target, seedOf:i=>(S.gen-1)*C.RUNG_SEEDS[C.RUNG_SEEDS.length-1] + i };
    return null;
  }
  // advance: perform every state transition that needs NO games. Returns when
  // needsGames(S) is non-null or the generation counter passed maxGen.
  function advance(S, logFn){
    const C = cfg(S);
    for(;;){
      if(S.phase==='confirm'){
        const rec = S.confirm;
        if(rec.seedsDone < C.CONFIRM_SEEDS) return;
        const st = shareOf(rec);
        const win = st.m - st.ci > 0.5;
        const h = S.history[S.history.length-1];
        h.confirm = {share:+st.m.toFixed(4), ci:+st.ci.toFixed(4), games:C.CONFIRM_SEEDS*6};
        h.promoted = win;
        if(win){
          S.champion = clone(rec.genome); S.championAge = 0; S.promotions++;
          logFn('gen '+S.gen+': PROMOTED — confirmed '+pct(st.m)+' ± '+pct(st.ci)+' over '+(C.CONFIRM_SEEDS*6)+' fresh paired games');
        } else {
          S.championAge++;
          logFn('gen '+S.gen+': challenge REJECTED at confirmation — '+pct(st.m)+' ± '+pct(st.ci)+' (winner\'s curse caught by the gate)');
        }
        S.phase='search'; S.confirm=null; S.gen++; S.rung=0; S.candidates=[]; S.candIdx=0;
        continue;
      }
      if(!S.candidates.length){
        for(let k=0;k<C.LAMBDA;k++) S.candidates.push(evalRec(sampleCandidate(S.mean, S.sigma, S.gen, k)));
        S.candIdx = 0; S.rung = 0;
      }
      const target = C.RUNG_SEEDS[S.rung];
      const rec = S.candidates[S.candIdx];
      if(rec && rec.active && rec.seedsDone < target) return; // games wanted here
      // move to the next active candidate still short of this rung's target
      const nxt = S.candidates.findIndex((r,i)=> i>S.candIdx && r.active && r.seedsDone<target);
      if(nxt>=0){ S.candIdx = nxt; continue; }
      const anyShort = S.candidates.some(r=>r.active && r.seedsDone<target);
      if(anyShort){ S.candIdx = S.candidates.findIndex(r=>r.active && r.seedsDone<target); continue; }
      // rung complete
      if(S.rung < C.RUNG_SEEDS.length-1){
        const ranked = S.candidates.filter(r=>r.active).map(r=>({r, s:shareOf(r)})).sort((a,b)=>b.s.m-a.s.m);
        ranked.slice(C.RUNG_KEEP[S.rung]).forEach(x=>{ x.r.active = false; });
        logFn('gen '+S.gen+' rung '+S.rung+': cut to '+C.RUNG_KEEP[S.rung]+' of '+ranked.length+' (screen leader '+pct(ranked[0].s.m)+')');
        S.rung++; S.candIdx = S.candidates.findIndex(r=>r.active);
        continue;
      }
      // generation complete
      const survivors = S.candidates.filter(r=>r.active).map(r=>({r, s:shareOf(r)})).sort((a,b)=>b.s.m-a.s.m);
      const best = survivors[0];
      S.mean = geoMean(survivors.slice(0, Math.min(C.MU, survivors.length)).map(x=>x.r.genome));
      // step-size rule: count only *significant* winners — under paired mirroring a
      // neutral candidate sits at ~50% by construction, so raw >50% counts would
      // inflate sigma in flat terrain (null rate of m-ci>0.5 is ~2.5%, target 20%)
      const all = S.candidates.map(r=>shareOf(r));
      const beat = all.filter(s=>s.m - s.ci > 0.5).length/S.candidates.length;
      S.sigma = Math.min(C.SIGMA_MAX, Math.max(C.SIGMA_MIN, S.sigma*Math.exp((beat-0.2)*0.6)));
      const sig = best.s.m - best.s.ci > 0.5;
      S.history.push({gen:S.gen, bestShare:+best.s.m.toFixed(4), bestCI:+best.s.ci.toFixed(4),
                      beatFrac:+beat.toFixed(3), sigma:+S.sigma.toFixed(4), games:S.totalGames, challenged:sig, promoted:false});
      logFn('gen '+S.gen+': best share '+pct(best.s.m)+' ± '+pct(best.s.ci)+' over '+C.RUNG_SEEDS[C.RUNG_SEEDS.length-1]+' seeds; '+
                  (sig ? 'CHALLENGE — confirming on fresh seeds' : 'champion holds (CI includes 50%)'));
      if(sig){ S.phase='confirm'; S.confirm = evalRec(clone(best.r.genome)); continue; }
      S.gen++; S.rung=0; S.candidates=[]; S.candIdx=0; S.championAge++;
      // loop: next generation gets sampled on the next pass
    }
  }
  // makeCommitBuffer: parallel executors complete blocks out of order; results must
  // commit in seed order for state files to stay bit-identical to sequential runs.
  // (Used by the browser worker pool; exercised by the parity test.)
  function makeCommitBuffer(S, rec){
    return {
      next: rec.seedsDone, buf: {},
      push(idx, res){
        this.buf[idx] = res;
        while(this.buf[this.next] !== undefined){
          commitBlock(S, rec, this.buf[this.next]);
          delete this.buf[this.next]; this.next++;
        }
      }
    };
  }
  /* ================================================================
     END SHARED LOGIC
     ================================================================ */

  /* ---------- game runner (engine-scope; the worker owns this in the browser) ---------- */
  // engine log() does logs.unshift() on a never-trimmed array — O(n^2) over long runs.
  // Presentation-only, so headless drivers rebind it to a no-op (same eval scope).
  log = function(){};
  const pump = ()=>{ let n=0; while(timers.length && n<20000){ const f=timers.shift(); try{f();}catch(e){} n++; } };
  const trueRandom = Math.random;
  function playGame(seed, genomes){
    timers.length = 0; // drain BOOT/previous-game callbacks — determinism depends on this
    Math.random = mulberry32(seed);
    newGame();
    G.players[0].isAI = true;
    for(let i=0;i<3;i++) G.players[i].tuneW = genomes[i];
    startTurn(); pump();
    let guard = 0;
    while(!G.over && guard<600){ if(timers.length){ pump(); } else { aiStep(cur()); pump(); } guard++; }
    Math.random = trueRandom;
    if(!G.over) return -1;
    return G.players.findIndex(p=>completeColors(p).length>=3);
  }
  function seedBlock(seed, cand, champ){ // 6 paired games on one seed
    let cW = 0, kW = 0;
    for(const solo of [cand, champ]){
      const fill = solo===cand ? champ : cand;
      for(let seat=0; seat<3; seat++){
        const gs = [fill,fill,fill]; gs[seat] = solo;
        const w = playGame(seed, gs);
        if(w<0) continue;
        if(gs[w]===cand) cW++; else kW++;
      }
    }
    return {cW, kW};
  }

  /* ---------- node driver: sequential trainStep ---------- */
  function trainStep(S, logFn){
    advance(S, logFn);
    const need = needsGames(S);
    if(!need) return; // nothing to do (shouldn't happen mid-run)
    const seed = need.seedOf(need.rec.seedsDone);
    commitBlock(S, need.rec, seedBlock(seed, need.rec.genome, S.champion));
  }
  function train(S, deadline, maxGen){
    while(Date.now() < deadline){
      advance(S, console.log);
      if(S.gen > maxGen) break;         // check AFTER advance: never start a generation past the cap
      const need = needsGames(S);
      if(!need) break;
      commitBlock(S, need.rec, seedBlock(need.seedOf(need.rec.seedsDone), need.rec.genome, S.champion));
      save(S);
    }
    save(S);
  }

  /* ---------- state I/O ---------- */
  function load(){ return migrate(JSON.parse(fs.readFileSync(opts.state,'utf8')), console.log); }
  function save(S){ fs.writeFileSync(opts.state, JSON.stringify(S)); }

  function status(S){
    const C = cfg(S);
    const rec = S.phase==='confirm' ? S.confirm : (S.candidates[S.candIdx]||null);
    console.log('gen '+S.gen+' | phase '+S.phase+(S.phase==='search'?' rung '+S.rung:'')+
      (rec ? ' | '+(S.phase==='confirm'?'confirm':'candidate '+(S.candIdx+1)+'/'+C.LAMBDA)+' seed '+rec.seedsDone+'/'+(S.phase==='confirm'?C.CONFIRM_SEEDS:C.RUNG_SEEDS[S.rung]) : '')+
      ' | sigma '+S.sigma.toFixed(3)+' | promotions '+S.promotions+' | champion age '+S.championAge+' gens | total games '+S.totalGames);
    S.history.slice(-8).forEach(h=>{
      console.log('  gen '+h.gen+': best '+pct(h.bestShare)+' ± '+pct(h.bestCI)+
        (h.challenged ? (h.confirm ? ' → confirm '+pct(h.confirm.share)+' ± '+pct(h.confirm.ci)+(h.promoted?' PROMOTED':' rejected') : ' → confirming…') : ''));
    });
  }

  /* ---------- sanity ---------- */
  function sanity(){
    let ok = true;
    const check = (name,cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) ok=false; };
    const silent = ()=>{};
    // 1. self-eval: identical genomes -> mirrored games -> share exactly 0.5 every seed
    const self = evalRec(clone(AI_W));
    for(let s=0;s<10;s++) commitBlock({totalGames:0}, self, seedBlock(s, self.genome, AI_W));
    const st = shareOf(self);
    check('self-eval share is exactly 50% with zero variance', Math.abs(st.m-0.5)<1e-9 && st.ci<1e-9);
    // 2. deterministic sampling
    const a = sampleCandidate(AI_W, 0.15, 3, 5), b = sampleCandidate(AI_W, 0.15, 3, 5);
    check('candidate sampling deterministic in (gen, index)', JSON.stringify(a)===JSON.stringify(b));
    check('sampled candidate differs from mean', JSON.stringify(a)!==JSON.stringify(AI_W));
    // tiny config exercises rung cuts + confirm quickly and deterministically
    const tiny = {LAMBDA:4, MU:2, RUNG_SEEDS:[2,4], RUNG_KEEP:[2], CONFIRM_SEEDS:3};
    // 3. full run to gen 3 is deterministic under checkpoint/resume at every step
    const runTo = (resume)=>{
      let S = freshState(AI_W, tiny);
      let guard = 0;
      while(S.gen<=2 && guard++<10000){
        trainStep(S, silent);
        if(resume) S = JSON.parse(JSON.stringify(S));
      }
      advance(S, silent);
      return JSON.stringify(S);
    };
    check('checkpoint/resume at every block is bit-identical (2 full generations, rungs + cuts)', runTo(false)===runTo(true));
    // 4. rung cut keeps the screen leaders
    let S2 = freshState(AI_W, tiny); let guard=0;
    while(S2.rung===0 && S2.gen===1 && guard++<10000) trainStep(S2, silent);
    const cutOk = S2.candidates.filter(r=>r.active).length===2 &&
      Math.min(...S2.candidates.filter(r=>r.active).map(r=>shareOf(r).m)) >=
      Math.max(...S2.candidates.filter(r=>!r.active).map(r=>shareOf(r).m));
    check('rung cut keeps the top screen performers', cutOk);
    // 5. v1 state migrates without losing the run
    const v1 = {champion:clone(AI_W), championAge:3, promotions:1, gen:7, mean:clone(AI_W), sigma:0.2,
                phase:'confirm', candIdx:2, candidates:[{genome:clone(AI_W)}], confirm:{}, history:[{gen:6, challenged:true}], totalGames:9000};
    const m = migrate(JSON.parse(JSON.stringify(v1)), silent);
    check('v1 state migrates (champion/history kept, open generation reset)',
      m.schema===2 && m.gen===7 && m.promotions===1 && m.phase==='search' && m.candidates.length===0 && m.history[0].challenged===false);
    process.exitCode = ok ? 0 : 1;
  }

  /* ---------- main ---------- */
  if(opts.sanity){ sanity(); return; }
  if(!opts.state){ console.error('trainer: --state FILE.json is required (or --sanity)'); process.exitCode=1; return; }
  let S = fs.existsSync(opts.state) ? load() : freshState(AI_W, opts.config);
  if(opts.export){ fs.writeFileSync(opts.export, JSON.stringify(S.champion,null,1)); console.log('champion genome -> '+opts.export+' ('+S.promotions+' promotions, gen '+S.gen+')'); return; }
  if(opts.status){ status(S); return; }
  const t0 = Date.now();
  train(S, t0 + opts.seconds*1000, opts.gens);
  console.log('— paused at '+((Date.now()-t0)/1000).toFixed(1)+'s —');
  status(S);
})();
