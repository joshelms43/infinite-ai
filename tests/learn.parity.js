// Learning-gym parity suite (`npm run test:learn`).
// Guards engine/learn.html the same way trainer.parity.js guards trainer.html:
//   1. GEN WORKER — boot the page's worker-boot + gen-core exactly as a browser
//      would; assert ready carries FEAT_N (posted from inside the eval — the
//      recurring eval-scope trap) and that a start message synchronously yields a
//      well-formed batch: whole records, finite bounded features, binary labels.
//   2. TRAIN WORKER — engine-free math core: on synthetic separable data the loss
//      must collapse; exported weights must produce IDENTICAL predictions when
//      loaded into the ENGINE's netValue (the training/inference contract).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const check = (name, cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) fails++; };

const html = fs.readFileSync(path.join(ROOT,'engine','learn.html'),'utf8');
const grab = id => new RegExp('<script type="text/plain" id="'+id+'">([\\s\\S]*?)</script>').exec(html)[1];
const bootSrc = grab('worker-boot');
const genCore = grab('gen-core');
const trainCore = grab('train-core');
const engineHtml = fs.readFileSync(path.join(ROOT,'engine','index.html'),'utf8');
const engine = [...engineHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');

/* ---------- part 1: gen worker, booted exactly as the browser does ---------- */
// real workers provide these; the node sim must stub them (same set trainer.parity uses)
global.self = global;
global.addEventListener = global.addEventListener || (()=>{});
global.navigator = global.navigator || {};
global.location = global.location || { reload(){} };
let outbox = [];
global.postMessage = (m)=>outbox.push(m);
function bootWorker(core){ // fresh function scope per boot — bootSrc declares consts
  outbox = [];
  (function(){ eval(bootSrc); })();
  self.onmessage({ data: { type:'boot', engine, core } });
  return outbox;
}
bootWorker(genCore);
const ready = outbox.find(m=>m.type==='ready');
const fatal = outbox.find(m=>m.type==='fatal');
check('gen worker boots and posts ready from inside the eval', !!ready && !fatal || (console.log('   fatal: '+(fatal&&fatal.msg)), false));
const F = ready ? ready.FEAT_N : 0;
check('ready carries FEAT_N', F > 30);
if(ready){
  outbox.length = 0;
  self.onmessage({ data: { type:'start', seedBase: 42, sample: 0.5 } });
  self.onmessage({ data: { type:'pause' } });
  const batch = outbox.find(m=>m.type==='batch');
  check('start yields a batch synchronously', !!batch && batch.games > 0);
  if(batch){
    const a = new Float32Array(batch.buf);
    const REC = F+1;
    check('batch is whole records', a.length > 0 && a.length % REC === 0);
    let featsOk = true, labelsOk = true, wins = 0, losses = 0;
    for(let r=0; r<a.length/REC; r++){
      for(let i=0;i<F;i++){ const v = a[r*REC+i]; if(!Number.isFinite(v) || v<0 || v>2) featsOk = false; }
      const y = a[r*REC+F];
      if(y!==0 && y!==1) labelsOk = false;
      if(y===1) wins++; else losses++;
    }
    check('features finite and bounded across the whole batch', featsOk);
    check('labels are strictly binary', labelsOk);
    check('both outcomes present (labels wired to real winners)', wins>0 && losses>0);
  }
}

/* ---------- part 1b: guided mode (gen-2) — MCTS + net self-play still yields sound batches ---------- */
if(ready){
  const netW = JSON.parse(fs.readFileSync(path.join(ROOT,'nets','value-gym-v1.json'),'utf8'));
  outbox.length = 0;
  self.onmessage({ data: { type:'start', seedBase: 91, sample: 0.5, guided: true, net: netW } });
  self.onmessage({ data: { type:'pause' } });
  const gb = outbox.find(m=>m.type==='batch');
  check('guided start yields a batch (champion self-play runs)', !!gb && gb.games > 0);
  if(gb){
    const a = new Float32Array(gb.buf), REC = F+1;
    let ok = a.length>0 && a.length % REC === 0;
    for(let r=0; r<a.length/REC && ok; r++){
      const y = a[r*REC+F]; if(y!==0 && y!==1) ok = false;
      for(let i=0;i<F;i++){ const v=a[r*REC+i]; if(!Number.isFinite(v)||v<0||v>2) ok = false; }
    }
    check('guided batch is whole, bounded, binary-labelled', ok);
  }
}

/* ---------- part 2: train worker on synthetic data + engine round-trip ---------- */
const trainOut = [];
const trainScope = (function(){
  const selfStub = { postMessage:(m)=>trainOut.push(m), onmessage:null };
  const exported = (function(self, setTimeout){
    eval(trainCore + '\n;var __exp = {initNet:initNet, trainSome:trainSome, evalHoldout:evalHoldout, exportJson:exportJson, push:(buf)=>{ const a=new Float32Array(buf); chunks.push({a, rows:a.length/REC}); rows += a.length/REC; }, setF:(f)=>{ F=f; REC=f+1; h1buf.length=64; h2buf.length=32; }};__exp');
    return __exp;
  })(selfStub, (fn,ms)=>0); // neuter the loop's setTimeout — we drive manually
  return exported;
})();
check('train core evaluates with exports reachable', !!trainScope && typeof trainScope.trainSome==='function');
if(trainScope){
  const Fs = F || 56, REC = Fs+1, Nrows = 4000;
  trainScope.setF(Fs);
  // synthetic separable task: label = 1 iff feature 0 > 0.5 (with the rest noise)
  const data = new Float32Array(Nrows*REC);
  let s = 12345; const rnd = ()=>{ s=(s*48271)%2147483647; return s/2147483647; };
  for(let r=0;r<Nrows;r++){
    for(let i=0;i<Fs;i++) data[r*REC+i] = rnd();
    data[r*REC+Fs] = data[r*REC] > 0.5 ? 1 : 0;
  }
  trainScope.push(data.buffer);
  trainScope.initNet(null);
  const before = trainScope.evalHoldout(2000);
  for(let i=0;i<6;i++) trainScope.trainSome(20000, 0.01);
  const after = trainScope.evalHoldout(2000);
  check('loss collapses on a separable synthetic task ('+before.loss.toFixed(3)+' -> '+after.loss.toFixed(3)+')',
    after.loss < 0.25 && after.loss < before.loss/2);
  // the contract: exported weights must predict identically through the ENGINE's netValue
  const w = trainScope.exportJson();
  check('exported weights carry the right shapes',
    w.W1.length===w.h1*Fs && w.W2.length===w.h2*w.h1 && w.W3.length===w.h2 && w.FEAT_N===Fs);
  // engine functions live inside a boot eval scope — reach them via a fresh bridge boot
  bootWorker('log = function(){}; loadValueNet('+JSON.stringify(w)+'); newGame(); self.postMessage({type:"probe", p: netValue(G,0), f: featuresOf(G,0)});');
  const probeMsg = outbox.find(m=>m.type==='probe');
  check('engine loads gym weights and produces a probability', !!probeMsg && probeMsg.p>0 && probeMsg.p<1);
  if(probeMsg){
    // manual forward with the exported weights over the engine's own features
    const x = probeMsg.f;
    const h1=[],h2=[];
    for(let j=0;j<w.h1;j++){ let a=w.b1[j]; for(let i=0;i<Fs;i++) a+=w.W1[j*Fs+i]*x[i]; h1[j]=a>0?a:0; }
    for(let j=0;j<w.h2;j++){ let a=w.b2[j]; for(let i=0;i<w.h1;i++) a+=w.W2[j*w.h1+i]*h1[i]; h2[j]=a>0?a:0; }
    let a=w.b3[0]; for(let i=0;i<w.h2;i++) a+=w.W3[i]*h2[i];
    const pRef = 1/(1+Math.exp(-a));
    check('training math and engine inference agree bit-for-bit-ish (|Δ| < 1e-9)', Math.abs(pRef - probeMsg.p) < 1e-9);
  }
}

console.log(fails===0 ? 'ALL LEARN PARITY TESTS PASS' : 'FAILURES: '+fails);
process.exit(fails===0?0:1);
