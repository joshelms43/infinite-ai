# infinite-ai — Changelog

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
