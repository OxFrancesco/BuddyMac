export interface KeyModifiers { cmd: boolean; shift: boolean; alt: boolean; ctrl: boolean }
export interface RecordedShortcut { keyCode: number; key: string; modifiers: KeyModifiers }

const keyCodes: Record<string, [number, string]> = {
  a: [0, 'A'], s: [1, 'S'], d: [2, 'D'], f: [3, 'F'], h: [4, 'H'], g: [5, 'G'], z: [6, 'Z'], x: [7, 'X'], c: [8, 'C'], v: [9, 'V'],
  b: [11, 'B'], q: [12, 'Q'], w: [13, 'W'], e: [14, 'E'], r: [15, 'R'], y: [16, 'Y'], t: [17, 'T'], '1': [18, '1'], '2': [19, '2'],
  '3': [20, '3'], '4': [21, '4'], '6': [22, '6'], '5': [23, '5'], '=': [24, '='], '9': [25, '9'], '7': [26, '7'], '-': [27, '-'],
  '8': [28, '8'], '0': [29, '0'], ']': [30, ']'], o: [31, 'O'], u: [32, 'U'], '[': [33, '['], i: [34, 'I'], p: [35, 'P'],
  enter: [36, 'Return'], l: [37, 'L'], j: [38, 'J'], "'": [39, "'"], k: [40, 'K'], ';': [41, ';'], '\\': [42, '\\'], ',': [43, ','],
  '/': [44, '/'], n: [45, 'N'], m: [46, 'M'], '.': [47, '.'], tab: [48, 'Tab'], space: [49, 'Space'], '`': [50, '`'],
  backspace: [51, 'Delete'], escape: [53, 'Escape'], f1: [122, 'F1'], f2: [120, 'F2'], f3: [99, 'F3'], f4: [118, 'F4'], f5: [96, 'F5'],
  f6: [97, 'F6'], f7: [98, 'F7'], f8: [100, 'F8'], f9: [101, 'F9'], f10: [109, 'F10'], f11: [103, 'F11'], f12: [111, 'F12'],
  left: [123, '←'], right: [124, '→'], down: [125, '↓'], up: [126, '↑'],
}
const labels = new Map(Object.values(keyCodes).map(([code, label]) => [code, label]))
const modifierKeys = new Set(['shift', 'control', 'ctrl', 'alt', 'option', 'cmd', 'command', 'platform', 'meta', 'fn', 'function', 'capslock'])

export function recordKey(key: string | undefined, modifiers: KeyModifiers | undefined): RecordedShortcut | null {
  if (!key || modifierKeys.has(key.toLowerCase())) return null
  const entry = keyCodes[key.toLowerCase()]
  if (!entry) return null
  return { keyCode: entry[0], key: entry[1], modifiers: modifiers ?? { cmd: false, shift: false, alt: false, ctrl: false } }
}

const carbon = { cmd: 256, shift: 512, alt: 2048, ctrl: 4096 } as const
const cocoa = { shift: 131072, ctrl: 262144, alt: 524288, cmd: 1048576 } as const
const order = ['ctrl', 'alt', 'shift', 'cmd'] as const
const names = { ctrl: 'Control', alt: 'Option', shift: 'Shift', cmd: 'Command' } as const

export const toCarbon = (modifiers: KeyModifiers) => order.reduce((sum, key) => sum + (modifiers[key] ? carbon[key] : 0), 0)
export const toCocoa = (modifiers: KeyModifiers) => order.reduce((sum, key) => sum + (modifiers[key] ? cocoa[key] : 0), 0)
export const fromCarbon = (value: number): KeyModifiers => ({ cmd: (value & carbon.cmd) !== 0, shift: (value & carbon.shift) !== 0, alt: (value & carbon.alt) !== 0, ctrl: (value & carbon.ctrl) !== 0 })
export const fromCocoa = (value: number): KeyModifiers => ({ cmd: (value & cocoa.cmd) !== 0, shift: (value & cocoa.shift) !== 0, alt: (value & cocoa.alt) !== 0, ctrl: (value & cocoa.ctrl) !== 0 })
export const hasModifier = (modifiers: KeyModifiers) => modifiers.cmd || modifiers.alt || modifiers.ctrl
export const keyLabel = (keyCode: number) => labels.get(keyCode) ?? `Key ${keyCode}`
export const formatShortcut = (keyCode: number, modifiers: KeyModifiers, label = keyLabel(keyCode)) =>
  [...order.filter(key => modifiers[key]).map(key => names[key]), label].join(' + ')
