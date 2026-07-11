# infinite-ai — Changelog

## v0.1.0 — 2026-07-10
The lab moves into its own home, and the first title changes hands.

**Repo extraction**
- Migrated from infinite-table (which continues as the game product): research engine at `engine/index.html`, ladder + trainer + parity suites under `tests/`, browser trainer at `engine/trainer.html`, CI ladder workflow, and the complete verdict history in `ladder-results/`. Commit `78a6d8d` is the frozen greedy champion (v0.2.26→v0.4.8 lineage, play-identical per ladder) — the opponent every future brain must provably beat.

**NEW CHAMPION: determinized Monte Carlo (ISMCTS-lite)**
- Three pre-committed CI stages vs the greedy champion, 3,000 paired games each: 51.1% ± 1.5 → 50.9% ± 1.4 (pooled 6,000 grazed the bar at 49.96 — held per protocol) → 51.9% ± 1.5 (significant alone). **Pooled 9,000 games: 51.31%, z = 2.99 vs the third-look-corrected bar of 2.10; plain 95% CI [50.45, 52.17]. Certified.**
- First proven strength gain since the v0.2.26 expert brain. The effect (~+1.3pp head-to-head, ~+1.3pp solo win rate) is invisible per game and decisive at scale — measured, not vibes.
- Engine gains `MC_ON` (headless genome training switches the Monte Carlo layer off — ~500× throughput difference; genome self-play measures the heuristic layer both brains share).

**Tests** — 39/39 engine assertions, trainer sanity 6/6, trainer parity 27/27, ladder sanity 4/4, in-repo champion-vs-baseline smoke run green.
