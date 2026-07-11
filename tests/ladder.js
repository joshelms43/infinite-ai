// Coastline benchmark ladder — headless bootstrap.
// Element/document stubs mirror tests/test.js (unknown members return a no-op function
// whose call yields undefined, so DOM guards like aiShowcase's rect check exit cleanly).
// setTimeout is a drainable queue (NOT test.js's setImmediate) — the ladder needs
// deterministic, synchronous timer control for paired-seed replay.
// See tests/ladder.body.js for usage.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname,'..','engine','index.html'),'utf8');
const scripts = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

const el = () => new Proxy({classList:{add(){},remove(){},toggle(){}},style:{}},{
  get(t,k){ if(k in t) return t[k]; return ()=>{}; },
  set(){ return true; }
});
global.document = { querySelector:()=>el(), querySelectorAll:()=>[], createElement:()=>el(), getElementById:()=>el(), addEventListener:()=>{}, body:{appendChild(){}} };
global.window = global;
global.addEventListener = ()=>{};
global.requestAnimationFrame = fn=>fn();
global.navigator = {};
global.location = { reload(){} };
const timers=[];
global.setTimeout = (fn)=>{ timers.push(fn); return timers.length; };
global.clearTimeout = ()=>{};
global.AudioContext = undefined; global.webkitAudioContext = undefined;
global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };

const body = fs.readFileSync(require('path').join(__dirname,'ladder.body.js'),'utf8');
try{ eval(scripts.join('\n;\n') + '\n;\n' + body); }catch(e){ console.error('EVAL FAIL:', e.message, e.stack && e.stack.split('\n')[1]); }
