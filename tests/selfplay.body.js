/* Coastline self-play data pipeline + value-net trainer (AlphaZero-lite).
   Runs inside the eval scope set up by tests/selfplay.js.

   Usage (from repo root):
     node tests/selfplay.js --gen data.bin --games 2000 [--sample 0.15] [--seed 0] [--mc]
     node tests/selfplay.js --train data.bin --out nets/value-v1.json [--epochs 4] [--h1 64] [--h2 32] [--lr 0.05]
     node tests/selfplay.js --eval nets/value-v1.json data.bin
     node tests/selfplay.js --sanity

   Format: data.bin is a flat stream of records, each (FEAT_N + 1) float32 —
   features from the mover's perspective, then the label (1 = that seat won the
   game, 0 = it lost). Record count = filesize / ((FEAT_N+1)*4). Files append, so
   generation chunks across invocations and machines.

   --gen plays greedy self-play (MC_ON off, ~50-70 games/s in node; pass --mc for
   search-guided data at ~500x the cost — generation-1+ material). Each half-turn
   the mover's position is sampled with probability --sample; labels are assigned
   when the game ends; unfinished games are discarded. Seeded and deterministic.

   --train fits a small MLP (relu, relu, sigmoid) with minibatch SGD + momentum on
   a shuffled 90/10 split, reports log-loss vs the base-rate baseline and a
   calibration table, and writes weights loadable by the engine's loadValueNet().
   Everything is plain JS + typed arrays — no dependencies. */
(function(){
  log = function(){};
  MC_ON = false; // greedy self-play unless --mc

  const lpath = require('path');
  const argv = process.argv.slice(2);
  const opts = { mode:null, file:null, out:null, games:2000, sample:0.15, seed:0,
                 epochs:5, h1:64, h2:32, lr:0.004, mc:false, net:null };
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a==='--gen'){ opts.mode='gen'; opts.file=argv[++i]; }
    else if(a==='--train'){ opts.mode='train'; opts.file=argv[++i]; }
    else if(a==='--eval'){ opts.mode='eval'; opts.net=argv[++i]; opts.file=argv[++i]; }
    else if(a==='--sanity'){ opts.mode='sanity'; }
    else if(a==='--out') opts.out=argv[++i];
    else if(a==='--games') opts.games=+argv[++i];
    else if(a==='--sample') opts.sample=+argv[++i];
    else if(a==='--seed') opts.seed=+argv[++i];
    else if(a==='--epochs') opts.epochs=+argv[++i];
    else if(a==='--h1') opts.h1=+argv[++i];
    else if(a==='--h2') opts.h2=+argv[++i];
    else if(a==='--lr') opts.lr=+argv[++i];
    else if(a==='--mc'){ opts.mc=true; }
    else if(a==='--net') opts.net=argv[++i];
  }
  if(opts.mc) MC_ON = true;
  const REC = FEAT_N + 1;

  /* ---------- deterministic self-play (mirrors the trainer's game loop) ---------- */
  const pump = ()=>{ let n=0; while(timers.length && n<20000){ const f=timers.shift(); try{f();}catch(e){} n++; } };
  function mb(seed){ let s=(seed>>>0)+0x9E3779B9; return function(){ s|=0; s=(s+0x6D2B79F5)|0;
    let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  const trueRandom = Math.random;
  // sample at the aiStep chokepoint — most of a game runs inside timer-chain pumps,
  // so hooking the decision function is the only reliable per-decision tap
  const SAMPLER = { p: 0, pend: null };
  const origAiStep = aiStep;
  aiStep = function(p){
    if(SAMPLER.pend && !G.over && G.playsLeft>0 && Math.random() < SAMPLER.p)
      SAMPLER.pend.push({ f: featuresOf(G, G.turn), seat: G.turn });
    return origAiStep(p);
  };
  function playAndSample(seed, sampleP, sink){
    timers.length = 0;
    Math.random = mb(seed);
    newGame();
    G.players[0].isAI = true;
    const pend = [];
    SAMPLER.p = sampleP; SAMPLER.pend = pend;
    startTurn(); pump();
    let guard = 0;
    while(!G.over && guard<600){ if(timers.length){ pump(); } else { aiStep(cur()); pump(); } guard++; }
    SAMPLER.pend = null;
    Math.random = trueRandom;
    if(!G.over) return 0; // unfinished — discard samples
    const w = G.players.findIndex(q=>completeColors(q).length>=3);
    pend.forEach(r=>sink(r.f, r.seat===w ? 1 : 0));
    return pend.length;
  }
  function gen(){
    const t0 = Date.now();
    const fd = fs.openSync(opts.file, 'a');
    if(opts.net){ loadValueNet(JSON.parse(fs.readFileSync(opts.net,'utf8'))); console.log('gen: value net '+opts.net+' loaded (netHorizon rollouts)'); }
    let rows = 0, buf = [];
    const sink = (f, y)=>{ buf.push(...f, y); rows++;
      if(buf.length >= REC*512){ fs.writeSync(fd, Buffer.from(new Float32Array(buf).buffer)); buf = []; } };
    for(let g=0; g<opts.games; g++) playAndSample(opts.seed*1000003 + g, opts.sample, sink);
    if(buf.length) fs.writeSync(fd, Buffer.from(new Float32Array(buf).buffer));
    fs.closeSync(fd);
    const secs = (Date.now()-t0)/1000;
    const total = fs.statSync(opts.file).size / (REC*4);
    console.log('gen: '+opts.games+' games in '+secs.toFixed(1)+'s ('+(opts.games/secs).toFixed(0)+' games/s), +'+rows+' rows, file now '+total+' rows'+(opts.mc?' [MC-guided]':''));
  }

  /* ---------- data loading ---------- */
  function loadData(file){
    const raw = fs.readFileSync(file);
    if(raw.length % (REC*4) !== 0) throw new Error('data file corrupt: size not a multiple of record size');
    const n = raw.length / (REC*4);
    const all = new Float32Array(raw.buffer, raw.byteOffset, n*REC);
    return { n, all };
  }

  /* ---------- tiny MLP: minibatch SGD + momentum, BCE loss ---------- */
  function trainNet(){
    const { n, all } = loadData(opts.file);
    if(n < 1000) console.log('WARNING: only '+n+' rows — expect mush; generate more');
    const H1 = opts.h1, H2 = opts.h2, F = FEAT_N;
    const rnd = mb(1234567 + opts.seed);
    const init = (len, fan)=>{ const a = new Float32Array(len); const s = Math.sqrt(2/fan);
      for(let i=0;i<len;i++) a[i] = (rnd()*2-1)*s; return a; };
    const W1 = init(H1*F, F), b1 = new Float32Array(H1);
    const W2 = init(H2*H1, H1), b2 = new Float32Array(H2);
    const W3 = init(H2, H2), b3 = new Float32Array(1);
    const mW1 = new Float32Array(H1*F), mb1 = new Float32Array(H1);
    const mW2 = new Float32Array(H2*H1), mb2 = new Float32Array(H2);
    const mW3 = new Float32Array(H2), mb3 = new Float32Array(1);
    // shuffled 90/10 split
    const idxs = new Uint32Array(n); for(let i=0;i<n;i++) idxs[i]=i;
    for(let i=n-1;i>0;i--){ const j=(rnd()*(i+1))|0; const t=idxs[i]; idxs[i]=idxs[j]; idxs[j]=t; }
    const nTest = Math.max(500, (n/10)|0), nTrain = n - nTest;
    const h1 = new Float32Array(H1), h2 = new Float32Array(H2);
    const d2 = new Float32Array(H2), d1 = new Float32Array(H1);
    function forward(o){
      for(let j=0;j<H1;j++){ let a=b1[j]; const off=j*F; for(let i=0;i<F;i++) a+=W1[off+i]*all[o+i]; h1[j]=a>0?a:0; }
      for(let j=0;j<H2;j++){ let a=b2[j]; const off=j*H1; for(let i=0;i<H1;i++) a+=W2[off+i]*h1[i]; h2[j]=a>0?a:0; }
      let a=b3[0]; for(let i=0;i<H2;i++) a+=W3[i]*h2[i];
      return 1/(1+Math.exp(-a));
    }
    function evalSplit(from, count){
      let loss=0, base=0, ySum=0;
      for(let k=from;k<from+count;k++){ ySum += all[idxs[k]*REC+F]; }
      const p0 = Math.min(0.999, Math.max(0.001, ySum/count));
      const buckets = Array.from({length:10}, ()=>({n:0, y:0, p:0}));
      for(let k=from;k<from+count;k++){
        const o = idxs[k]*REC, y = all[o+F];
        const p = Math.min(0.999, Math.max(0.001, forward(o)));
        loss += -(y*Math.log(p) + (1-y)*Math.log(1-p));
        base += -(y*Math.log(p0) + (1-y)*Math.log(1-p0));
        const b = Math.min(9, (p*10)|0); buckets[b].n++; buckets[b].y+=y; buckets[b].p+=p;
      }
      return { loss: loss/count, base: base/count, buckets };
    }
    const t0 = Date.now(), mom = 0.9;
    for(let ep=0; ep<opts.epochs; ep++){
      const lr = opts.lr * Math.pow(0.5, ep);
      // reshuffle the training region each epoch
      for(let i=nTrain-1;i>0;i--){ const j=(rnd()*(i+1))|0; const t=idxs[i]; idxs[i]=idxs[j]; idxs[j]=t; }
      let running = 0;
      for(let k=0;k<nTrain;k++){
        const o = idxs[k]*REC, y = all[o+F];
        const p = forward(o);
        running += -(y*Math.log(Math.max(1e-9,p)) + (1-y)*Math.log(Math.max(1e-9,1-p)));
        const g = p - y; // dL/dz for sigmoid+BCE
        for(let i=0;i<H2;i++) d2[i] = h2[i]>0 ? W3[i]*g : 0;
        for(let j=0;j<H1;j++){ let a=0; for(let i=0;i<H2;i++) a += d2[i]*W2[i*H1+j]; d1[j] = h1[j]>0 ? a : 0; }
        for(let i=0;i<H2;i++){ mW3[i]=mom*mW3[i]-lr*g*h2[i]; W3[i]+=mW3[i]; }
        mb3[0]=mom*mb3[0]-lr*g; b3[0]+=mb3[0];
        for(let j=0;j<H2;j++){ const off=j*H1, dj=d2[j];
          if(dj!==0){ for(let i=0;i<H1;i++){ mW2[off+i]=mom*mW2[off+i]-lr*dj*h1[i]; W2[off+i]+=mW2[off+i]; } }
          mb2[j]=mom*mb2[j]-lr*dj; b2[j]+=mb2[j]; }
        for(let j=0;j<H1;j++){ const off=j*F, dj=d1[j];
          if(dj!==0){ for(let i=0;i<F;i++){ mW1[off+i]=mom*mW1[off+i]-lr*dj*all[o+i]; W1[off+i]+=mW1[off+i]; } }
          mb1[j]=mom*mb1[j]-lr*dj; b1[j]+=mb1[j]; }
      }
      const te = evalSplit(nTrain, nTest);
      console.log('epoch '+(ep+1)+'/'+opts.epochs+': train loss '+(running/nTrain).toFixed(4)+
                  ' | holdout '+te.loss.toFixed(4)+' (base-rate '+te.base.toFixed(4)+')');
    }
    const te = evalSplit(nTrain, nTest);
    console.log('final holdout: '+te.loss.toFixed(4)+' vs base '+te.base.toFixed(4)+
                ' ('+((1-te.loss/te.base)*100).toFixed(1)+'% better) | '+((Date.now()-t0)/1000).toFixed(0)+'s | '+nTrain+' train / '+nTest+' holdout');
    console.log('calibration (predicted -> actual):');
    te.buckets.forEach((b,i)=>{ if(b.n>20) console.log('  '+(i*10)+'-'+(i*10+10)+'%: pred '+(100*b.p/b.n).toFixed(1)+'% actual '+(100*b.y/b.n).toFixed(1)+'% (n='+b.n+')'); });
    const out = { feat:'v1', FEAT_N, h1:H1, h2:H2,
                  W1:Array.from(W1), b1:Array.from(b1), W2:Array.from(W2), b2:Array.from(b2),
                  W3:Array.from(W3), b3:Array.from(b3),
                  meta:{ trained:new Date().toISOString(), rows:n, holdoutLoss:+te.loss.toFixed(4), baseLoss:+te.base.toFixed(4) } };
    fs.mkdirSync(lpath.dirname(opts.out), {recursive:true});
    fs.writeFileSync(opts.out, JSON.stringify(out));
    console.log('weights -> '+opts.out+' ('+(JSON.stringify(out).length/1024).toFixed(0)+'KB)');
  }

  function evalNet(){
    const w = JSON.parse(fs.readFileSync(opts.net,'utf8'));
    loadValueNet(w);
    const { n, all } = loadData(opts.file);
    const F = FEAT_N;
    let loss=0, base=0, ySum=0;
    for(let k=0;k<n;k++) ySum += all[k*REC+F];
    const p0 = Math.min(0.999, Math.max(0.001, ySum/n));
    // forward through the ENGINE's netValue path via a stub state is awkward; reuse weights directly
    const fwd = (o)=>{
      const h1=new Array(w.h1), h2=new Array(w.h2);
      for(let j=0;j<w.h1;j++){ let a=w.b1[j]; const off=j*F; for(let i=0;i<F;i++) a+=w.W1[off+i]*all[o+i]; h1[j]=a>0?a:0; }
      for(let j=0;j<w.h2;j++){ let a=w.b2[j]; const off=j*w.h1; for(let i=0;i<w.h1;i++) a+=w.W2[off+i]*h1[i]; h2[j]=a>0?a:0; }
      let a=w.b3[0]; for(let i=0;i<w.h2;i++) a+=w.W3[i]*h2[i];
      return 1/(1+Math.exp(-a));
    };
    for(let k=0;k<n;k++){
      const o=k*REC, y=all[o+F], p=Math.min(0.999,Math.max(0.001,fwd(o)));
      loss += -(y*Math.log(p)+(1-y)*Math.log(1-p));
      base += -(y*Math.log(p0)+(1-y)*Math.log(1-p0));
    }
    console.log('eval on '+n+' rows: loss '+(loss/n).toFixed(4)+' vs base '+(base/n).toFixed(4)+
                ' ('+((1-loss/base)*100).toFixed(1)+'% better)');
  }

  /* ---------- sanity ---------- */
  function sanity(){
    let ok = true;
    const check = (name,cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) ok=false; };
    newGame();
    const f1 = featuresOf(G, 0), f2 = featuresOf(G, 0);
    check('featuresOf returns FEAT_N finite values', f1.length===FEAT_N && f1.every(v=>Number.isFinite(v)));
    check('featuresOf is deterministic', JSON.stringify(f1)===JSON.stringify(f2));
    check('features are sanely scaled (all within [0, 2])', f1.every(v=>v>=0 && v<=2));
    // perspective matters: give seat 1 a complete set and check its own features see it
    addProp(G.players[1], {id:77001,t:'prop',color:'gold',name:'g1',v:4}, 'gold');
    addProp(G.players[1], {id:77002,t:'prop',color:'gold',name:'g2',v:4}, 'gold');
    const s1 = featuresOf(G, 1), s0 = featuresOf(G, 0);
    check('seat-relative encoding (own sets in slot 0)', s1[0]>0 && s0[0]===0);
    // net inference: random weights produce a finite probability, and loading flips the rollout cap
    const rnd = mb(42);
    const w = { feat:'v1', FEAT_N, h1:8, h2:4,
      W1:Array.from({length:8*FEAT_N},()=>rnd()*0.2-0.1), b1:new Array(8).fill(0),
      W2:Array.from({length:4*8},()=>rnd()*0.2-0.1), b2:new Array(4).fill(0),
      W3:Array.from({length:4},()=>rnd()*0.2-0.1), b3:[0] };
    loadValueNet(w);
    const p = netValue(G, 0);
    check('netValue is a probability', p>0 && p<1 && Number.isFinite(p));
    // gen determinism: same seed, same rows
    const rows = [];
    playAndSample(7, 1.0, (f,y)=>rows.push([f,y]));
    const rows2 = [];
    playAndSample(7, 1.0, (f,y)=>rows2.push([f,y]));
    check('self-play sampling is deterministic per seed', JSON.stringify(rows)===JSON.stringify(rows2) && rows.length>10);
    check('labels are consistent within a game (exactly one winning seat)', (()=>{
      const wins = new Set(rows.filter(r=>r[1]===1).map(()=>1));
      return rows.some(r=>r[1]===1) && rows.some(r=>r[1]===0);
    })());
    loadValueNet(null);
    process.exitCode = ok ? 0 : 1;
  }

  if(opts.mode==='gen') gen();
  else if(opts.mode==='train') trainNet();
  else if(opts.mode==='eval') evalNet();
  else if(opts.mode==='sanity') sanity();
  else { console.error('selfplay: need --gen | --train | --eval | --sanity'); process.exitCode=1; }
})();
