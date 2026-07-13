/* Parallel self-play generation — shards seeds across CPU cores.
   Each child runs tests/selfplay.js --gen to its own part file; the .bin format is a
   flat (FEAT_N+1) float32 stream, so concatenating shard files is a valid dataset.
   Usage: node tests/selfplay.par.js --gen data.bin --games 20000 [--mc] [--net nets/value-v1.json] [--sample 0.15] [--workers N] */
const { spawn } = require('child_process'); const os=require('os'); const fs=require('fs');
const a=process.argv.slice(2); const opt=(n,d)=>{const i=a.indexOf(n);return i>=0?a[i+1]:d;}; const flag=n=>a.includes(n);
const out=opt('--gen'); const games=+opt('--games','2000'); const workers=+opt('--workers',String(os.cpus().length));
const sample=opt('--sample','0.15'); const mc=flag('--mc'); const net=opt('--net',null);
if(!out){ console.error('need --gen <file>'); process.exit(1); }
const per=Math.ceil(games/workers), parts=[], t0=Date.now();
const kids=Array.from({length:workers},(_,k)=>{ const part=out+'.part'+k; parts.push(part); try{fs.unlinkSync(part);}catch(e){}
  const args=['tests/selfplay.js','--gen',part,'--games',String(per),'--seed',String(1000+k),'--sample',sample];
  if(mc)args.push('--mc'); if(net)args.push('--net',net);
  return new Promise(res=>spawn('node',args,{stdio:['ignore','ignore','inherit']}).on('exit',res)); });
Promise.all(kids).then(()=>{ try{fs.unlinkSync(out);}catch(e){} const fd=fs.openSync(out,'a'); let bytes=0;
  for(const p of parts){ if(fs.existsSync(p)){ const b=fs.readFileSync(p); fs.writeSync(fd,b); bytes+=b.length; fs.unlinkSync(p);} }
  fs.closeSync(fd); const secs=(Date.now()-t0)/1000;
  console.log('parallel gen: '+workers+' workers, '+(per*workers)+' games in '+secs.toFixed(1)+'s ('+((per*workers)/secs).toFixed(0)+' games/s), '+(bytes/((56+1)*4))+' rows -> '+out); });
