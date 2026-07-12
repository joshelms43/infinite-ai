// 0. CSS integrity: every load-bearing selector must exist in the stylesheet
const _P = require('path'), _F = require('fs');
const HTML_PATH = _F.existsSync(_P.join(__dirname,'coastline.html')) ? _P.join(__dirname,'coastline.html') : _P.join(__dirname,'..','engine','index.html');
const HTML_SRC = _F.readFileSync(HTML_PATH,'utf8');
const REQUIRED_CSS = ['#winscreen{','.wincard{','.showcase{','#winpill{','#logdrawer{','.dragclone{','#promptbar{','.droppable{','.dropok{','.setghost{','.colorpick{','.opp.selectable{','.pickable{','#pov{','#inspect{','.errtoast{','.banner{','.flyer{','.cardback{','.actionzone{','.tcard.pickable','#myprops,.tablespread','.note{','.tset','.pbleft{','#pbfill{'];
const missingCss = REQUIRED_CSS.filter(sel=>!HTML_SRC.includes(sel));
T('CSS integrity: all load-bearing selectors present'+(missingCss.length?' (missing: '+missingCss.join(', ')+')':''), missingCss.length===0);
// 1. deck composition
const d=buildDeck();
T('deck has 106 playing cards (+4 rule cards = official 110)', d.length===106);
T('28 properties', d.filter(c=>c.t==='prop').length===28);
T('11 wilds (9 dual + 2 rainbow)', d.filter(c=>c.t==='wild').length===9 && d.filter(c=>c.t==='wildall').length===2);
T('20 money cards', d.filter(c=>c.t==='money').length===20);
T('34 action cards (2/3/3/3/3/3/10/3/2/2 per official list)', d.filter(c=>c.t==='action').length===34);
T('13 rent cards', d.filter(c=>c.t==='rent').length===10 && d.filter(c=>c.t==='rentall').length===3);
T('set sizes sum to 28', Object.values(COLORS).reduce((s,c)=>s+c.size,0)===28);
// 2. rent + completion
const tp={hand:[],bank:[],props:{},bldg:{}};
addProp(tp,{id:9001,t:'prop',color:'teal',name:'x',v:3},'teal');
T('rent 1 teal = $2M', rentFor(tp,'teal')===2);
addProp(tp,{id:9002,t:'prop',color:'teal',name:'y',v:3},'teal');
addProp(tp,{id:9003,t:'wild',colors:['teal','coral'],v:3},'teal');
T('3 teal = complete', isComplete(tp,'teal'));
T('complete teal rent = $7M', rentFor(tp,'teal')===7);
tp.bldg.teal={granny:{id:9004,v:3}};
T('granny flat adds $3M', rentFor(tp,'teal')===10);
tp.bldg.teal.resort={id:9005,v:4};
T('resort adds $4M more', rentFor(tp,'teal')===14);
addProp(tp,{id:9006,t:'prop',color:'gold',name:'a',v:4},'gold');
addProp(tp,{id:9007,t:'prop',color:'gold',name:'b',v:4},'gold');
addProp(tp,{id:9008,t:'prop',color:'brown',name:'c',v:1},'brown');
addProp(tp,{id:9009,t:'prop',color:'brown',name:'d',v:1},'brown');
T('3 complete sets = win', checkWin(tp));
// 3. broken set drops buildings
G.discard=[];
const w=tp.props.teal.find(c=>c.t==='wild');
removeProp(tp,w); loseBuildingsIfBroken(tp,'teal');
T('broken set loses buildings to discard', !tp.bldg.teal && G.discard.length===2);
// 4. AI payment
G.deck=[];G.discard=[];
G.players=[
 {name:'A',isAI:true,hand:[],bank:[{id:8001,t:'money',v:1},{id:8002,t:'money',v:5}],props:{},bldg:{}},
 {name:'B',isAI:true,hand:[],bank:[],props:{},bldg:{}},
 {name:'C',isAI:true,hand:[],bank:[],props:{},bldg:{}}];
let paid=false;
requestPayment(0,4,1,()=>{paid=true;});
T('AI payment completes', paid);
T('receiver got at least $4M', bankTotal(G.players[1])>=4);
// 5. give-everything when short
G.players[2].bank=[{id:8003,t:'money',v:1}];
addProp(G.players[2],{id:8004,t:'prop',color:'brown',name:'z',v:1},'brown');
let paid2=false;
requestPayment(2,10,1,()=>{paid2=true;});
T('short payer hands over everything', paid2 && payAssetsTotal(G.players[2])===0);
// 5b. direct-selection executors (human attack paths)
G.deck=[];G.discard=[];
G.players=[
 {name:'H',isAI:false,hand:[{id:7001,t:'action',kind:'swipe',v:3},{id:7002,t:'action',kind:'takeover',v:5},{id:7003,t:'action',kind:'swap',v:3}],bank:[],props:{},bldg:{}},
 {name:'X',isAI:true,hand:[],bank:[],props:{},bldg:{}},
 {name:'Y',isAI:true,hand:[],bank:[],props:{},bldg:{}}];
G.turn=0; G.playsLeft=3; G.over=false; G.turnCount=1;
addProp(G.players[1],{id:7010,t:'prop',color:'brown',name:'tgt',v:1},'brown');
addProp(G.players[1],{id:7011,t:'prop',color:'gold',name:'g1',v:4},'gold');
addProp(G.players[1],{id:7012,t:'prop',color:'gold',name:'g2',v:4},'gold');
execSwipe(G.players[0].hand[0], 1, 7010);
T('execSwipe transfers the property', countIn(G.players[0],'brown')===1 && countIn(G.players[1],'brown')===0);
T('execSwipe consumes a play', G.playsLeft===2);
execTakeoverD(G.players[0].hand[0], 1, 'gold');
T('execTakeoverD steals the whole complete set', countIn(G.players[0],'gold')===2 && !G.players[1].props.gold);
addProp(G.players[0],{id:7020,t:'prop',color:'teal',name:'mine',v:3},'teal');
addProp(G.players[2],{id:7021,t:'prop',color:'sage',name:'theirs',v:2},'sage');
execSwapFinal(G.players[0].hand[0], 2, 7021, 7020);
T('execSwapFinal exchanges properties', countIn(G.players[0],'sage')===1 && countIn(G.players[2],'teal')===1 && countIn(G.players[0],'teal')===0);
T('exec paths conserve plays (3 used)', G.playsLeft===0);
// 6. full headless all-AI game
function allCards(){
  let n=G.deck.length+G.discard.length;
  G.players.forEach(p=>{
    n+=p.hand.length+p.bank.length+propList(p).length;
    Object.values(p.bldg).forEach(b=>{ if(b.granny)n++; if(b.resort)n++; });
  });
  return n;
}
// ===== AI BRAIN assertions =====
newGame();
const cen = deckCensus();
T('census totals 106', cen.tot===106);
const un1 = unseenFor(1);
T('unseen = deck + other hands (counting is exact)', un1.tot === G.deck.length + G.players[0].hand.length + G.players[2].hand.length);
const pj = pHoldsAtLeastOne('a:nodeal', 0, 1);
T('JSN probability bounded', pj>=0 && pj<=1);
// move every No Deal into the discard: probability must hit exactly zero
newGame();
const yank = arr => { for(let i=arr.length-1;i>=0;i--){ if(arr[i].t==='action'&&arr[i].kind==='nodeal') G.discard.push(arr.splice(i,1)[0]); } };
yank(G.deck); G.players.forEach(q=>yank(q.hand));
T('all No Deals visible -> P(holds one) = 0', pHoldsAtLeastOne('a:nodeal', 0, 1) === 0);

// spiteful payment: never gift the receiver a completing property when money covers it
newGame();
const payer2 = G.players[1], recv2 = G.players[2];
payer2.bank = [{id:95001,t:'money',v:4}];
payer2.props = {}; payer2.bldg = {};
addProp(payer2, {id:95002,t:'prop',color:'gold',name:'Trap',v:4}, 'gold');
recv2.props = {}; recv2.bldg = {};
addProp(recv2, {id:95003,t:'prop',color:'gold',name:'Half',v:4}, 'gold'); // gold is a 2-set: one more completes
let paidOK = false;
requestPayment(1, 4, 2, ()=>{ paidOK = true; });
T('AI payment: pays money, never the set-completing property', paidOK && countIn(recv2,'gold')===1 && bankTotal(recv2)===4 && countIn(payer2,'gold')===1);

// win-line detection: completing the third set is always found and taken immediately
newGame();
const sharp = G.players[2];
sharp.props = {}; sharp.bldg = {}; sharp.hand = [{id:95010,t:'prop',color:'gold',name:'Winner',v:4}];
addProp(sharp, {id:95011,t:'prop',color:'brown',name:'b1',v:1}, 'brown');
addProp(sharp, {id:95012,t:'prop',color:'brown',name:'b2',v:1}, 'brown');
addProp(sharp, {id:95013,t:'prop',color:'green',name:'g1',v:2}, 'green');
addProp(sharp, {id:95014,t:'prop',color:'green',name:'g2',v:2}, 'green');
addProp(sharp, {id:95015,t:'prop',color:'gold',name:'g3',v:4}, 'gold');
G.turn = 2; G.playsLeft = 3; G.over = false;
aiStep(sharp);
T('AI takes the winning line instantly', G.over===true && completeColors(sharp).length===3);

// (review assertions parked with the feature; brainCandidates evaluator coverage below)
newGame();
G.turn=0; G.playsLeft=3;
const hum = G.players[0];
hum.hand = [{id:96001,t:'money',v:5},{id:96002,t:'prop',color:'teal',name:'T',v:3}];
hum.props={}; hum.bldg={}; hum.bank=[];
const cands = brainCandidates(hum, 0, ()=>{});
T('shared evaluator scores any player (bank + play candidates)',
  cands.some(x=>x.mode==='bank'&&x.cardId===96001) && cands.some(x=>x.mode==='play'&&x.cardId===96002) && cands.every(x=>x.ev>0));


// ===== learned value function =====
newGame();
{
  const f = featuresOf(G, 0);
  T('featuresOf: FEAT_N finite, sanely scaled values', f.length===FEAT_N && f.every(v=>Number.isFinite(v) && v>=0 && v<=2));
  T('featuresOf: deterministic', JSON.stringify(featuresOf(G,1))===JSON.stringify(featuresOf(G,1)));
  const netPath = _P.join(__dirname,'..','nets','value-v1.json');
  if(_F.existsSync(netPath)){
    loadValueNet(JSON.parse(_F.readFileSync(netPath,'utf8')));
    const pEmpty = netValue(G, 1);
    addProp(G.players[1], {id:78001,t:'prop',color:'gold',name:'g1',v:4}, 'gold');
    addProp(G.players[1], {id:78002,t:'prop',color:'gold',name:'g2',v:4}, 'gold');
    addProp(G.players[1], {id:78003,t:'prop',color:'green',name:'r1',v:2}, 'green');
    addProp(G.players[1], {id:78004,t:'prop',color:'green',name:'r2',v:2}, 'green');
    const pTwoSets = netValue(G, 1);
    T('trained net: probabilities in (0,1)', pEmpty>0 && pEmpty<1 && pTwoSets>0 && pTwoSets<1);
    T('trained net: two complete sets beat an empty board', pTwoSets > pEmpty + 0.1);
    loadValueNet(null); // suites below must run the certified champion unmodified
  }
}

// ===== determinized Monte Carlo (ISMCTS-lite) =====
newGame();
// play a few AI half-turns so zones are populated, then sample worlds from seat 1's view
G.turn = 1; G.playsLeft = 3;
{
  const countAll = st => {
    let n = st.deck.length + st.discard.length;
    st.players.forEach(q=>{
      n += q.hand.length + q.bank.length;
      Object.values(q.props).forEach(arr=>n+=arr.length);
      Object.values(q.bldg).forEach(b=>{ if(b.granny)n++; if(b.resort)n++; });
    });
    return n;
  };
  const before = G.players.map(q=>q.hand.length);
  const myHand = JSON.stringify(G.players[1].hand.map(c=>c.id));
  const w1 = determinize(1);
  T('determinized world conserves all 106 cards', countAll(w1)===106);
  T('determinization keeps own hand and opponents\' hand sizes',
    JSON.stringify(w1.players[1].hand.map(c=>c.id))===myHand &&
    w1.players[0].hand.length===before[0] && w1.players[2].hand.length===before[2]);
  const w2 = determinize(1);
  const win = rollout(w2);
  T('rollout terminates with a valid outcome', win>=-1 && win<=2);
  T('rollout leaves the real game untouched', countAll({deck:G.deck,discard:G.discard,players:G.players})===106);
}
// obvious decisions skip Monte Carlo entirely: a winning takeover is played instantly
newGame();
G.turn = 1; G.playsLeft = 3;
const MP = G.players[1];
MP.hand = [ {id:99001,t:'action',kind:'takeover',v:5} ];
MP.props = {}; MP.bldg = {}; MP.bank = [];
addProp(MP,{id:99003,t:'prop',color:'gold',name:'g1',v:4},'gold');
addProp(MP,{id:99004,t:'prop',color:'gold',name:'g2',v:4},'gold');
addProp(MP,{id:99005,t:'prop',color:'green',name:'gr1',v:2},'green');
addProp(MP,{id:99006,t:'prop',color:'green',name:'gr2',v:2},'green');
G.players[2].props = {}; G.players[2].bldg = {};
addProp(G.players[2],{id:99007,t:'prop',color:'teal',name:'t1',v:3},'teal');
addProp(G.players[2],{id:99008,t:'prop',color:'teal',name:'t2',v:3},'teal');
addProp(G.players[2],{id:99009,t:'prop',color:'teal',name:'t3',v:3},'teal');
{
  const C = brainCandidates(MP,1,()=>{}).sort((a,b)=>b.ev-a.ev);
  T('winning takeover tops the candidates', C[0].cardId===99001 && C[0].ev>=1000);
  T('obvious decisions skip Monte Carlo (contentious gate)', mctsChoose(1, C)===null);
}


// ===== NET protocol =====
newGame();
G.players[1].bank=[{id:97001,t:'money',v:5}];
addProp(G.players[2], {id:97002,t:'prop',color:'teal',name:'x',v:3},'teal');
const st = NET.serialize();
T('serialize captures public state, hands as counts only', st.players.length===3 && st.players[1].bank[0].v===5 && st.players[2].props.teal.length===1 && st.players.every(q=>typeof q.handN==='number' && q.hand===undefined));
const savedSeat=MYSEAT; MYSEAT=1; NET.mode='client';
G.players[1].hand=[{id:97003,t:'money',v:2}];
NET.applyState(JSON.parse(JSON.stringify(st)));
T('applyState: own hand kept, other hands are placeholders', G.players[1].hand[0].id===97003 && G.players[0].hand.every(c=>String(c.id).indexOf('h')===0) && bankTotal(G.players[1])===5);
const sent=[]; NET.tx={ send:(t,p)=>sent.push({t,p}) };
const handN=G.players[1].hand.length, bankN=G.players[1].bank.length;
bankCard(G.players[1].hand[0]);
T('client intercept: intent sent, no local mutation', sent.length===1 && sent[0].t==='intent' && sent[0].p.k==='bank' && G.players[1].hand.length===handN && G.players[1].bank.length===bankN);
NET.mode='host'; MYSEAT=0; G.turn=1; G.playsLeft=3; G.over=false;
NET.applyIntent({seat:1,k:'bank',a:{id:97003}});
T('host applyIntent executes as that seat', G.players[1].bank.some(c=>c.id===97003));
NET.mode='off'; MYSEAT=savedSeat; NET.tx=null;


// seat identity by presence key (name collisions can't corrupt seats)
NET.pkey='k2'; NET.mode='joining'; NET.tx={send(){},track(){},presence(){return{}}};
NET.onStart({ roster:[{key:'k0',name:'Josh'},{key:'k1',name:'Josh'},{key:'k2',name:'Josh'}] }, false);
T('client seat resolved by key, not name', NET.seat===2 && MYSEAT===2 && G.players.length===3 && G.players.every(p=>!p.isAI));
NET.mode='off'; NET.tx=null; MYSEAT=0;


// elo maths mirror (server RPC uses the same formula)
T('elo: equal ratings -> +16', eloDelta(1000,1000)===16);
T('elo: favourite beating underdog gains little', eloDelta(1400,1000)<8 && eloDelta(1000,1400)>24);

// ===== FULL-GAME soak (must run last: ends via interval watching G.over) =====
newGame();
G.players.forEach(p=>p.isAI=true);
G.over=false; G.turn=0;
let conserved=true; let steps=0;
const _fe=finishEnd;
finishEnd=function(){ if(allCards()!==106)conserved=false; steps++; if(steps>600){G.over=true;return;} _fe(); };
startTurn();
setInterval(()=>{
  if(G.over){
    T('full AI game reaches a winner', steps<=600);
    T('card count conserved at 106 every turn', conserved);
    T('a player holds 3 complete sets', G.players.some(p=>completeColors(p).length>=3));
    console.log('turns played:', steps);
    DONE();
  }
},50);
