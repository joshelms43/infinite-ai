# ARENA VERDICT: main + nets/value-gym-v1.json is STRONGER than main

- instrument: engine/arena.html v0.3.0 (anytime-valid Robbins mixture, alpha=0.05, rho=100 — constants pre-committed in-page and pinned by test:arena)
- protocol: paired seeds from 50000 (fresh, never used by any prior run), 6 games/seed, MCTS on both sides; only difference = value net on the work side
- decision: crossed at 2,412 games — 52.78% ± 2.73pp
- state when recorded (2,742 games, 457 seeds, all decided):
  - head-to-head share, work: 53.32%, confidence sequence 50.73% … 55.91%
  - work solo vs 2x base: 36.76% | base solo vs 2x work: 30.12% (fair baseline 33.3%)
- run on Josh's machine, 7 workers, 11.3 games/sec
- honest magnitude note: the anytime test certifies the SIGN (net > base) with familywise
  alpha 0.05; the point estimate at crossing is optimistically biased (winner's curse on
  magnitude, not existence). True edge is plausibly ~+2pp — larger than the MCTS gain
  (+1.31pp), which took 9,000 games to certify.
- lineage: net trained in engine/learn.html — 316,099 greedy self-play games, 5.03M
  positions, holdout 17.7% better than base rate. This is flywheel lap 1.
