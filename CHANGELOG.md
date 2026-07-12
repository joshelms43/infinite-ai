# infinite-ai — Changelog

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
