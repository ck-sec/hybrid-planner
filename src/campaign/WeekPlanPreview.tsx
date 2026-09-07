import type { ExerciseLibrary, ProgramConfigV1, WeekPlan } from '../../engine/types.ts'
import { authoredPolicyOptions } from './authored-policy.ts'
import { sessionTitle } from './session-title.ts'

export default function WeekPlanPreview({ plan, library, program }: { plan: WeekPlan; library: ExerciseLibrary; program?: ProgramConfigV1 }) {
  const advisory = authoredPolicyOptions(plan.policyVersion).policy === 'ai-advisory'
  const warnings = advisory
    ? [...new Set(plan.warnings.map(warning => warning.replace(/^\[[^\]]+\] [^\n]*?: Advisory only: /, '')))]
    : plan.warnings
  return <div className="cf-card cf-stack">
    <h3>Checked week starting {plan.weekStart}</h3>
    <p className="cf-small">{plan.safety.passed ? advisory ? 'Hard data and equipment checks passed' : 'App checks passed' : 'Hard app checks need attention'}—not medical clearance or a technique assessment. Nothing is logged until you record it.</p>
    {advisory && <p role="status">You and AI decide the training. Frequency, rest, volume, baseline and recovery warnings are advisory, not failed data checks.</p>}
    {plan.sessions.map(session => <article key={session.id}>
      <h4>{sessionTitle(session)}</h4>
      <p className="cf-small">{session.date} at {session.startTime ?? 'time not set'} · {session.durationMin} min</p>
      {session.kind === 'workout' && <ul>{session.blocks.map((block, index) => {
        const id = block.unit === 'throws' ? block.drillId : block.exerciseId
        const name = library.exercises.find(item => item.id === id)?.name ?? program?.customSportDrills?.find(item => item.id === id)?.name
          ?? (id === 'dodgeball-controlled-target-throw' ? 'Controlled target throws' : id)
        return <li key={index}>{name}: {block.unit === 'throws' ? `${block.throws} throws within practice`
          : block.unit === 'seconds' ? `${block.sets} x ${block.seconds} seconds`
            : `${block.sets} x ${block.reps} reps, RPE ${block.targetRPE}`}</li>
      })}</ul>}
      {session.kind === 'strength' && <ul>{session.strengthPrescription.map(item => <li key={item.exerciseId}>{library.exercises.find(exercise => exercise.id === item.exerciseId)?.name ?? item.exerciseId}: {item.sets} x {item.reps} reps, RPE {item.targetRPE}</li>)}</ul>}
    </article>)}
    {plan.omitted.map(item => <p role="status" key={item.sessionId}>{item.reason}</p>)}
    {warnings.length > 0 && <details className="cf-details" open><summary>{advisory ? 'Training advisories and assumptions' : 'App checks and assumptions'}</summary>{warnings.map((warning, index) => <p key={index} className="cf-small">{warning}</p>)}</details>}
  </div>
}
