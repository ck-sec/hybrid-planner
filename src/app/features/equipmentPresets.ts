import type { EquipmentMode } from './models.ts'

export const equipmentPresets: Record<EquipmentMode, { title: string; description: string; items: readonly string[] }> = {
  bodyweight: {
    title: 'Bodyweight',
    description: 'Just you and a little floor space.',
    items: ['Floor space'],
  },
  home: {
    title: 'Home gym',
    description: 'A simple free-weight setup.',
    items: ['Dumbbells', 'Kettlebells', 'Resistance bands', 'Adjustable bench', 'Exercise mat'],
  },
  commercial: {
    title: 'Commercial gym',
    description: 'Free weights, machines, and cardio.',
    items: ['Dumbbells', 'Barbell and plates', 'Squat rack', 'Adjustable bench', 'Cable machine', 'Resistance machines', 'Treadmill', 'Exercise bike', 'Rowing machine'],
  },
}
