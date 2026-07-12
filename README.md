# infinite-ai — the Coastline engine lab

Mission: build the **strongest possible player** for Coastline (a 1:1 Monopoly Deal rebuild) and, from the same brain, a chess.com-style **game review** (win% graphs, accuracy, move labels). Extracted from [infinite-table](https://github.com/joshelms43/infinite-table) so the game and the lab evolve independently — the game repo consumes certified brains; this repo produces them.

## Current champion: determinized Monte Carlo (ISMCTS-lite)
On contentious decisions (greedy's top candidates within 2.0 ev) the brain samples 8 hidden-card worlds consistent with exact 106-card counting, plays each 16 half-turns forward with real rules, and picks the action winning the most futures. Obvious plays stay greedy and instant.

**Certified 2026-07-10** vs the greedy champion (commit `78a6d8d`, this repo's first commit): pooled **51.31%** head-to-head share over **9,000 paired games** (1,500 shared-deck seeds), z = 2.99 against a third-look-corrected bar of 2.10; plain 95% CI [50.45, 52.17]. Raw per-game logs: `ladder-results/`. Overrides greedy on ~16% of decisions; ~0.25–0.6s thinking on contentious plays, instant otherwise.

## The measurement standard (non-negotiable)
No strength claim ships without beating the ladder: paired shuffled-deck seeds (6 games/seed — each side solo in all 3 seats vs 2× the other), seed-clustered 95% CI on the head-to-head share excluding 50%, ≥1,000 games, decision rules pre-committed before data, repeated looks pay a corrected threshold. Fresh-seed confirmation kills winner's curse — it has caught real ones (see history).

## Tools
- `npm test` — engine + brain assertions (39), full-game soak with 106-card conservation.
- `npm run ladder -- <refA> <refB> [--seeds a..b] [--out f.jsonl]` — paired-seed round-robin between any two engine versions (git refs or file paths); `--report` aggregates chunks; `--sanity` self-checks. Frozen-brain extraction expects the AI→BOOT markers in `engine/index.html`.
- `npm run trainer -- --state s.json [--seconds n] [--config '{...}']` — genome ES: paired seeds, successive-halving rungs (12 candidates, 16-seed screen, top-4 full evals), CI-gated title fights, bit-identical checkpoint/resume. Known result: the 22-gene space is near a local optimum; landscape is flat (2×10k-game nulls).
- `engine/trainer.html` — browser twin for overnight runs: one engine Worker per core, live race dashboard, localStorage checkpoints, state JSON interchangeable with the node trainer. Serve via GitHub Pages (Settings → Pages → main) or any static host; it fetches `index.html` from its own directory.
- `engine/learn.html` — **the Learning Gym**: one engine worker per core streams self-play positions while a dedicated training worker fits the value net live — loss curve diving under the guessing baseline, calibration bars converging, and a strip of real holdout positions whose red/green dots separate as the net learns. Export weights (same JSON as the CLI trainer), checkpointed to localStorage each tick. Serve statically (GitHub Pages: Settings → Pages → main; the page lives at `/engine/learn.html`).
- `npm run test:learn` — gym parity suite: gen-worker boot + batch integrity, training-math convergence on synthetic data, and bit-exact agreement between gym training and engine inference.
- `npm run test:trainer` — parity + boot suite (27 checks): worker boot, main-thread eval scope, shared-logic bit-parity, hostile scheduler pipeline. Guards the eval-scope traps that shipped three bugs.
- **Actions → engine ladder** — decisive runs on CI (~60–90 min per 3,000 games); verdicts commit themselves to `ladder-results/`.

## Hard-won knowledge (do not re-learn)
- Genome tuning is flat: ~20k games across two efforts, constants near a local optimum. Strength lives in structure.
- Turn-sequence planning (beam search over 3-play orderings) is a measured NULL — three iterations, 8k+ paired games. Greedy-with-re-evaluation already captures within-turn ordering; heuristic evs are not additive rewards (search Goodharts them); an uncalibrated positional evaluator loses to tuned heuristics even with depth.
- Winner's curse is real and the gate catches it: a 56.7% search-seed challenger confirmed at 51.9% (n=1,002, rejected); a 50.6% exploratory lean confirmed at 49.9% (n=3,000, null). Never extend a sample to reach significance — pre-commit, and pay for extra looks.
- Harness quirks: engine consts are eval-scoped (concatenate into ONE eval; workers must post `ready` from inside; main-thread helpers must be function declarations). Engine `log()` accumulates unboundedly — headless drivers rebind it to a no-op (`log = function(){}`), and set `MC_ON = false` unless the Monte Carlo layer is under test (it costs ~500× per game).
- Rules note: moving a played wild between sets is FREE and unlimited during your turn (verified vs Hasbro FAQ). The champion does not exploit this yet — open strength vein.

## Roadmap
1. **Value net (AlphaZero-lite)**: log (position-features, final winner) from worker-pool self-play at ~600 games/s → train a small JS net → swap in as rollout leaf evaluator (10–50× cheaper rollouts) and greedy tiebreaker → iterate generations. Every step ladder-gated.
2. **Defense in search**: payments, No Deal timing, discards, wild reassignment — currently heuristic-only, likely the biggest untapped vein.
3. **Oracle + review**: same brain at maximum budget (thousands of worlds, full playouts) judges a fixed benchmark suite → per-engine accuracy report cards (avg win% leaked/move) → powers the in-game review (win% graph, per-move deltas from the player's information state, no hindsight; optional God-view replay).
4. **Opponent panel**: fitness vs diverse exploitable styles, not just mirrors.
5. **Cheater benchmark**: full-information deep-search bot ≈ skill ceiling estimate; progress measured as % of remaining headroom.

## Working agreements
Complete files only; semver + CHANGELOG on every change; suites green before every push; diagnose before fixing; results logged in `ladder-results/` and CHANGELOG. The game repo integrates a certified brain by copying the AI section of `engine/index.html` between the `/* ===== AI ===== */` and `/* ===== BOOT ===== */` markers.
