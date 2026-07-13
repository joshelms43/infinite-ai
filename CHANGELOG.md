# infinite-ai — Changelog

## v0.6.0 - 2026-07-13
Self-play throughput + the automated value-net flywheel. All engine changes are byte-identical (bit-for-bit parity + identical same-seed data); numbers measured in Node 22.

**Engine speedups (no behaviour change):**
- `unseenFor()` cached within the frozen-G search window (mctsChoose/jsnSearch set UNSEEN_CACHE, restored in a finally). It was ~41% of a mid-game rolloutValue and is a pure function of G, which is read-only during a search. +1.24x isolated rollouts, ~1.36x on guided+net self-play; trainer.parity bit-for-bit, arena.parity symmetric, same-seed `--gen` data identical.
- `mcProtoOf` determinize clone: `JSON.parse(JSON.stringify)` -> the engine's `mcCard` shallow clone. determinize() 1.57x, determinized worlds byte-identical.

**Training pipeline:**
- `tests/selfplay.js --net <weights>`: load a value net during `--gen` so rollouts use netHorizon (16->6), ~2.5x cheaper generation (also = gen-2 champion data).
- `tests/selfplay.par.js` (new): shard `--gen` across cores; near-linear (4 workers 130->278 games/s here).

**Ladder:**
- `tests/ladder.js --nets a.json,b.json`: per-brain nets aligned to spec order (each version's AI section is its own closure, so VALUE_NET is per-brain). Enables candidate-net vs champion-net laps. Back-compat: `--net` unchanged; same net both sides = 50.0% +/- 0.0pp.

**Flywheel automation:**
- `tests/lap.js` (new): one AlphaZero lap - gen (champion-guided, parallel) -> train candidate -> certify candidate-vs-champion across a screen + a fresh-seed confirmation -> promote into `nets/value-champion.json` ONLY on clearing the CI-excludes-50% bar in BOTH (two independent one-look tests; winner's-curse discipline, not a bypass).
- `.github/workflows/az-lap.yml` (new): runs a lap on CI (suites-gated), commits candidate + verdict, promotes on double-pass.
- `nets/value-champion.json` (new): canonical champion pointer, seeded from value-gym-v1.json. NOTE: champion nets were certified on the pre-v0.5.0 economy - run an az lap to re-establish the champion on the corrected rules.

## v0.5.0 — 2026-07-12
RULES AUDIT: economy aligned to official Monopoly Deal (user-requested 1:1 check).

**Verified faithful (unchanged):** 106-card deck; money 6x1/5x2/3x3/3x4/2x5/1x10; all 10 action kinds at official counts and values; set-size structure (three 2-sets, six 3-sets, one 4-set); draw 2 (5 on empty hand); 3 plays; discard to 7; JSN free + chainable; DTR costs a play; dual rent charges all, wild rent one target; Deal Breaker takes buildings; Sly/Forced skip complete sets; payments no-change/overpay/table-only, complete-set props payable; hotel requires house; multicolour wild $0; discard reshuffles into the deck.

**Deviations found and FIXED (official slot in parens):**
- Rent tables: sky/LightBlue 1/2/4 -> 1/2/3; sage/Yellow 1/3/5 -> 2/4/6; black/Railroad 1/2/3/5 -> 1/2/3/4; green/Utility 2/5 -> 1/2.
- Property values: teal/Green $3 -> $4; sky/LB $2 -> $1; sage/Yellow $2 -> $3; green/Util $3 -> $2.
- Dual-wild pairings + values to official: R/Y x2 ($3), Util/RR ($2), LB/Brown ($1), RR/Green ($4), LB/RR $2 -> $4 (DB/G and P/O were already right).
- Rent-card pairings to the official five set-pairs (R/Y, RR/Util, Brown/LB corrected).
- Houses now banned on Buderim/Utilities as well as Transport/Stations (5 play sites).
- 9 new census/economy assertions pin all of this permanently (engine suite 65 checks).

**CONSEQUENCES — read before comparing anything to the past:**
- Every prior certification (MCTS +1.31pp, net-brain Arena verdict) was measured on the OLD economy. The comparisons were internally fair, but the game has changed; re-certify the net-v1 Arena preset on this version before leaning on it.
- nets/value-gym-v1.json was trained on old-economy games — still loads, likely still useful, but its calibration is stale. Gym training continues on the corrected economy; RESET saved Arena runs (they must not mix economies).
- Coastline itself (infinite-table repo) needs this same patch to stay 1:1 with the engine — the exact diffs are this entry plus the v0.5.0 commit.
- Sources: official census & rules per Hasbro instruction book / monopolydealrules.com (its own action-count prose is inconsistent; the instruction-book counts that sum to 34 were used).

## v0.4.2 — 2026-07-12
Guided self-play ~32% faster with BIT-IDENTICAL play (16-seed oracle: same winners, same turn counts, before vs after every change).
- mctsChoose no longer regenerates the full move list per candidate per world: exec closures now re-fetch their cards from the target state (mcTake's return, `||c` preserving exact legacy semantics), making root moves clone-safe. Removes det*topK move-gens per contentious decision — and eliminates a latent cross-world card-aliasing hazard.
- Shape-aware world cloning (mcCard/mcPlayer/mcWorld) replaces generic recursion in mctsChoose + determinize; tuneW shared read-only.
- aiWildColor hoists the unseen census (colorSupply rebuilt it per colour); netValue reuses scratch buffers; mcClone is structural (no JSON round-trip).
- Profiling honesty: instrumented wrappers flagged high-CALL functions, not high-COST ones — V8's sampling profiler (--prof) found the real hotspots. Lesson recorded.

## v0.4.1 — 2026-07-12
Gen-2 training fixes (user-reported: gym showing -40% smarter than guessing).
- Warm-start bug: mode switch sent reset-then-init, but init only loads weights into an EMPTY net — gen-2 actually began from random weights while claiming to warm-start from the champion. New 'load' message force-loads; mode switch uses it.
- Overfit bug: the trainer runs at full speed regardless of stream rate; gen-2 games arrive ~40x slower than gen-1, so the first few games were ground through hundreds of epochs. New PASS_CAP=8: training idles until fresh data arrives (gen-1 unaffected — its stream outruns the trainer).
- learn parity: force-load regression check + pass-cap pin (16 checks).

## v0.4.0 — 2026-07-12
Three candidates enter the Arena: search reinvestment, JSN search, gen-2 training.

**Search-based Just Say No (engine/index.html)**
- resolveBlock now threads the CONCRETE pending effect (fx: {pay}/{stealId}/{takeColor}/{swapTheirs,swapMine}) through all 12 call sites into aiShouldJSN — the brain finally knows WHAT it's blocking, not just the attack's name.
- New jsnSearch: across determinized worlds, compare P(win) if the effect resolves vs if a No Deal is burned (counter-chains played with actual dealt hands via mcBlocked; the spent card's option value is priced automatically because the block branch no longer holds it). Chain parity handled for counter-JSN decisions. Gated behind MC.jsn (new MC flag) + MC_ON; heuristic fallback unchanged when the effect is unknown (frozen brains) or MC is off. Old brains ignore the extra arg — full ladder/arena backward compatibility.
- Assertions: jsnFx effect application in-sim, seeded determinism, blocks a game-losing takeover (gain 1.00), both decision paths wired.

**Arena experiment presets (engine/arena.html)**
- Per-side arming: {net, config patch} evaluated inside each brain's own scope. Pre-committed matchups: JSN candidate vs champion, 2x-search candidate (det 16, topK 6, margin 1.2) vs champion, full-stack vs champion, the historic net-v1 fight, and self-match sanity. Incumbent is pinned to the exact certified config (net, MC.jsn=0). Per-matchup localStorage runs. Parity adds patch-divergence and JSN-self-match-symmetry checks (15 total).

**Gen-2 guided generation (engine/learn.html)**
- Gear selector: gen-1 greedy (fastest data) or gen-2 guided — champion self-play with MC on and the champion net loaded, ~arena speed, subtler positions. Gen-2 training warm-starts from the champion net; separate checkpoint key per mode. Parity adds guided-batch soundness checks (14 total).

**Tests** — engine 49/49, arena parity 15/15, learn parity 14/14, trainer parity 27/27, all sanities green.

## v0.3.1 — 2026-07-12
**NEW CHAMPION: the net brain.** First Arena verdict — main + nets/value-gym-v1.json is STRONGER than main (crossed at 2,412 games, 52.78% ± 2.73pp, anytime-valid alpha=0.05, fresh seeds 50000+). Verdict record: ladder-results/20260712-arena-net-v1-STRONGER.md. The AlphaZero flywheel's first lap paid off; README champion line updated.

## v0.3.0 — 2026-07-12
The Arena — browser title fights that run until they KNOW.

**engine/arena.html**
- Replaces the CI ladder for interactive verdicts: a worker pool plays work (engine + optional value net) vs base (the engine as shipped) using the ladder's exact paired-seed protocol — per seed, each side solo in all 3 seats vs 2x the other, same shuffled deck, MCTS on for both.
- The statistics are the feature: "run until significant" with an ordinary CI is a false-champion machine (every peek re-rolls the dice), so the page uses an anytime-valid confidence sequence (Robbins normal-mixture boundary, alpha=0.05, rho=100 — pre-committed in the file) that is valid at every moment simultaneously. The band only narrows; the banner flipping IS the decision. Verdicts: STRONGER / WEAKER when the band leaves 50%, PRACTICAL NULL when it narrows inside ±0.5pp.
- Live chart of the win share inside its narrowing band, solo win rates per side, current edge vs required boundary, localStorage persistence per mode (pause / close tab / resume overnight), self-match sanity mode that must pin 50.0%.

**Provenance of the design**
- The empty-net CI run (ladder-results/20260712T015418Z) came back 50.0% ± 0.0pp over 3,000 games — the net_file input was blank, so it was accidentally a perfect 3,000-game self-match: strong live evidence the pairing has zero bias, and the motivation to move title fights into the browser.

**Tests** — new `npm run test:arena` (12 checks): worker boot, self-match perfect symmetry (the ±0.0pp law), bit-identical seed replay, net arming and provably changing play, page constants pinned, boundary monotone, 20,000-block true-null stream without a false verdict, +5pp true edge certifying in ~1,200 games.

## v0.2.2 — 2026-07-12
- `nets/value-gym-v1.json` — first browser-gym-trained value net: 316,099 self-play games, 5.03M positions, 3.1 passes, holdout 17.7% better than the guessing baseline. Validated (shapes, finite, non-trivial) and smoke-tested through the ladder's `--net` path.
- Title fight pre-registered: work = main + this net (netHorizon truncation) vs baseline = main without net, seeds 3000..3500 (3,000 paired games), verdict only if the seed-clustered 95% CI excludes 50%.

## v0.2.1 — 2026-07-10
The Learning Gym — AlphaZero-lite training you can watch.

**engine/learn.html**
- One engine worker per core plays greedy self-play and streams labelled positions (transferable Float32 batches, zero-copy); a dedicated engine-free training worker fits the value MLP continuously on the arriving stream, holding out every 10th record. On an 8-core machine this outproduces the CI generator ~5x while being fun to leave on a second monitor.
- The show: a live learning curve diving under the dashed guessing baseline; a "smarter than guessing" headline percentage; calibration bars (predicted | actual) converging per decile; and the guesses strip — real never-trained-on positions as dots placed at the net's predicted win chance, green = that seat won, red = lost. Learning is literally the colours separating.
- Weights checkpoint to localStorage every 2s and export as the same JSON `tests/selfplay.js --train` writes and `loadValueNet()` consumes — certify exports with the engine-ladder workflow (`net_file`) before promoting.

**Hardening**
- `featuresOf` now clamps to [0,2] — the gym's batch-integrity test caught rich endgame positions overflowing the scale caps (bank + asset divisors), so the bound now holds by construction everywhere (CLI, gym, in-engine inference).
- New `npm run test:learn` (12 checks): gen-worker booted exactly as the browser does (ready-from-inside-the-eval, whole records, bounded features, binary labels wired to real winners), training-math convergence on a synthetic separable task (0.69 → <0.10), export shape validation, and gym-training ↔ engine-inference agreement to 1e-9 on identical weights.

**Tests** — engine 43/43, selfplay sanity 7/7, learn parity 12/12, trainer sanity 6/6, trainer parity 27/27, ladder sanity 4/4.

## v0.2.0 — 2026-07-10
The AlphaZero-lite loop opens: self-play data, a learned value net, and net-truncated search. The certified champion's behaviour is unchanged until a net is loaded — promotion stays ladder-gated.

**Feature extractor + value net in the engine**
- `featuresOf(state, seat)`: 56 seat-relative features (per-player set/progress/bank/liquidity/building summaries for self and both opponents in turn order, the seat's own hand composition, plays left, deck depth). Public information only, plus the seat's own hand — no peeking. `netValue(state, seat)` runs a 56→64→32→1 relu/sigmoid MLP (~6k params) loaded via `loadValueNet()`; `VALUE_NET` defaults to null.
- When a net is loaded, Monte Carlo rollouts truncate at `MC.netHorizon` (6 half-turns instead of 16) and score the frontier with normalised per-seat net values — search gets ~2.5x cheaper per world with a learned judge at the leaf. `rolloutValue()` returns fractional win probability; real wins inside the horizon still count as 1/0.

**Self-play pipeline (tests/selfplay.js, `npm run selfplay`)**
- `--gen`: deterministic seeded self-play (~125 games/s in node, greedy policy; `--mc` for search-guided generation-1+ data), sampling positions at the decision chokepoint and labelling them with the final winner; append-friendly float32 binary format.
- `--train`: plain-JS SGD + momentum, 90/10 split, log-loss vs base-rate baseline, calibration table, weights as JSON. `--eval` re-scores any dataset. `--sanity`: 7 checks (feature determinism/bounds/perspective, net inference, deterministic sampling, label consistency).
- First trained net, from 357k positions / 11.2k games in-session: **holdout log-loss 0.529 vs 0.637 base (16.9% better), calibration within ~2pp in every decile** (e.g. predicted 84.5% → actual 84.6%). Committed as `nets/value-v1.json`. Lesson logged the honest way: the first run collapsed to base rate — per-example lr 0.05 with 0.9 momentum thrashes; 0.004 learns. Signal probe: P(win) spans 9.2% (0 sets vs 2) to 78.7% (2 sets vs 0).

**Harness + CI**
- `ladder --net FILE` arms working-tree brains with a net (frozen refs stay as shipped); the engine-ladder workflow gains a `net_file` input.
- New **value net** workflow: one click generates self-play data for N minutes on CI (~7k games/min), trains, and commits weights + training report to `nets/`. Certify via the ladder before promoting — the net changes play only when explicitly loaded.

**Tests** — engine 43/43 (adds feature/net assertions incl. trained-net monotonicity), selfplay sanity 7/7, trainer sanity 6/6, trainer parity 27/27, ladder sanity 4/4, net-armed ladder smoke green.

## v0.1.0 — 2026-07-10
The lab moves into its own home, and the first title changes hands.

**Repo extraction**
- Migrated from infinite-table (which continues as the game product): research engine at `engine/index.html`, ladder + trainer + parity suites under `tests/`, browser trainer at `engine/trainer.html`, CI ladder workflow, and the complete verdict history in `ladder-results/`. Commit `78a6d8d` is the frozen greedy champion (v0.2.26→v0.4.8 lineage, play-identical per ladder) — the opponent every future brain must provably beat.

**NEW CHAMPION: determinized Monte Carlo (ISMCTS-lite)**
- Three pre-committed CI stages vs the greedy champion, 3,000 paired games each: 51.1% ± 1.5 → 50.9% ± 1.4 (pooled 6,000 grazed the bar at 49.96 — held per protocol) → 51.9% ± 1.5 (significant alone). **Pooled 9,000 games: 51.31%, z = 2.99 vs the third-look-corrected bar of 2.10; plain 95% CI [50.45, 52.17]. Certified.**
- First proven strength gain since the v0.2.26 expert brain. The effect (~+1.3pp head-to-head, ~+1.3pp solo win rate) is invisible per game and decisive at scale — measured, not vibes.
- Engine gains `MC_ON` (headless genome training switches the Monte Carlo layer off — ~500× throughput difference; genome self-play measures the heuristic layer both brains share).

**Tests** — 39/39 engine assertions, trainer sanity 6/6, trainer parity 27/27, ladder sanity 4/4, in-repo champion-vs-baseline smoke run green.
