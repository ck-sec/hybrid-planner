import './exercise-guide.css'

export interface ExerciseGuideContent {
  description: string
  focus: readonly string[]
  why: string
  execution: string
}

export default function ExerciseGuide({ name, guide }: { name: string; guide: ExerciseGuideContent }) {
  return <details className="cf-exercise-guide">
    <summary aria-label={`${name}: exercise guide`}>Exercise guide</summary>
    <dl aria-label={`${name} movement guide`}>
      <dt>Description</dt><dd>{guide.description}</dd>
      <dt>What to focus on</dt><dd><ul>{guide.focus.map(cue => <li key={cue}>{cue}</li>)}</ul></dd>
      <dt>Why this exercise</dt><dd>{guide.why}</dd>
      <dt>Execution</dt><dd>{guide.execution}. Use the displayed prescription; a different execution style needs a supported variant.</dd>
    </dl>
  </details>
}
