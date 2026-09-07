import type { Session } from '../../engine/types.ts'

export function sessionTitle(session: Session): string {
  return session.kind === 'commitment' || session.kind === 'workout' ? session.label
    : session.kind === 'strength' ? 'Strength foundations'
      : session.kind === 'conditioning' ? session.modality === 'row' ? 'Easy rowing' : session.modality === 'ski_erg' ? 'Easy SkiErg' : session.discipline === 'bike' ? 'Easy cycling' : 'Easy run'
        : session.endurancePrescription.intent === 'long' ? 'Long easy run' : 'Easy run'
}
