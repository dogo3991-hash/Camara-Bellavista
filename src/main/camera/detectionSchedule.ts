// Horario en que la detección corre sola (hora del PC). De noche la cámara pasa
// a infrarrojo: se pierde el color y los insectos generan capturas falsas, y
// desde ~18:00 el sol bajo deja neblina y reflejos. Fuera de este rango la
// detección se pausa y vuelve a partir sola al día siguiente.
export const ACTIVE_FROM_HOUR = 7
export const ACTIVE_UNTIL_HOUR = 18

export function isWithinActiveHours(date: Date = new Date()): boolean {
  const hour = date.getHours()
  return hour >= ACTIVE_FROM_HOUR && hour < ACTIVE_UNTIL_HOUR
}

export function activeHoursLabel(): string {
  const pad = (h: number): string => `${String(h).padStart(2, '0')}:00`
  return `${pad(ACTIVE_FROM_HOUR)}–${pad(ACTIVE_UNTIL_HOUR)}`
}
