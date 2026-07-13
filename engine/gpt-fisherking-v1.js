/* GPT-FisherKing v1 — independent Coastline/Monopoly Deal challenger brain
   Built to test against the existing Claude-generated infinite-ai champion.

   Intended use:
   - Insert this AFTER the current AI code and BEFORE the BOOT marker, or run
     install-gpt-fisherking.js from the repo root to produce:
       engine/index.gpt-fisherking-v1.html

   Design:
   - Does not need neural weights.
   - Uses the repo's existing legal move generator/executor, but replaces the
     strategic evaluator and No Deal policy with a separately-designed one.
   - This makes it a true challenger for ladder testing while avoiding fragile
     hand-written reimplementation of every engine action.
*/
(function installGPTFisherKing(global){
  'use strict';

  const NAME = 'GPT-FisherKing-v1';

  // Preserve whatever the current engine/champion exposes. The wrapper calls
  // the existing legal action executor, but swaps in FisherKing's evaluator.
  const BASE = {
    aiStep: typeof global.aiStep === 'function' ? global.aiStep : (typeof aiStep === 'function' ? aiStep : null),
    keepScore: typeof global.keepScore === 'function' ? global.keepScore : (typeof keepScore === 'function' ? keepScore : null),
    aiShouldJSN: typeof global.aiShouldJSN === 'function' ? global.aiShouldJSN : (typeof aiShouldJSN === 'function' ? aiShouldJSN : null),
  };

  function num(x, d=0){ x = +x; return Number.isFinite(x) ? x : d; }
  function arr(x){ return Array.isArray(x) ? x : []; }
  function keys(x){ return x && typeof x === 'object' ? Object.keys(x) : []; }

  function getG(){
    if(global.G && global.G.players) return global.G;
    try { if(typeof G !== 'undefined' && G && G.players) return G; } catch(e){}
    return null;
  }

  function getColors(){
    if(global.COLORS) return global.COLORS;
    try { if(typeof COLORS !== 'undefined') return COLORS; } catch(e){}
    return {};
  }

  function players(){
    const g = getG();
    return g && Array.isArray(g.players) ? g.players : [];
  }

  function asPlayer(x){
    const ps = players();
    if(!ps.length) return null;
    if(typeof x === 'number') return ps[x] || null;
    if(x && typeof x === 'object'){
      if(Array.isArray(x.players) && typeof x.turn === 'number') return x.players[x.turn] || null;
      if(Array.isArray(x.hand) || x.props || x.bank) return x;
      if(typeof x.player === 'number') return ps[x.player] || null;
      if(x.player && typeof x.player === 'object') return x.player;
      if(typeof x.idx === 'number') return ps[x.idx] || null;
      if(typeof x.pidx === 'number') return ps[x.pidx] || null;
    }
    const g = getG();
    return g && typeof g.turn === 'number' ? ps[g.turn] || ps[0] : ps[0];
  }

  function pIndex(p){
    const ps = players();
    const i = ps.indexOf(p);
    return i >= 0 ? i : 0;
  }

  function otherPlayers(p){
    return players().filter(x => x && x !== p);
  }

  function bankCards(p){ return arr(p && p.bank); }
  function handCards(p){ return arr(p && p.hand); }

  function propEntries(p){
    if(!p || !p.props) return [];
    const out = [];
    for(const c of keys(p.props)){
      for(const card of arr(p.props[c])) out.push({card, color:c});
    }
    return out;
  }

  function bankTotalFK(p){
    if(typeof global.bankTotal === 'function') { try { return num(global.bankTotal(p)); } catch(e){} }
    try { if(typeof bankTotal === 'function') return num(bankTotal(p)); } catch(e){}
    return bankCards(p).reduce((s,c)=>s+num(c && c.v),0);
  }

  function countInFK(p, color){
    if(!p || !p.props) return 0;
    return arr(p.props[color]).length;
  }

  function completeSize(color){
    const C = getColors();
    return C[color] && C[color].size ? num(C[color].size, 3) : 3;
  }

  function isCompleteFK(p, color){
    if(typeof global.isComplete === 'function') { try { return !!global.isComplete(p,color); } catch(e){} }
    try { if(typeof isComplete === 'function') return !!isComplete(p,color); } catch(e){}
    return countInFK(p,color) >= completeSize(color);
  }

  function completeColorsFK(p){
    if(typeof global.completeColors === 'function') { try { return arr(global.completeColors(p)); } catch(e){} }
    try { if(typeof completeColors === 'function') return arr(completeColors(p)); } catch(e){}
    return keys(p && p.props).filter(c => isCompleteFK(p,c));
  }

  function rentForFK(p, color){
    if(typeof global.rentFor === 'function') { try { return num(global.rentFor(p,color)); } catch(e){} }
    try { if(typeof rentFor === 'function') return num(rentFor(p,color)); } catch(e){}
    const C = getColors();
    const spec = C[color];
    if(!spec || !spec.rent) return 0;
    const n = Math.max(0, Math.min(countInFK(p,color), spec.size || spec.rent.length));
    if(!n) return 0;
    let r = num(spec.rent[n-1]);
    const b = p && p.bldg && p.bldg[color];
    if(isCompleteFK(p,color) && b){
      if(b.granny) r += 3;
      if(b.resort) r += 4;
    }
    return r;
  }

  function cardKind(c){ return c && (c.kind || c.k || c.action || c.name || c.n || ''); }
  function hasAction(p, kind){ return handCards(p).some(c => c && c.t === 'action' && cardKind(c) === kind); }
  function countAction(p, kind){ return handCards(p).filter(c => c && c.t === 'action' && cardKind(c) === kind).length; }
  function handCount(p, pred){ return handCards(p).filter(pred).length; }

  function cardValueForHand(c, p){
    if(!c) return 0;
    const k = cardKind(c);
    if(c.t === 'money') return 0.38 * num(c.v);
    if(c.t === 'prop'){
      const n = countInFK(p, c.color);
      const need = completeSize(c.color);
      if(n >= need) return 0.2 * num(c.v);
      return 1.6 + 1.35 * n + 0.35 * num(c.v);
    }
    if(c.t === 'wild' || c.t === 'wildall'){
      const colors = c.t === 'wildall' ? keys(getColors()) : arr(c.colors);
      let best = 1.5 + 0.2 * num(c.v);
      for(const color of colors){
        const n = countInFK(p, color), need = completeSize(color);
        best = Math.max(best, 1.8 + 1.8 * Math.min(n, need-1) + (n === need-1 ? 4.8 : 0));
      }
      return best;
    }
    if(c.t === 'rentall') return 4.2 + (hasAction(p,'hike') ? 2.1 : 0);
    if(c.t === 'rent'){
      let best = 1.5;
      for(const color of arr(c.colors)) best = Math.max(best, rentForFK(p,color));
      return 1.6 + 0.55 * best + (hasAction(p,'hike') ? 1.5 : 0);
    }
    if(c.t === 'action'){
      if(k === 'takeover') return 8 + 4 * otherPlayers(p).some(o => completeColorsFK(o).length);
      if(k === 'nodeal') return 5.0 + threatAgainst(p) * 0.12;
      if(k === 'swipe') return 4.8;
      if(k === 'swap') return 4.2;
      if(k === 'favour') return 3.8;
      if(k === 'shout') return 3.2;
      if(k === 'payday') return 4.5 - Math.min(2.0, handCards(p).length * 0.15);
      if(k === 'granny') return 2.4 + completeColorsFK(p).filter(c => c !== 'black' && c !== 'green').length * 2.2;
      if(k === 'resort') return 1.6 + keys((p && p.bldg)||{}).some(c => p.bldg[c] && p.bldg[c].granny) * 4.2;
      if(k === 'hike') return 2.0 + handCount(p,c=>c && (c.t === 'rent' || c.t === 'rentall')) * 2.3;
      return 2.0 + 0.35 * num(c.v);
    }
    return 0.25 * num(c.v);
  }

  function setTextureScore(p){
    const C = getColors();
    let s = 0;
    let bestRent = 0;
    let near = 0;
    let lonelySingles = 0;
    const colorKeys = keys(C);
    for(const color of colorKeys){
      const n = countInFK(p, color);
      if(!n) continue;
      const need = completeSize(color);
      const capped = Math.min(n, need);
      const r = rentForFK(p,color);
      bestRent = Math.max(bestRent, r);

      // Smooth progress reward plus spike for ready-to-complete.
      s += 2.2 * capped;
      s += 4.6 * (capped / need) * (capped / need);
      if(capped === need - 1) { s += 5.8; near++; }
      if(capped >= need) s += 31 + 1.8 * r;
      if(n > need) s -= 2.5 * (n - need);
      if(n === 1 && need >= 3) lonelySingles++;
    }

    // Avoid extremely scattered boards. Monopoly Deal rewards finishing,
    // not collecting random singletons.
    s -= Math.max(0, lonelySingles - 3) * 1.4;
    s += near * 1.1;
    s += bestRent * 0.9;
    return s;
  }

  function liquidityScore(p){
    const bank = bankTotalFK(p);
    const hand = handCards(p).length;
    let s = 0;
    s += Math.min(bank, 7) * 1.15 + Math.max(0, bank - 7) * 0.48;
    if(bank < 3) s -= (3 - bank) * 2.2;
    if(hand <= 2) s -= (3 - hand) * 2.5;
    if(hand > 7) s -= (hand - 7) * 1.25;
    return s;
  }

  function buildingScore(p){
    let s = 0;
    const b = (p && p.bldg) || {};
    for(const color of keys(b)){
      if(!isCompleteFK(p,color)) continue;
      if(b[color] && b[color].granny) s += color === 'black' || color === 'green' ? -1.0 : 5.2;
      if(b[color] && b[color].resort) s += (b[color].granny ? 7.0 : -2.5);
    }
    return s;
  }

  function tacticalHandScore(p){
    const comps = completeColorsFK(p).length;
    const opps = otherPlayers(p);
    const oppComplete = opps.reduce((m,o)=>m+completeColorsFK(o).length,0);
    const maxOppComps = opps.reduce((m,o)=>Math.max(m, completeColorsFK(o).length),0);
    let s = 0;

    for(const c of handCards(p)) s += cardValueForHand(c,p) * 0.75;

    const rentCards = handCount(p,c => c && (c.t === 'rent' || c.t === 'rentall'));
    const hikes = countAction(p,'hike');
    const bestRent = keys(getColors()).reduce((m,c)=>Math.max(m, rentForFK(p,c)),0);
    s += Math.min(rentCards, 2) * (1.0 + bestRent * 0.22);
    s += Math.min(rentCards, hikes) * (2.5 + bestRent * 0.18);

    if(hasAction(p,'takeover')){
      s += oppComplete ? 9 + 6 * maxOppComps : 1.5;
      if(comps >= 2 && oppComplete) s += 9;
    }
    if(hasAction(p,'nodeal')){
      s += 2.0 + 2.5 * maxOppComps + (comps >= 2 ? 4.0 : 0);
    }
    if(hasAction(p,'payday') && handCards(p).length <= 5) s += 2.8;

    return s;
  }

  function vulnerabilityPenalty(p){
    let penalty = 0;
    const comps = completeColorsFK(p).length;
    const complete = new Set(completeColorsFK(p));
    for(const {card,color} of propEntries(p)){
      if(complete.has(color)) continue;
      const n = countInFK(p,color), need = completeSize(color);
      const stealPain = num(card && card.v) + (n === need - 1 ? 4.5 : 0) + (comps >= 2 ? 2.0 : 0);
      penalty += 0.28 * stealPain;
    }
    if(comps >= 2 && !hasAction(p,'nodeal')) penalty += 4.8;
    if(comps >= 2) penalty += otherPlayers(p).some(o => hasAction(o,'takeover')) ? 6.0 : 0;
    return penalty;
  }

  function threatAgainst(p){
    let t = 0;
    const comps = completeColorsFK(p).length;
    for(const o of otherPlayers(p)){
      const oc = completeColorsFK(o).length;
      t += oc * 6;
      if(oc >= 2) t += 18;
      const bestRent = keys(getColors()).reduce((m,c)=>Math.max(m, rentForFK(o,c)),0);
      t += bestRent * 0.65;
      if(hasAction(o,'takeover') && comps) t += 12 + comps * 6;
      if(hasAction(o,'hike')) t += 3;
    }
    return t;
  }

  function positionScore(p){
    if(!p) return 0;
    const comps = completeColorsFK(p).length;
    if(comps >= 3) return 100000;

    const mine =
      comps * 52 +
      setTextureScore(p) +
      liquidityScore(p) +
      buildingScore(p) +
      tacticalHandScore(p) -
      vulnerabilityPenalty(p);

    const oppScores = otherPlayers(p).map(o => {
      const oc = completeColorsFK(o).length;
      if(oc >= 3) return 100000;
      return oc * 52 + setTextureScore(o) + liquidityScore(o) + buildingScore(o) + tacticalHandScore(o) * 0.55;
    });
    const maxOpp = oppScores.length ? Math.max.apply(null, oppScores) : 0;
    const avgOpp = oppScores.length ? oppScores.reduce((a,b)=>a+b,0)/oppScores.length : 0;

    // Multiplayer scoring: beat the leader, but do not ignore the second opp.
    let s = mine - 0.72 * maxOpp - 0.22 * avgOpp;

    // Nonlinear urgency near win.
    if(comps === 2) s += 18 + (hasAction(p,'nodeal') ? 6 : 0);
    if(otherPlayers(p).some(o => completeColorsFK(o).length >= 2)) s -= 16;

    return s;
  }

  function extractCandidateFromArgs(args){
    for(const a of args){
      if(a && typeof a === 'object'){
        if(a.after || a.stateAfter || a.result || a.sim || a.next) return a.after || a.stateAfter || a.result || a.sim || a.next;
        if(Array.isArray(a.players) && typeof a.turn === 'number') return a;
      }
    }
    return null;
  }

  function gptKeepScore(){
    const args = Array.prototype.slice.call(arguments);
    const cand = extractCandidateFromArgs(args);
    if(cand && cand.players){
      // Temporarily score the player whose turn/seat seems relevant.
      const idx = typeof cand.turn === 'number' ? cand.turn : 0;
      return positionScore(cand.players[idx] || cand.players[0]);
    }

    // Most likely call patterns: keepScore(player), keepScore(idx), keepScore(player, ctx)
    const p = asPlayer(args[0]);
    let s = positionScore(p);

    // Optional action/context shaping when the caller provides it.
    const ctx = args.find(a => a && typeof a === 'object' && !Array.isArray(a) && !(a.hand || a.props || a.players));
    if(ctx){
      const kind = String(ctx.kind || ctx.action || ctx.type || ctx.move || '');
      if(/bank/i.test(kind)) s -= 0.8;       // do not over-bank useful cards
      if(/end/i.test(kind) && getG() && getG().playsLeft > 0) s -= 1.6;
      if(/payday/i.test(kind)) s += 1.7;
      if(/rent/i.test(kind)) s += num(ctx.amount || ctx.rent || ctx.value, 0) * 0.55;
      if(/takeover/i.test(kind)) s += 7.5;
    }

    return s;
  }

  function estimatedDamage(ctx, defender){
    let dmg = 0;
    const text = JSON.stringify(ctx || {}, function(k,v){
      if(k === 'players' || k === 'hand' || k === 'props' || k === 'bank') return undefined;
      return v;
    }).toLowerCase();

    const amount = num((ctx && (ctx.amount ?? ctx.debt ?? ctx.rent ?? ctx.value ?? ctx.pay)) || 0);
    dmg += amount;

    if(/takeover|dealbreaker|hostile/.test(text)) dmg += 28 + 14 * completeColorsFK(defender).length;
    if(/swap/.test(text)) dmg += 10;
    if(/swipe|steal/.test(text)) dmg += 8;
    if(/favour|favor/.test(text)) dmg += 5;
    if(/shout/.test(text)) dmg += 2.5;
    if(/rent/.test(text)) dmg += amount * 0.8;
    if(completeColorsFK(defender).length >= 2) dmg += 6;
    return dmg;
  }

  function gptShouldJSN(){
    const args = Array.prototype.slice.call(arguments);
    const defender = asPlayer(args[0]) || asPlayer(args[1]);
    const ctx = args.find(a => a && typeof a === 'object' && !(a.hand || a.props)) || {};
    if(!defender) return false;
    if(!hasAction(defender,'nodeal')) return false;

    const stock = countAction(defender,'nodeal');
    const comps = completeColorsFK(defender).length;
    const dmg = estimatedDamage(ctx, defender);

    // The last No Deal is precious. Save it unless damage is decisive.
    let threshold = 8.5;
    if(stock <= 1) threshold += 4.5;
    if(comps >= 2) threshold -= 3.0;
    if(dmg >= 24) return true;
    if(dmg >= threshold) return true;
    return false;
  }

  // ---- arena wiring (adapted from the uploaded installer for per-seat play) ----
  // Swap the evaluator + No Deal policy into THIS brain's own closure and turn MCTS
  // off, so it's a pure handcrafted challenger. No writes to self/global — those
  // would clobber the arena's shared per-seat dispatcher.
  try { keepScore = gptKeepScore; } catch (e) {}
  try { aiShouldJSN = gptShouldJSN; } catch (e) {}
  try { MC_ON = false; } catch (e) {}
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
