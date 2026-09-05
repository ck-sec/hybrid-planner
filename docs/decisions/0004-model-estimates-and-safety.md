# 0004: Explicit estimates, bounded prescriptions, independent safety

Status: accepted for engine 0.2.0 / policy baseline-bounded-1.

## Observation is not inference

Session effort is a reported 0-10 value. Multiplying it by actual duration
produces session training load. Neither is interchangeable with the engine's
systemic and structural scheduling-cost estimates (arbitrary units, AU).
The two-axis model is a scheduling hypothesis, not a physiological measurement,
a readiness score, an injury probability, or a validated ordering of exercises.

The initial exercise library is small, hand-authored, and publicly inspectable.
Coefficients apply to a ten-repetition set at RPE 7. They do not use cross-exercise
weight ratios. Zero added kilograms is a valid observation, never a denominator.
High-skill exercises can have metadata and logged costs, but cannot be generated.

No automatic multiplier or half-life learning is enabled. One subjective
session-effort value cannot uniquely identify two cost multipliers and two
recovery rates. Fixed 24-hour and 60-hour model half-lives are estimates, not
claims about individual tissue recovery. Prior sessions are included only after
the residual snapshot, avoiding double counting.

## Literature motivates hypotheses, not magic numbers

- Wilson et al. (2012), DOI: 10.1519/JSC.0b013e31823a3e2d, reported modality,
  frequency, and duration associations. It did not validate this load model.
- Schumann et al. (2022), DOI: 10.1007/s40279-021-01587-7, reported an attenuation
  of explosive strength with same-session training. The often-quoted -0.31
  effect is not a 2024 Kazior result. Its lack of significance for >=3-hour
  separation does not prove that a universal three-hour threshold eliminates
  interference. Running-versus-cycling moderation was not significant.
- The RIR-based scale gives RPE 9 approximately one repetition remaining and
  RPE 8 approximately two. Some secondary prose contains an inconsistent mapping;
  use the published scale table. Closer-to-failure rating accuracy does not itself
  justify prescribing high effort.

Finite penalty weights, novice caps, clearance thresholds, and phase fractions
are implementation estimates/policies, not converted research effect sizes.
Each penalty magnitude is bounded to [0,1]; a weight only makes sense relative
to its normalization. Explanations must describe modeled preferences, never
assert that a particular AU value makes a person safe to train.

## Weekly generation

Blocks store stable pattern-to-exercise assignments and a phase skeleton.
Weeks materialize from explicit baseline, history, neighboring sessions, residual
timestamp, safety holds, and user pins. Generated running remains easy and within
established minutes; generated strength uses the athlete's established exercise
observations. Novice targets are capped at RPE 7 and experienced anchors at 8.
Suggested kilograms are shown only for a matching same-exercise rep/RPE
observation, never inferred from another exercise.

The first week reduces optional work to 60%, subject to a minimum of one set.
Deload/taper phases also reduce work. Phase labels do not imply validated
periodization, event specificity, or guaranteed peak performance. Goal qualities
can influence scheduling preferences, but do not manufacture new intensity work.
Aggressiveness only changes reductions; it cannot breach the baseline ceiling.

Normal completed weeks since the baseline can constrain the running ceiling.
Planned deload/taper/calibration reductions do not become an artificial
progression reference. A new explicitly confirmed baseline supersedes older
normal-volume references; old observations remain in history.
An interruption through illness, pain, or a break is not treated as a deload;
re-establishing an appropriate baseline is explicit.

## Hard validity and safety are not penalties

Pins and fixed commitments cannot be moved, dropped, or rewritten by scoring.
Unavailable days, time-budget overruns, overlaps, workload ceilings, and safety
holds are vetoes. Weights never use Infinity (Infinity times zero is NaN and
neither value survives JSON faithfully).

Candidates are scored and then checked against an independent safety floor.
Only passing candidates can be recommended. If mandatory commitments conflict,
show them as conflicts with an infeasibility result, not as an acceptable plan.
Omitted work is not redistributed. Recompute explanations from the returned
arrangement rather than describing a discarded candidate.

Separation is end-to-start, including neighboring dates. Unknown times cannot
prove sufficient separation. The pure engine uses one planning-local Gregorian
calendar, not host timezone behavior. Day indices remain Monday=0 through
Sunday=6; no implicit migration to Sunday-zero.

## Reproducibility and persistence

Engine, policy, exercise-library versions, and the complete planning input are
frozen with each saved week. Unsupported versions fail visibly. Version 0.1
maintenance plans continue to use their original engine and Monday-zero inputs;
upgrading the application never regenerates them under new rules.

The library JSON and constants are part of the auditable model. A meaningful
change to either requires a version change and regression tests. All runtime
inputs and imported backups are validated before use.
