import type { Equipment, Exercise, MovementPattern } from '../../engine/types.ts'

export interface ExerciseGuidanceOptions {
  execution?: string
  goal?: string
  slot?: string
}

export interface ExerciseGuidanceContent {
  description: string
  focus: readonly string[]
  why: string
  execution: string
}

type BaseGuidance = Omit<ExerciseGuidanceContent, 'execution'>

const GUIDANCE: Readonly<Record<string, BaseGuidance>> = {
  'back-squat': {
    description: 'Set the bar across the upper back, brace the trunk, sit down between the hips, then stand by driving through the whole foot.',
    focus: ['Keep the bar balanced over the mid-foot.', 'Let the knees track in the same direction as the toes.', 'Keep the trunk braced as the hips and knees rise together.'],
    why: 'A barbell squat builds the plan’s knee-dominant strength work through a large, stable range.',
  },
  'front-squat': {
    description: 'Support the bar on the front of the shoulders with the elbows lifted, squat between the hips, then stand while keeping the torso tall.',
    focus: ['Keep the whole foot planted.', 'Hold the elbows up so the bar stays supported.', 'Allow the knees to travel with the toes.'],
    why: 'This is a knee-dominant strength option with an upright bar position and a substantial trunk demand.',
  },
  'goblet-squat': {
    description: 'Hold one dumbbell close to the chest, squat down between the hips, then press the floor away to stand.',
    focus: ['Keep the weight close to the body.', 'Stay balanced across the whole foot.', 'Track the knees with the toes.'],
    why: 'The front-held load makes knee-dominant strength work accessible without a rack.',
  },
  'kettlebell-goblet-squat': {
    description: 'Hold the kettlebell by the horns close to the chest, sit down between the hips, then stand through the whole foot.',
    focus: ['Keep the bell close and the trunk braced.', 'Stay balanced across the whole foot.', 'Track the knees with the toes.'],
    why: 'The compact front-held load provides straightforward knee-dominant strength work.',
  },
  'bodyweight-squat': {
    description: 'Stand in a comfortable stance, sit down between the hips while keeping the feet planted, then stand tall.',
    focus: ['Keep pressure across the whole foot.', 'Track the knees with the toes.', 'Use a range you can control without losing balance.'],
    why: 'This provides knee-dominant practice and lower-body strength work without external load.',
  },
  'leg-press': {
    description: 'Set the seat so the hips stay supported, lower the platform under control, then press through the feet without lifting the pelvis.',
    focus: ['Keep the hips and back supported by the pad.', 'Track the knees with the toes.', 'Do not lock the knees forcefully at the finish.'],
    why: 'The machine supports the torso while the legs perform knee-dominant strength work.',
  },
  deadlift: {
    description: 'Brace over the bar, push through the floor and extend the hips to stand, then return the bar close to the legs.',
    focus: ['Keep the bar close from floor to lockout.', 'Brace before the bar leaves the floor.', 'Finish tall without leaning behind the feet.'],
    why: 'The deadlift supplies heavy hip-dominant strength work using a stable bar path from the floor.',
  },
  'romanian-deadlift': {
    description: 'Hold the bar close, soften the knees, send the hips back until the hamstrings load, then drive the hips forward to stand.',
    focus: ['Keep the bar close to the thighs and shins.', 'Move mainly at the hips rather than turning it into a squat.', 'Keep the trunk braced throughout.'],
    why: 'This hinge emphasizes controlled hip extension and posterior-chain strength.',
  },
  'dumbbell-romanian-deadlift': {
    description: 'Hold the dumbbells beside the thighs, push the hips back with soft knees, then stand by bringing the hips through.',
    focus: ['Keep the dumbbells close to the legs.', 'Stop the descent before the back position changes.', 'Keep pressure balanced across each foot.'],
    why: 'This dumbbell hinge develops posterior-chain strength with independently held loads.',
  },
  'kettlebell-deadlift': {
    description: 'Stand over the kettlebell, hinge to grip it, push the floor away to stand, then return it between the feet with control.',
    focus: ['Keep the bell close beneath the body.', 'Brace before lifting.', 'Stand through the hips without leaning back.'],
    why: 'The centered load provides an approachable hip-dominant pull from the floor.',
  },
  'hip-thrust': {
    description: 'Support the upper back on the bench, brace, drive through the feet and extend the hips, then lower under control.',
    focus: ['Keep the ribs settled as the hips rise.', 'Finish with the hips rather than arching the lower back.', 'Keep the feet planted and knees tracking forward.'],
    why: 'The supported position concentrates the session’s hip-extension strength work.',
  },
  'machine-leg-curl': {
    description: 'Align the machine with the knee joint, keep the hips against the pad, curl the pad toward the body, then return smoothly.',
    focus: ['Keep the hips and torso still.', 'Move through a controlled range.', 'Avoid letting the stack pull the legs back.'],
    why: 'This machine isolates knee-flexion work as a simple posterior-leg accessory.',
  },
  'bench-press': {
    description: 'Lie with the feet planted and shoulder blades supported on the bench, lower the bar toward the chest, then press it back over the shoulders.',
    focus: ['Keep the wrists stacked over the forearms.', 'Maintain steady contact with the bench and floor.', 'Use a repeatable touch point and bar path.'],
    why: 'The bench press is the plan’s stable barbell option for horizontal pushing strength.',
  },
  'dumbbell-bench-press': {
    description: 'Lie on the bench with a dumbbell in each hand, lower them beside the chest, then press them up over the shoulders.',
    focus: ['Keep the wrists over the elbows.', 'Keep the shoulder blades supported by the bench.', 'Move both dumbbells through a controlled path.'],
    why: 'Independent loads provide horizontal pushing work while allowing each arm to find a comfortable path.',
  },
  'push-up': {
    description: 'Start in a straight plank, lower the chest between the hands, then push the floor away without losing trunk position.',
    focus: ['Keep head, trunk and hips moving as one unit.', 'Place the hands where the shoulders move comfortably.', 'Keep the elbows tracking consistently.'],
    why: 'The push-up combines horizontal pushing strength with active trunk control.',
  },
  'machine-chest-press': {
    description: 'Set the seat so the handles align comfortably with the chest, press forward, then let the handles return under control.',
    focus: ['Keep the back supported by the pad.', 'Keep the wrists aligned with the forearms.', 'Avoid shrugging as the handles move.'],
    why: 'The guided path offers supported horizontal pushing strength work.',
  },
  'cable-chest-press': {
    description: 'Stand braced between the cables, press the handles forward from the chest, then return them without letting the stack pull you back.',
    focus: ['Keep the trunk and pelvis quiet.', 'Let the shoulder blades move naturally.', 'Keep even pressure through the stance.'],
    why: 'The standing cable press combines horizontal pushing with modest whole-body position control.',
  },
  'overhead-press': {
    description: 'Brace with the bar at the shoulders, press it overhead as the head clears the path, then return it to the shoulders.',
    focus: ['Keep the bar close to the face on the way up.', 'Keep the ribs and pelvis stacked.', 'Finish with the bar balanced over the body.'],
    why: 'This barbell press supplies the plan’s vertical pushing strength work.',
  },
  'dumbbell-overhead-press': {
    description: 'Start with the dumbbells at shoulder level, brace, press them overhead, then return them along the same controlled path.',
    focus: ['Keep the ribs stacked over the pelvis.', 'Keep the wrists over the forearms.', 'Finish without shrugging or leaning back.'],
    why: 'Independent dumbbells provide vertical pushing work with freedom to choose a comfortable arm path.',
  },
  'kettlebell-floor-press': {
    description: 'Lie on the floor with the kettlebells supported at the forearms, lower until the upper arms meet the floor, then press upward.',
    focus: ['Keep each wrist stacked and steady.', 'Pause softly at the floor rather than bouncing.', 'Keep the trunk settled as the bells move.'],
    why: 'The floor limits the lowering range while the kettlebells provide horizontal pushing work.',
  },
  'dumbbell-row': {
    description: 'Take a braced split stance, support the nonworking forearm on the front thigh, pull the dumbbell toward the torso, then lower it without rotating.',
    focus: ['Keep steady pressure through the supporting forearm and front leg.', 'Lead the pull with the elbow.', 'Keep the hips and ribcage square.'],
    why: 'This single-side row develops horizontal pulling strength with a dumbbell.',
  },
  'kettlebell-row': {
    description: 'Take a braced split stance, support the nonworking forearm on the front thigh, pull the kettlebell toward the torso, then lower it without rotating.',
    focus: ['Keep steady pressure through the supporting forearm and front leg.', 'Keep the bell beneath the wrist.', 'Avoid turning the chest toward the working side.'],
    why: 'This is a single-side horizontal pull using a compact, independently held load.',
  },
  'cable-row': {
    description: 'Sit tall with the cable in front, pull the handle toward the torso, then reach forward under control without collapsing.',
    focus: ['Keep the trunk steady rather than rocking.', 'Drive the elbows back without shrugging.', 'Control the cable as the arms lengthen.'],
    why: 'The cable maintains resistance through a supported horizontal pulling path.',
  },
  'machine-row': {
    description: 'Set the support against the chest, pull the handles toward the body, then return until the arms lengthen comfortably.',
    focus: ['Keep the chest in contact with the support.', 'Pull without lifting the shoulders.', 'Control the return rather than dropping the stack.'],
    why: 'Chest support lets the upper back perform horizontal pulling work with little demand on trunk position.',
  },
  'band-row': {
    description: 'Anchor the band securely, stand braced, draw the hands toward the ribs, then let the arms lengthen under control.',
    focus: ['Check the anchor before starting.', 'Keep the trunk still as band tension changes.', 'Finish by moving the elbows behind the body.'],
    why: 'The band provides portable horizontal pulling work with resistance that rises through the pull.',
  },
  'pull-up': {
    description: 'Hang from the bar, pull the chest upward by driving the elbows down, then return to a controlled hang.',
    focus: ['Begin from an active, braced shoulder position.', 'Keep the body from swinging.', 'Use the available range without reaching the chin.'],
    why: 'The pull-up supplies bodyweight vertical pulling strength.',
  },
  'lat-pulldown': {
    description: 'Sit securely under the thigh pad, pull the bar toward the upper chest, then let the arms lengthen overhead with control.',
    focus: ['Keep the torso mostly still.', 'Drive the elbows down rather than pulling behind the neck.', 'Avoid shrugging at the bottom.'],
    why: 'The cable provides adjustable vertical pulling work in a supported seated position.',
  },
  'split-squat': {
    description: 'Take a split stance with dumbbells at the sides, lower mostly straight down, then press through the front foot to rise.',
    focus: ['Keep both feet fixed through the repetition.', 'Track the front knee with the toes.', 'Keep the pelvis and trunk facing forward.'],
    why: 'This loaded split stance develops unilateral lower-body strength and position control.',
  },
  'bodyweight-split-squat': {
    description: 'Set a stable split stance, lower the back knee toward the floor, then rise through the front foot without stepping.',
    focus: ['Keep the stance long enough to stay balanced.', 'Track the front knee with the toes.', 'Keep the trunk and pelvis facing forward.'],
    why: 'This provides unilateral lower-body work without requiring external load.',
  },
  'step-up': {
    description: 'Place one whole foot on a stable step, drive through that foot to stand on top, then step down with control.',
    focus: ['Use a step height that permits a steady pelvis.', 'Keep the working knee tracking with the toes.', 'Avoid pushing excessively from the trailing foot.'],
    why: 'The step-up trains unilateral leg strength through a practical supported path.',
  },
  'reverse-lunge': {
    description: 'Step one foot back, lower both knees while keeping the front foot planted, then drive through the front leg to return.',
    focus: ['Keep the front foot fully planted.', 'Step back far enough to stay balanced.', 'Keep the front knee tracking with the toes.'],
    why: 'The backward step provides unilateral lower-body strength work with a clear return position.',
  },
  'dumbbell-farmer-carry': {
    description: 'Stand tall with a dumbbell in each hand and walk with short, deliberate steps while keeping the loads quiet at the sides.',
    focus: ['Keep the ribs stacked over the pelvis.', 'Hold the handles firmly without shrugging.', 'Turn and stop under control.'],
    why: 'The even carry challenges grip and whole-body bracing while walking under load.',
  },
  'kettlebell-suitcase-carry': {
    description: 'Hold the kettlebell at one side and walk steadily without leaning toward or away from the load.',
    focus: ['Keep the shoulders and pelvis level.', 'Keep the bell from swinging.', 'Use deliberate steps and controlled turns.'],
    why: 'The one-sided carry challenges grip and resisting side bend during loaded walking.',
  },
  'machine-loaded-carry': {
    description: 'Stand evenly between the machine handles, lift them into a tall position and walk steadily through the clear carry lane.',
    focus: ['Keep the load balanced between both sides.', 'Walk without shrugging or leaning.', 'Control every turn and the final set-down.'],
    why: 'The fixed handles provide a symmetrical loaded carry for grip and whole-body bracing.',
  },
  'dead-bug': {
    description: 'Lie on the back with arms and legs raised, brace the trunk, extend opposite limbs away, then return without the lower back lifting.',
    focus: ['Keep the ribs settled toward the pelvis.', 'Move only as far as trunk position allows.', 'Breathe without releasing the brace.'],
    why: 'The dead bug develops trunk control while the arms and legs move independently.',
  },
  'bird-dog': {
    description: 'From hands and knees, reach opposite arm and leg away, pause with the trunk level, then return and change sides.',
    focus: ['Keep the hips and shoulders square to the floor.', 'Reach long rather than lifting high.', 'Keep pressure steady through the supporting hand and knee.'],
    why: 'This bodyweight drill develops trunk control during opposite-limb movement.',
  },
  'front-plank': {
    description: 'Support the body on the forearms and feet, forming a straight line while breathing behind a steady brace.',
    focus: ['Keep the ribs and pelvis stacked.', 'Push the floor away through the forearms.', 'End the hold before the hips sag or rise.'],
    why: 'The plank provides a simple isometric trunk-strength slot.',
  },
  'pallof-press': {
    description: 'Stand side-on to the cable, hold it at the chest, press the hands forward without letting the torso turn, then return.',
    focus: ['Keep the hips and shoulders facing forward.', 'Maintain an even stance as cable tension pulls sideways.', 'Move the arms without rotating the trunk.'],
    why: 'The cable challenges the trunk to resist rotation while the arms move.',
  },
  'band-pallof-press': {
    description: 'Stand side-on to a secure band anchor, press the band away from the chest without turning, then return under control.',
    focus: ['Check the anchor before starting.', 'Keep the hips and shoulders square.', 'Resist the band rather than leaning away from it.'],
    why: 'This band variation supplies anti-rotation trunk work with portable equipment.',
  },
  'band-rotation': {
    description: 'Stand beside a secure band anchor and turn the ribcage and hips together through a controlled arc, then return smoothly.',
    focus: ['Check the anchor before starting.', 'Pivot as needed rather than twisting only through the knees.', 'Control the band in both directions.'],
    why: 'This provides controlled rotational strength work against changing band tension.',
  },
  'calf-raise': {
    description: 'Stand with the forefoot supported, rise onto the ball of the foot, then lower the heel through a controlled range.',
    focus: ['Keep pressure spread across the forefoot.', 'Rise straight up rather than rolling the ankle outward.', 'Use support for balance rather than momentum.'],
    why: 'The calf raise adds focused lower-leg strength work to the unilateral-lower slot.',
  },
  'band-face-pull': {
    description: 'Anchor the band near face height, pull it toward the face with elbows spreading, then return without losing posture.',
    focus: ['Check the anchor before starting.', 'Keep the shoulders down as the elbows travel back.', 'Control the band as the arms lengthen.'],
    why: 'This light horizontal pull emphasizes upper-back and rear-shoulder work.',
  },
  'cable-face-pull': {
    description: 'Set the cable near face height, pull the rope toward the face with elbows spreading, then return under control.',
    focus: ['Keep the torso still.', 'Pull without shrugging the shoulders.', 'Keep the wrists aligned with the rope ends.'],
    why: 'The cable offers steady resistance for upper-back and rear-shoulder pulling work.',
  },
  'half-kneeling-hip-flexor': {
    description: 'Kneel in a split stance, gently tuck the pelvis and shift forward until the front of the rear hip feels a comfortable stretch.',
    focus: ['Keep the ribs over the pelvis.', 'Create the position with a small pelvic tuck rather than a back arch.', 'Stay inside a comfortable range.'],
    why: 'This mobility slot explores controlled hip extension in a supported position.',
  },
  'thoracic-open-book': {
    description: 'Lie on the side with knees stacked, sweep the top arm and ribcage open, then return while the knees remain together.',
    focus: ['Keep the knees stacked and supported.', 'Follow the moving hand with the eyes and chest.', 'Use a comfortable range without forcing the shoulder down.'],
    why: 'This mobility slot explores controlled upper-back rotation while the lower body stays quiet.',
  },
  snatch: {
    description: 'A technical lift logged only as a coached reference, moving the bar from the floor to overhead in one continuous action.',
    focus: ['Use only a familiar, coached setup.', 'Keep the bar close through the pull.', 'Receive it in a balanced overhead position.'],
    why: 'This high-skill lift is retained for logging and scheduling context rather than general exercise instruction.',
  },
  'dodgeball-controlled-target-throw': {
    description: 'From a balanced stance, make a deliberate throw toward the designated safe target, then reset fully before the next attempt.',
    focus: ['Keep every throw controlled rather than maximal.', 'Use the established court lane and safe target.', 'Finish balanced and retrieve the ball only when the area is clear.'],
    why: 'This is controlled throwing practice inside an established sport session, not extra conditioning or maximal-power work.',
  },
}

const PATTERN_GUIDANCE: Readonly<Record<MovementPattern, BaseGuidance>> = {
  knee_dominant: {
    description: 'Set up in a balanced stance, bend through the knees and hips under control, then press through the feet to stand.',
    focus: ['Keep the whole foot supported.', 'Track the knees with the toes.', 'Use a range that preserves balance and trunk position.'],
    why: 'This exercise fills a knee-dominant lower-body strength role.',
  },
  hip_dominant: {
    description: 'Brace the trunk, send the hips back to load the hinge, then stand by extending the hips.',
    focus: ['Keep the load close to the body.', 'Maintain a steady trunk position.', 'Finish tall without leaning back.'],
    why: 'This exercise fills a hip-dominant posterior-chain strength role.',
  },
  horizontal_push: {
    description: 'Set the shoulders and trunk, lower the resistance toward the chest, then press it away along a repeatable path.',
    focus: ['Keep wrists and forearms aligned.', 'Keep the trunk steady.', 'Use a comfortable shoulder path.'],
    why: 'This exercise fills a horizontal pushing strength role.',
  },
  vertical_push: {
    description: 'Brace with the resistance near the shoulders, press it overhead, then return along a controlled path.',
    focus: ['Keep the ribs stacked over the pelvis.', 'Keep wrists and forearms aligned.', 'Finish balanced without leaning back.'],
    why: 'This exercise fills a vertical pushing strength role.',
  },
  horizontal_pull: {
    description: 'Start with the arms extended, draw the resistance toward the torso, then return it without losing trunk position.',
    focus: ['Lead with the elbows.', 'Avoid shrugging during the pull.', 'Control the return.'],
    why: 'This exercise fills a horizontal pulling strength role.',
  },
  vertical_pull: {
    description: 'Start with the arms overhead, drive the elbows down to pull, then return to a controlled overhead position.',
    focus: ['Keep the trunk mostly still.', 'Avoid shrugging as the pull finishes.', 'Use a comfortable shoulder range.'],
    why: 'This exercise fills a vertical pulling strength role.',
  },
  unilateral_lower: {
    description: 'Set a stable staggered or single-leg position, lower under control, then drive through the working foot to rise.',
    focus: ['Keep the working foot supported.', 'Track the knee with the toes.', 'Keep the pelvis level and facing forward.'],
    why: 'This exercise fills a unilateral lower-body strength role.',
  },
  carry: {
    description: 'Lift the implement into a tall, braced position and walk with deliberate steps before setting it down under control.',
    focus: ['Keep the load from swinging.', 'Keep the ribs stacked over the pelvis.', 'Control turns and the final set-down.'],
    why: 'This loaded carry develops grip and whole-body bracing while walking.',
  },
  core: {
    description: 'Set a stable trunk position, complete the prescribed limb movement or hold, and stop before that position changes.',
    focus: ['Keep the ribs and pelvis stacked.', 'Breathe without losing the brace.', 'Use only the range you can control.'],
    why: 'This exercise fills a trunk-control role in the session.',
  },
  rotational: {
    description: 'Set a balanced stance and move or resist the resistance across the body while controlling the trunk and pelvis.',
    focus: ['Keep the feet and knees organised with the turn.', 'Move smoothly in both directions.', 'Avoid using momentum to create extra range.'],
    why: 'This exercise fills a controlled rotation or anti-rotation role.',
  },
}

const EQUIPMENT_DETAIL: Readonly<Partial<Record<Equipment, string>>> = {
  barbell: ' Keep the barbell balanced and close where the movement requires.',
  dumbbell: ' Keep the independently held dumbbell load balanced.',
  kettlebell: ' Keep the kettlebell secure and close through transitions.',
  machine: ' Adjust the machine contact points to fit the movement.',
  cable: ' Keep tension directed from the cable without being pulled out of position.',
  bodyweight: ' Use your body position to keep the movement controlled.',
  bands: ' Inspect the band and control its changing tension.',
}

function cleanContext(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\s+/g, ' ')
  return cleaned || undefined
}

function executionText(exercise: Exercise, requested: string | undefined): string {
  if (exercise.id === 'dodgeball-controlled-target-throw') {
    return 'Controlled target throw: use a deliberate, submaximal release to the designated safe target and reset between throws'
  }
  const label = cleanContext(requested)
  if (!label) return 'Controlled: use a smooth, deliberate path in both directions and follow the displayed prescription'
  const normalized = label.toLowerCase()
  if (/ballistic|jump|plyometric/.test(normalized)) {
    return 'Unsupported ballistic or jumping execution: stay with the exact grounded exercise variant displayed by the engine'
  }
  if (/slow|eccentric|lowering/.test(normalized)) {
    return 'Deliberate slow eccentric: lower with continuous control, keep the named positions, then return smoothly'
  }
  if (/fast|intent|explosive|accelerat/.test(normalized)) {
    return 'Fast upward intent: control the lowering phase, then accelerate upward while staying grounded; this is not a jump or ballistic variation'
  }
  if (/control|standard|steady|smooth/.test(normalized)) {
    return 'Controlled: use a smooth, deliberate path in both directions and follow the displayed prescription'
  }
  return `${label}: use only this displayed execution attached to the supported exercise variant`
}

function contextualWhy(base: string, options: ExerciseGuidanceOptions): string {
  const slot = cleanContext(options.slot)
  const goal = cleanContext(options.goal)
  if (slot && goal) return `${base} It fills the selected ${slot} slot as general support within the ${goal} goal.`
  if (slot) return `${base} It fills the selected ${slot} slot in this session.`
  if (goal) return `${base} It provides general support within the ${goal} goal without changing the planned work.`
  return base
}

export function exerciseGuidance(exercise: Exercise, options: ExerciseGuidanceOptions = {}): ExerciseGuidanceContent {
  const exact = GUIDANCE[exercise.id]
  const generic = PATTERN_GUIDANCE[exercise.pattern]
  const equipmentDetail = exact ? '' : exercise.equipment.map(item => EQUIPMENT_DETAIL[item]).find(Boolean) ?? ''
  const base = exact ?? {
    ...generic,
    description: `${exercise.name}: ${generic.description}${equipmentDetail}`,
  }
  return {
    description: base.description,
    focus: base.focus,
    why: contextualWhy(base.why, options),
    execution: executionText(exercise, options.execution),
  }
}
