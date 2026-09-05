# 0003: Do not implement ACWR

Status: accepted.

## Decision

Do not calculate, persist, or display an acute:chronic workload ratio (ACWR).
Do not disguise the same ratio as a readiness score, risk gauge, traffic light,
or recommendation trigger.

## Why

A ratio of recent and longer-term training loads is not an individualized
diagnosis or a validated universal rule for deciding whether an athlete should
train. Its interpretation depends on arbitrary time windows, load definitions,
and statistical choices. A precise-looking number would overstate what this
small planner knows and could turn legitimate rest into a warning.

This is a product decision to avoid false precision, not a claim that training
history is irrelevant. The engine must expose its actual inputs, constraints,
and decisions instead of manufacturing a readiness construct.

## Consequences

- Show factual planned/completed work without assigning injury-risk thresholds.
- Use explicit, auditable baseline and scheduling constraints.
- Apply the safety floor after candidate scoring; do not turn it into a
  tradeable penalty.
- Missed work is not debt, and rest does not reset an achievement.
- Any proposed adaptation metric needs its own documented rationale, limitations,
  and tests; renaming ACWR does not make it acceptable.
