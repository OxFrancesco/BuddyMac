import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useGpuix, type ImgInstance } from '@gpuix/react'
import { dirname, resolve } from 'node:path'
import { focus, type FocusCheckIn, type FocusSnapshot, type FocusTask, type FocusTaskDraft, type TaskPriority } from './focus'
import { focusService } from './focus-state'
import { Button, C, Check, Choice, Column, ErrorText, Field, Labeled, Row, Stacked, Text, display, space } from './ui'

// NotchFlow semantics: filters, ordering, phase cadence and analytics match NotchFlowCore and AppModel.
export type Filter = 'all' | 'today' | 'upcoming' | 'inbox' | 'priority' | 'completed'
export const filters: [Filter, string][] = [['all', 'All'], ['today', 'Today'], ['upcoming', 'Soon'], ['inbox', 'Inbox'], ['priority', 'P1/P2'], ['completed', 'Done']]
export const phaseColor: Record<FocusSnapshot['activePhase'], string> = { work: C.text, shortBreak: '#33e699', longBreak: '#4d99ff' }
export const phaseTitle = (phase: FocusSnapshot['activePhase']) => phase === 'work' ? 'Focus' : phase === 'longBreak' ? 'Long Break' : 'Short Break'
const priorityTint: Record<TaskPriority, string> = { p1: C.accent, p2: '#ed8533', p3: '#4d87db', p4: '#8a8a8a' }
const priorityName: Record<TaskPriority, string> = { p1: 'Urgent', p2: 'High', p3: 'Normal', p4: 'Low' }
export const moods: { symbol: string; title: string }[] = [{ symbol: ':(', title: 'Rough' }, { symbol: ':-(', title: 'Low' }, { symbol: ':|', title: 'Okay' }, { symbol: ':)', title: 'Good' }, { symbol: ':D', title: 'Great' }]
export const clock = (seconds: number) => { const value = Math.max(0, seconds); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }
const startOfDay = (date: Date) => { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy }
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
type Run = (work: () => Promise<FocusSnapshot>) => Promise<FocusSnapshot | null>

export function matches(task: FocusTask, filter: Filter) {
  const today = startOfDay(new Date()), due = task.dueDate ? new Date(task.dueDate) : null
  switch (filter) {
    case 'today': return !task.isCompleted && !!due && (sameDay(due, today) || due < today)
    case 'upcoming': return !task.isCompleted && !!due && due > today && !sameDay(due, today)
    case 'inbox': return !task.isCompleted && !task.projectName.trim()
    case 'priority': return !task.isCompleted && (task.priority === 'p1' || task.priority === 'p2')
    case 'all': return !task.isCompleted
    case 'completed': return task.isCompleted
  }
}
const overdue = (task: FocusTask) => { if (!task.dueDate || task.isCompleted) return false; const due = new Date(task.dueDate), today = startOfDay(new Date()); return due < today && !sameDay(due, today) }
const rank = (priority: TaskPriority) => Number(priority.slice(1))
export function sortTasks(tasks: FocusTask[], selected?: string) {
  return [...tasks].sort((a, b) => {
    if (a.id === selected) return -1
    if (b.id === selected) return 1
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1
    if (overdue(a) !== overdue(b)) return overdue(a) ? -1 : 1
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return Date.parse(a.dueDate) - Date.parse(b.dueDate)
    if (a.dueDate && !b.dueDate) return -1
    if (!a.dueDate && b.dueDate) return 1
    if (a.priority !== b.priority) return rank(a.priority) - rank(b.priority)
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex
    return Date.parse(a.createdAt) - Date.parse(b.createdAt)
  })
}
export function nextPhase(data: FocusSnapshot) {
  if (data.activePhase !== 'work') return 'work' as const
  return (data.completedWorkSessions + 1) % Math.max(1, data.settings.longBreakEvery) === 0 ? 'longBreak' as const : 'shortBreak' as const
}
export function stats(data: FocusSnapshot) {
  const work = data.sessionHistory.filter(session => session.phase === 'work')
  const days = new Set(work.map(session => startOfDay(new Date(session.finishedAt)).getTime()))
  let streak = 0
  for (const cursor = startOfDay(new Date()); days.has(cursor.getTime()); cursor.setDate(cursor.getDate() - 1)) streak++
  const since = startOfDay(new Date()); since.setDate(since.getDate() - 6)
  const week = work.filter(session => new Date(session.finishedAt) >= since)
  return { streak, minutes: week.reduce((sum, session) => sum + Math.floor(session.durationSeconds / 60), 0), sessions: week.length }
}
export const todayCheckIn = (data: FocusSnapshot) => data.checkIns.find(entry => sameDay(new Date(entry.day), new Date()))
const localDue = (date: string, time: string) => { const value = new Date(`${date}T${time || '00:00'}`); return Number.isNaN(value.getTime()) ? undefined : value.toISOString() }
const pad = (value: number) => String(value).padStart(2, '0')
const dateField = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const timeField = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
export const todayISO = () => startOfDay(new Date()).toISOString()

export function TimerSection({ data, run, clockSize = 52 }: { data: FocusSnapshot; run: Run; clockSize?: number }) {
  const duration = (data.activePhase === 'work' ? data.settings.workDurationMinutes : data.activePhase === 'longBreak' ? data.settings.longBreakMinutes : data.settings.shortBreakMinutes) * 60
  const progress = Math.min(1, Math.max(0, (duration - data.remainingSeconds) / Math.max(duration, 1)))
  const accent = phaseColor[data.activePhase]
  return <Column testId="focus-timer" style={{ gap: 14, flexShrink: 0 }}>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <text testId="focus-clock" style={{ fontFamily: display, fontSize: clockSize, fontWeight: 700, color: C.text }}>{clock(data.remainingSeconds)}</text>
      <Column style={{ gap: 2, alignItems: 'flex-end', paddingBottom: 10 }}>
        <Text size={11} style={{ color: accent }}>{phaseTitle(data.activePhase).toUpperCase()}</Text>
        <Text muted size={11}>{`→ ${phaseTitle(nextPhase(data))}`}</Text>
      </Column>
    </Row>
    <div style={{ width: '100%', height: 6, backgroundColor: '#1a1a1a', flexShrink: 0 }}><div style={{ width: `${Math.round(progress * 1000) / 10}%`, height: 6, backgroundColor: accent }} /></div>
    <Row style={{ gap: 8 }}>
      <Button id="timer-toggle" primary onClick={() => void run(() => focus.timer(data.isRunning ? 'pause' : 'start'))}>{data.isRunning ? 'Pause' : 'Start'}</Button>
      <Button id="timer-reset" onClick={() => void run(() => focus.timer('reset'))}>Reset</Button>
      <Button id="timer-skip" onClick={() => void run(() => focus.timer('skip'))}>Skip</Button>
    </Row>
  </Column>
}

const TaskRow = memo(function TaskRow({ task, selected, run, onEdit }: { task: FocusTask; selected: boolean; run: Run; onEdit: () => void }) {
  const [focused, setFocused] = useState(false)
  const complete = () => void run(() => focus.completeTask(task.id, !task.isCompleted))
  const due = task.dueDate ? new Date(task.dueDate) : null
  const dueLabel = !due ? '' : sameDay(due, new Date()) ? 'TODAY' : overdue(task) ? 'OVERDUE' : shortDate(due).toUpperCase()
  return <Row testId={`task-${task.id}`} style={{ gap: 10, flexShrink: 0 }}>
    <div testId={`complete-${task.id}`} role="checkbox" aria-label={task.isCompleted ? 'Mark task incomplete' : 'Mark task complete'} aria-checked={task.isCompleted} tabIndex={0} onClick={complete} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={event => { if (event.key === 'enter' || event.key === 'space') complete() }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', width: 44, minHeight: 44, flexShrink: 0, cursor: 'pointer', userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0, borderWidth: 2, borderColor: focused ? C.accent : C.text, backgroundColor: task.isCompleted ? C.text : C.bg, pointerEvents: 'none' }}>{task.isCompleted ? <text style={{ color: C.bg, fontSize: 10, fontWeight: 700, pointerEvents: 'none', userSelect: 'none' }}>✓</text> : null}</div>
    </div>
    <div testId={`select-${task.id}`} role="button" aria-label={`Focus on ${task.title}`} tabIndex={0} onClick={() => void run(() => focus.selectTask(task.id))} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 6, padding: space.inset, borderWidth: selected ? 2 : 1, borderColor: selected ? C.text : '#333333', backgroundColor: selected ? '#1a1a1a' : C.bg, cursor: 'pointer', hover: { backgroundColor: '#141414' } }}>
      <text style={{ fontSize: 14, color: task.isCompleted ? '#666666' : C.text, textDecoration: task.isCompleted ? 'line-through' : 'none' }}>{task.title}</text>
      <Row style={{ gap: 6 }}>
        <div style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, backgroundColor: priorityTint[task.priority] }}><text style={{ fontSize: 10, color: C.bg, fontWeight: 700 }}>{task.priority.toUpperCase()}</text></div>
        {dueLabel ? <Text size={10} style={{ color: overdue(task) ? C.accent : C.muted }}>{dueLabel}</Text> : null}
        {task.projectName ? <Text muted size={10}>{task.projectName}</Text> : null}
        {task.tags.length ? <Text muted size={10}>{task.tags.map(tag => `#${tag}`).join(' ')}</Text> : null}
        {task.pomodorosCompleted > 0 ? <Text muted size={10}>{`${task.pomodorosCompleted}×🍅`}</Text> : null}
      </Row>
    </div>
    <Row style={{ gap: 0 }}>
      <Button quiet id={`edit-${task.id}`} onClick={onEdit}>Edit</Button>
      <Button quiet id={`delete-${task.id}`} onClick={() => void run(() => focus.deleteTask(task.id))}>Delete</Button>
    </Row>
  </Row>
}, (a, b) => a.task === b.task && a.selected === b.selected)

export const TaskPanel = memo(function TaskPanel({ tasks, selected, run, onEdit, onNew }: { tasks: FocusTask[]; selected?: string; run: Run; onEdit: (task: FocusTask) => void; onNew: (title: string) => void }) {
  const data = { tasks, selectedTaskID: selected }
  const [draft, setDraft] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('today'), [confirmClear, setConfirmClear] = useState(false)
  const needle = query.trim().toLowerCase()
  const visible = sortTasks(data.tasks.filter(task => matches(task, filter) && (!needle || `${task.title}\n${task.notes}\n${task.projectName}\n${task.tags.join('\n')}`.toLowerCase().includes(needle))), data.selectedTaskID)
  const completed = data.tasks.filter(task => task.isCompleted).length
  async function add() {
    const title = draft.trim(); if (!title) return
    if (await run(() => focus.addTask({ title, notes: '', projectName: '', tags: [], priority: 'p3', dueDate: todayISO() }))) setDraft('')
  }
  const empty = !data.tasks.length ? 'No tasks yet.' : needle ? 'No matches.' : 'Nothing here.'
  return <Column style={{ gap: 12, flexGrow: 1, flexBasis: 0, height: '100%', minHeight: 0, minWidth: 0 }}>
    <Row style={{ gap: 8, flexShrink: 0 }}>
      <Field id="task-quick-add" value={draft} onChange={setDraft} onSubmit={() => void add()} placeholder="New task" />
      <Button id="task-quick-add-button" primary disabled={!draft.trim()} onClick={() => void add()}>+</Button>
      <Button id="task-new" onClick={() => { onNew(draft.trim()); setDraft('') }}>Details</Button>
    </Row>
    <Row style={{ gap: 6, flexShrink: 0, justifyContent: 'space-between' }}>
      <Row style={{ gap: 6 }}>{filters.map(([value, label]) => <div key={value} testId={`task-filter-${value}`} role="button" aria-label={label} tabIndex={0} onClick={() => { setFilter(value); setConfirmClear(false) }} style={{ display: 'flex', alignItems: 'center', height: 26, paddingLeft: 8, paddingRight: 8, borderWidth: filter === value ? 2 : 1, borderColor: filter === value ? C.text : '#333333', backgroundColor: filter === value ? C.text : C.bg, cursor: 'pointer' }}><text style={{ fontSize: 11, color: filter === value ? C.bg : C.muted }}>{label}</text></div>)}</Row>
      {completed > 0 ? confirmClear ? <Row style={{ gap: 0 }}><Button quiet id="task-clear-confirm" onClick={() => void run(() => focus.clearCompleted()).then(() => setConfirmClear(false))}>{`Delete ${completed} done`}</Button><Button quiet id="task-clear-cancel" onClick={() => setConfirmClear(false)}>Cancel</Button></Row> : <Button quiet id="task-clear-completed" onClick={() => setConfirmClear(true)}>Clear done</Button> : null}
    </Row>
    <Row style={{ gap: 0, flexShrink: 0 }}><Field id="task-search" value={query} onChange={setQuery} placeholder="Search tasks" />{query ? <Button quiet onClick={() => setQuery('')}>Clear</Button> : null}</Row>
    {visible.length === 0 ? <div style={{ paddingTop: 20, paddingBottom: 20 }}><Text muted>{empty}</Text></div>
      : <div testId="task-list-viewport" style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' }}><virtual-list testId="task-list" estimatedItemHeight={82} style={{ height: '100%', width: '100%' }}>
        {visible.map(task => <div key={task.id} style={{ paddingBottom: 12 }}><TaskRow task={task} selected={task.id === data.selectedTaskID} run={run} onEdit={() => onEdit(task)} /></div>)}
      </virtual-list></div>}
  </Column>
})

export interface EditorState { id?: string; title: string; notes: string; projectName: string; tags: string; priority: TaskPriority; hasDue: boolean; date: string; time: string }
export const newEditor = (title = ''): EditorState => ({ title, notes: '', projectName: '', tags: '', priority: 'p3', hasDue: true, date: dateField(todayISO()), time: '00:00' })
export const editEditor = (task: FocusTask): EditorState => ({ id: task.id, title: task.title, notes: task.notes, projectName: task.projectName, tags: task.tags.join(', '), priority: task.priority, hasDue: !!task.dueDate, date: dateField(task.dueDate ?? todayISO()), time: timeField(task.dueDate ?? todayISO()) })

export function TaskEditor({ value, onChange, onClose, run, data }: { value: EditorState; onChange: (update: (current: EditorState) => EditorState) => void; onClose: () => void; run: Run; data: FocusSnapshot }) {
  const [error, setError] = useState('')
  const ordered = [...data.tasks].sort((a, b) => a.orderIndex - b.orderIndex)
  const index = ordered.findIndex(task => task.id === value.id)
  async function save() {
    if (!value.title.trim()) return
    const dueDate = value.hasDue ? localDue(value.date, value.time) : undefined
    if (value.hasDue && !dueDate) { setError('Enter the due date as YYYY-MM-DD and the time as HH:MM.'); return }
    const draft: FocusTaskDraft = { title: value.title.trim(), notes: value.notes.trim(), projectName: value.projectName.trim(), tags: value.tags.split(',').map(tag => tag.trim()).filter(Boolean), priority: value.priority, ...dueDate ? { dueDate } : {} }
    if (await run(() => value.id ? focus.editTask(value.id, draft) : focus.addTask(draft))) onClose()
  }
  async function move(direction: -1 | 1) {
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    const ids = ordered.map(task => task.id); [ids[index], ids[target]] = [ids[target]!, ids[index]!]
    await run(() => focus.reorderTasks(ids))
  }
  return <div testId="task-editor" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000cc' }}>
    <div onMouseDownOutside={onClose} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 520, flexShrink: 0, padding: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.text }}>
      <text style={{ fontFamily: display, fontSize: 20, fontWeight: 700, color: C.text }}>{value.id ? 'EDIT TASK' : 'NEW TASK'}</text>
      <Stacked label="Title"><Field id="task-title" value={value.title} onChange={title => onChange(current => ({ ...current, title }))} placeholder="Title" autoFocus /></Stacked>
      <Row style={{ alignItems: 'flex-start' }}>
        <Labeled label="Project"><Field id="task-project" value={value.projectName} onChange={projectName => onChange(current => ({ ...current, projectName }))} placeholder="Project" /></Labeled>
        <Labeled label="Tags"><Field id="task-tags" value={value.tags} onChange={tags => onChange(current => ({ ...current, tags }))} placeholder="design, focus, work" /></Labeled>
      </Row>
      <Row style={{ alignItems: 'flex-end' }}>
        <Labeled label="Priority"><Choice id="task-priority" width={228} value={value.priority} items={(['p1', 'p2', 'p3', 'p4'] as const).map(item => ({ value: item, label: `${item.toUpperCase()} · ${priorityName[item]}` }))} onChange={priority => onChange(current => ({ ...current, priority: priority === 'p1' || priority === 'p2' || priority === 'p4' ? priority : 'p3' }))} /></Labeled>
        <div style={{ display: 'flex', alignItems: 'center', height: space.control, flexGrow: 1, flexBasis: 0 }}><Check id="task-has-due" label="Has due date" checked={value.hasDue} onChange={hasDue => onChange(current => ({ ...current, hasDue }))} /></div>
      </Row>
      {value.hasDue ? <Row><Labeled label="Due date"><Field id="task-due" value={value.date} onChange={date => onChange(current => ({ ...current, date }))} placeholder="YYYY-MM-DD" /></Labeled><Labeled label="Time"><Field id="task-due-time" value={value.time} onChange={time => onChange(current => ({ ...current, time }))} placeholder="HH:MM" /></Labeled></Row> : null}
      <Stacked label="Notes"><Field id="task-notes" value={value.notes} onChange={notes => onChange(current => ({ ...current, notes }))} multiline height={84} placeholder="Notes" /></Stacked>
      <ErrorText message={error} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 0 }}>{value.id ? <><Button quiet id="task-move-up" disabled={index <= 0} onClick={() => void move(-1)}>Move up</Button><Button quiet id="task-move-down" disabled={index === ordered.length - 1} onClick={() => void move(1)}>Move down</Button><Button quiet id="task-delete" onClick={() => void run(() => focus.deleteTask(value.id!)).then(result => { if (result) onClose() })}>Delete</Button></> : null}</Row>
        <Row><Button id="task-cancel" onClick={onClose}>Cancel</Button><Button id="task-save" primary disabled={!value.title.trim()} onClick={() => void save()}>Save task</Button></Row>
      </Row>
    </div>
  </div>
}

// One bitmap instead of hundreds of cells: GPUI rebuilds every element on every frame, so 371 divs cost more than the whole page.
const levels: [number, number, number][] = [[10, 10, 10], [38, 38, 38], [77, 77, 77], [140, 140, 140], [255, 255, 255]]
const cell = 10, gap = 2, scale = 2
export const ActivityGraph = memo(function ActivityGraph({ sessions, width }: { sessions: FocusSnapshot['sessionHistory']; width: number }) {
  const weeks = Math.max(1, Math.floor((width - 18) / (cell + gap)))
  const image = useRef<ImgInstance | null>(null)
  const [hovered, setHovered] = useState<{ date: Date; count: number } | null>(null)
  const { renderer } = useGpuix()
  const model = useMemo(() => {
    const counts = new Map<number, number>()
    for (const session of sessions) if (session.phase === 'work') { const key = startOfDay(new Date(session.finishedAt)).getTime(); counts.set(key, (counts.get(key) ?? 0) + 1) }
    const today = startOfDay(new Date())
    const end = new Date(today); end.setDate(end.getDate() + (6 - end.getDay()))
    const dayAt = (week: number, day: number) => { const date = new Date(end); date.setDate(end.getDate() - ((weeks - 1 - week) * 7 + (6 - day))); return date }
    const first = dayAt(0, 0).getTime()
    const max = Math.max(1, ...[...counts.entries()].filter(([key]) => key >= first).map(([, value]) => value))
    return { counts, today, dayAt, max }
  }, [sessions, weeks])
  const pixelWidth = (weeks * (cell + gap) - gap) * scale, pixelHeight = (7 * (cell + gap) - gap) * scale
  useLayoutEffect(() => {
    const pixels = new Uint8Array(pixelWidth * pixelHeight * 4)
    for (let week = 0; week < weeks; week++) for (let day = 0; day < 7; day++) {
      const date = model.dayAt(week, day)
      if (date > model.today) continue
      const count = model.counts.get(date.getTime()) ?? 0, ratio = count / model.max
      const [r, g, b] = levels[!count ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1]!
      const x0 = week * (cell + gap) * scale, y0 = day * (cell + gap) * scale
      for (let y = y0; y < y0 + cell * scale; y++) for (let x = x0; x < x0 + cell * scale; x++) {
        const index = (y * pixelWidth + x) * 4
        pixels[index] = r; pixels[index + 1] = g; pixels[index + 2] = b; pixels[index + 3] = 255
      }
    }
    image.current?.setImagePixels(pixelWidth, pixelHeight, pixels)
  }, [model, pixelWidth, pixelHeight, weeks])
  const summary = useMemo(() => stats({ sessionHistory: sessions } as FocusSnapshot), [sessions])
  function hover(x: number, y: number) {
    const box = image.current ? renderer?.getElementBounds?.(image.current.id) : null
    if (!box) return
    const week = Math.floor((x - box.x) / (cell + gap)), day = Math.floor((y - box.y) / (cell + gap))
    if (week < 0 || week >= weeks || day < 0 || day > 6) { setHovered(null); return }
    const date = model.dayAt(week, day)
    setHovered(previous => previous?.date.getTime() === date.getTime() ? previous : date > model.today ? null : { date, count: model.counts.get(date.getTime()) ?? 0 })
  }
  return <Column testId="focus-activity" style={{ gap: 8, flexShrink: 0 }}>
    <Row style={{ justifyContent: 'space-between' }}>
      <Text muted size={11}>Activity</Text>
      <Text muted size={11}>{hovered ? `${hovered.count} ${hovered.count === 1 ? 'session' : 'sessions'} · ${shortDate(hovered.date)}` : `${summary.streak > 0 ? `${summary.streak}d streak · ` : ''}${summary.minutes}m · ${summary.sessions} sessions this week`}</Text>
    </Row>
    <Row testId="activity-graph" style={{ gap: 2, alignItems: 'flex-start' }}>
      <Column style={{ gap: 2, width: 16, flexShrink: 0 }}>{['', 'M', '', 'W', '', 'F', ''].map((label, index) => <div key={index} style={{ height: 10, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}><text style={{ fontSize: 7, color: '#555555' }}>{label}</text></div>)}</Column>
      <div onMouseMove={event => hover(event.x ?? -1, event.y ?? -1)} onMouseLeave={() => setHovered(null)} style={{ width: pixelWidth / scale, height: pixelHeight / scale, flexShrink: 0 }}>
        <img ref={image} src="" style={{ width: pixelWidth / scale, height: pixelHeight / scale }} />
      </div>
    </Row>
  </Column>
})

const frames = Array.from({ length: 16 }, (_, index) => resolve(process.execPath.includes('.app/Contents/MacOS/') ? resolve(dirname(process.execPath), '../Resources/ducky') : resolve(import.meta.dir, '../assets/ducky'), `frame-${String(index).padStart(2, '0')}.png`))
interface Duck { id: number; seed: number; drift: number; shift: number; opacity: number; lift: number; burst?: { at: number; x: number; y: number } }
const sprite = 45, lane = 38, inset = 10
function makeDuck(id: number, seed: number): Duck { return { id, seed, drift: 10 + (seed % 4) * 1.35, shift: seed * 1.7, opacity: Math.max(0.42, 1 - seed * 0.08), lift: (seed % 2) * 4 } }
/** NotchFlow's swim lane: ducks drift across, a click pops one, and More ducks adds up to eight. */
export const Ducks = memo(function Ducks({ active, width }: { active: boolean; width: number }) {
  const [ducks, setDucks] = useState<Duck[]>(() => [makeDuck(0, 0)])
  const [time, setTime] = useState(0)
  const seed = useRef(1)
  useEffect(() => {
    if (!active) return
    const started = performance.now() / 1000 - time
    const timer = setInterval(() => setTime(performance.now() / 1000 - started), 1000 / 12)
    return () => clearInterval(timer)
  }, [active])
  const travel = Math.max(width - sprite - inset * 2, 0)
  const frame = frames[Math.floor(time * 12) % frames.length]!
  const position = (duck: Duck) => ({ x: inset + travel * (((time + duck.shift) % duck.drift) / duck.drift), y: Math.max(Math.max(lane - sprite - duck.lift, 0) + Math.sin((time + duck.shift) * 3.2) * 1.8, 0) })
  return <div testId="ducks" style={{ position: 'relative', height: lane, width: '100%', flexShrink: 0 }}>
    {ducks.map(duck => {
      const { x, y } = duck.burst ?? position(duck)
      if (duck.burst) return <motion.div key={duck.id} initial={{ opacity: 1, width: sprite, height: sprite, left: x, top: y }} animate={{ opacity: 0, width: sprite * 1.9, height: sprite * 1.9, left: x - sprite * 0.45, top: y - sprite * 0.45 }} transition={{ duration: 0.4, ease: 'easeOut' }} style={{ position: 'absolute', borderRadius: 999, backgroundColor: '#ffd92e' }} />
      return <div key={duck.id} testId={`duck-${duck.id}`} role="button" aria-label="Pop duck" onClick={() => { setDucks(previous => previous.map(item => item.id === duck.id ? { ...item, burst: { at: time, x, y } } : item)); setTimeout(() => setDucks(previous => previous.filter(item => item.id !== duck.id)), 420) }} style={{ position: 'absolute', left: x, top: y, width: sprite, height: sprite, cursor: 'pointer', opacity: duck.opacity }}><img src={frame} style={{ width: sprite, height: sprite }} /></div>
    })}
    <div style={{ position: 'absolute', right: 2, bottom: 2 }}><Button quiet id="more-ducks" disabled={ducks.length >= 8} onClick={() => setDucks(previous => previous.length >= 8 ? previous : [...previous, makeDuck(seed.current, seed.current++)])}>{ducks.length >= 8 ? 'Max ducks' : 'More ducks'}</Button></div>
  </div>
})

export function CheckInButton({ data, onOpen }: { data: FocusSnapshot; onOpen: () => void }) {
  const entry = todayCheckIn(data)
  return <div testId="checkin-button" role="button" aria-label="Daily check-in" tabIndex={0} onClick={onOpen} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 30, flexShrink: 0, borderWidth: entry ? 2 : 1, borderColor: entry ? '#999999' : '#333333', cursor: 'pointer', hover: { borderColor: C.text } }}>
    <text style={{ fontSize: 16, fontWeight: 700, color: entry ? C.text : '#8c8c8c' }}>{entry ? moods[entry.mood - 1]?.symbol ?? ':)' : ':)'}</text>
  </div>
}

export function CheckInPopover({ data, run, onClose }: { data: FocusSnapshot; run: Run; onClose: () => void }) {
  const existing = todayCheckIn(data)
  const [mood, setMood] = useState<FocusCheckIn['mood']>(existing?.mood ?? 3), [text, setText] = useState(existing?.text ?? '')
  return <div onMouseDownOutside={onClose} testId="checkin-popover" style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 360, padding: 16, backgroundColor: C.bg, borderWidth: 1, borderColor: C.text }}>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Column style={{ gap: 4 }}><Text muted size={11}>Daily check-in</Text><text style={{ fontFamily: display, fontSize: 18, fontWeight: 700, color: C.text }}>{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</text></Column>
      <Button quiet id="checkin-close" onClick={onClose}>Close</Button>
    </Row>
    <Row style={{ gap: 8 }}>{moods.map((item, index) => { const value = (index + 1) as FocusCheckIn['mood'], on = mood === value; return <div key={item.title} testId={`checkin-mood-${value}`} role="button" aria-label={item.title} tabIndex={0} onClick={() => setMood(value)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, flexGrow: 1, flexBasis: 0, height: 58, borderWidth: on ? 2 : 1, borderColor: on ? C.text : '#333333', backgroundColor: on ? C.text : C.bg, cursor: 'pointer' }}>
      <text style={{ fontSize: on ? 20 : 15, fontWeight: 700, color: on ? C.bg : '#999999' }}>{item.symbol}</text>
      <text style={{ fontSize: 8, color: on ? C.bg : '#999999' }}>{item.title.toUpperCase()}</text>
    </div> })}</Row>
    <Stacked label="Gratitude"><Field id="checkin-text" value={text} onChange={setText} multiline height={118} placeholder="One thing you're grateful for" /></Stacked>
    <Row><Button id="checkin-save" primary onClick={() => void run(() => focus.checkIn(startOfDay(new Date()).toISOString(), mood, text)).then(result => { if (result) onClose() })}>Save</Button><Button id="checkin-cancel" onClick={onClose}>Cancel</Button></Row>
  </div>
}

export const runFocus: Run = async work => { try { return await focusService.run(work) } catch { return null } }
export { space }

export const notchPin = { pinned: false }
/** The panel that drops from the notch: tasks on the left, timer on the right, activity and ducks below, as in NotchFlow. */
export function FocusPanel({ onExpand, onSettings, width }: { onExpand: () => void; onSettings: () => void; width: number }) {
  const [state, setState] = useState(focusService.getSnapshot())
  const [editor, setEditor] = useState<EditorState | null>(null), [checkIn, setCheckIn] = useState(false)
  useEffect(() => { focusService.start(); return focusService.subscribe(() => setState(focusService.getSnapshot())) }, [])
  useEffect(() => { notchPin.pinned = !!editor || checkIn; return () => { notchPin.pinned = false } }, [editor, checkIn])
  const openEditor = useCallback((task: FocusTask) => setEditor(editEditor(task)), [])
  const openNew = useCallback((title: string) => setEditor(newEditor(title)), [])
  const data = state.data
  if (!data) return <div style={{ width: '100%', height: '100%', backgroundColor: C.bg }} />
  const rightWidth = Math.min(Math.max(width * 0.38, 340), 420)
  const open = data.tasks.filter(task => !task.isCompleted).length
  return <div testId="focus-panel" style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%', paddingTop: 16, paddingBottom: 4, paddingLeft: 20, paddingRight: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: '#262626' }}>
    <Row style={{ justifyContent: 'space-between', flexShrink: 0, height: 32 }}>
      <Row style={{ flexBasis: 0, flexGrow: 1 }}><text style={{ fontFamily: display, fontSize: 16, fontWeight: 700, color: C.text }}>FOCUS</text></Row>
      <CheckInButton data={data} onOpen={() => setCheckIn(true)} />
      <Row style={{ flexBasis: 0, flexGrow: 1, justifyContent: 'flex-end', gap: 8 }}>
        <Text muted size={11}>{`${open} open`}</Text>
        <Button quiet id="panel-settings" onClick={onSettings}>Settings</Button>
        <Button quiet id="panel-expand" onClick={onExpand}>Open BuddyMac</Button>
      </Row>
    </Row>
    <ErrorText message={state.error || state.alertError} />
    <Row style={{ alignItems: 'flex-start', gap: 24, paddingTop: 10, flexGrow: 1, minHeight: 0 }}>
      <TaskPanel tasks={data.tasks} selected={data.selectedTaskID} run={runFocus} onEdit={openEditor} onNew={openNew} />
      <div style={{ width: rightWidth, flexShrink: 0 }}><TimerSection data={data} run={runFocus} /></div>
    </Row>
    <div style={{ height: 1, backgroundColor: '#262626', flexShrink: 0, marginTop: 16, marginBottom: 12 }} />
    <ActivityGraph sessions={data.sessionHistory} width={width - 40} />
    <div style={{ height: 10, flexShrink: 0 }} />
    <Ducks active width={width - 40} />
    {editor ? <TaskEditor value={editor} onChange={update => setEditor(current => current && update(current))} onClose={() => setEditor(null)} run={runFocus} data={data} /> : null}
    {checkIn ? <div style={{ position: 'absolute', top: 52, left: Math.max(20, width / 2 - 180) }}><CheckInPopover data={data} run={runFocus} onClose={() => setCheckIn(false)} /></div> : null}
  </div>
}
