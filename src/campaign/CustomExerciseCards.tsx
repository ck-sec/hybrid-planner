import { CUSTOM_EXERCISE_PROFILES } from '../../engine/custom-exercises.ts'
import type { CustomExerciseSpec } from '../../engine/types.ts'
import { programResourceLabel } from './programming.ts'

export default function CustomExerciseCards({ exercises }: { exercises: readonly CustomExerciseSpec[] }) {
  return <div className="cf-stack">{exercises.map(exercise => <article className="cf-card cf-stack" key={exercise.id}>
    <div><p className="cf-kicker">NEW EXERCISE</p><h3>{exercise.name}</h3></div>
    <p className="cf-small">{CUSTOM_EXERCISE_PROFILES[exercise.profileId].label} · {exercise.requirements.map(programResourceLabel).join(', ')}</p>
    <dl>
      <dt>Description</dt><dd>{exercise.description}</dd>
      <dt>What to focus on</dt><dd>{exercise.focus}</dd>
      <dt>Why this exercise</dt><dd>{exercise.why}</dd>
    </dl>
  </article>)}
    {exercises.length > 0 && <p className="cf-small">If approved, each exercise gets its own records. App checks do not assess technique.</p>}
  </div>
}
