import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

const NOW = new Date(2026, 9, 4, 12, 0).getTime()

/** The test's clock, set by `start`. */
let clock: MockClock
/** The tools the mod has offered the model, by short name, set by `start`. */
let registered: string[] = []
/** How many times the transcript scan listed a folder, set by `start`. */
let scans = 0

const PREVIOUS = {
  fiveHour: { percentUsed: 40 },
  threadUsd: 12.4,
  lastTurnUsd: 0.83,
  context: { window: 200_000, tokens: 120_000, percent: 61 },
}

function band() {
  return {
    plugin: 'aitools',
    surface: 'desktop' as const,
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }
}

/** The handoff pane's props as a docked desktop pane receives them. */
const PANE = {
  title: 'Handoff brief',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** Answers the band as core does when no plugin beneath draws it: its own drawing, by ref. */
function coreBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
}

type Row = { role: 'user' | 'assistant'; text: string; toolUses: never[]; toolResults?: never[] }

type Step = { agentId?: string; model: string; effort?: unknown }

/** Panes as the engine keeps them: every id opened, in order, the ones open now, and whether they are on screen. */
type Panes = { opened: string[]; open: Set<string>; isPlaced: boolean }

/** Answers `$.ui.open`, `$.ui.close` and `$.ui.panes` as the engine would; panes are on screen unless `isPlaced` is off. */
function mockPanes(on: On): Panes {
  const panes: Panes = { opened: [], open: new Set(), isPlaced: true }
  on('ui.open', (_, e) => {
    panes.opened.push(e.id)
    panes.open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    panes.open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...panes.open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: panes.isPlaced })),
  }))

  return panes
}

/**
 * Starts a session whose `$.session.usage()` reports `cost.usd` as `costs.usd` and whose history is `messages`;
 * `steps` collects each model request's agent, model and effort as the bottom sends it. Returns its panes.
 */
async function start(
  $: Engine,
  on: On,
  costs: { usd: number },
  stored: Record<string, unknown> = {},
  messages: Row[] = [],
  steps: Step[] = [],
) {
  mock.store(on, { lastSnapshot: PREVIOUS, ...stored })
  clock = mock.clock(on, { now: NOW })
  coreBand(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  registered = []
  scans = 0
  on('tool.register', (_, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__aitools__${e.name}` } }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/test' : undefined }))
  on('fs.list', () => {
    scans += 1
    return { value: [] }
  })
  on('session.messages', () => ({ value: messages }))
  const panes = mockPanes(on)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.surfaces', () => ({ value: ['desktop' as const] }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [], cost: { usd: costs.usd } } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    steps.push({ agentId: e.agentId, model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })

  return panes
}

async function step($: Engine, agentId?: string) {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId })) {
    // drain
  }
}

function complete(turnId: string, agentId?: string) {
  return { reason: 'answer' as const, text: '', answer: '', durationMs: 1, isAborted: false, turnId, agentId }
}

async function barText($: Engine): Promise<string> {
  const ui = await $.ui.mount(band())
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  await ui.unmount()

  return text
}

describe('wiring', () => {
  test('a new session keeps last limits but not last thread cost or context', async ($, on) => {
    await start($, on, { usd: 0 })
    const text = await barText($)
    expect(text).toContain('5h 40%')
    expect(text).toContain('thread $0.00')
    expect(text).not.toContain('12.40')
    expect(text).not.toContain('0.83')
    expect(text).toContain('ctx —')
  })

  test('last-turn cost spans the main turn, ignoring subagent turns', async ($, on) => {
    const costs = { usd: 1 }
    await start($, on, costs)
    await $.turn.start({ text: 'go', turnId: 't1' })
    costs.usd = 2.5
    await $.turn.complete(complete('s1', 'sub'))
    expect(await barText($)).not.toContain('(+')
    costs.usd = 3
    await $.turn.complete(complete('t1'))
    expect(await barText($)).toContain('thread $3.00 (+$2.00)')
  })

  test('no last-turn cost without a turn start baseline', async ($, on) => {
    const costs = { usd: 2 }
    await start($, on, costs)
    await $.turn.complete(complete('unknown'))
    const text = await barText($)
    expect(text).toContain('thread $2.00')
    expect(text).not.toContain('(+')
  })

  test('a main-thread request starts the cache countdown', async ($, on) => {
    await start($, on, { usd: 0 })
    expect(await barText($)).toContain('cache —')
    await step($)
    expect(await barText($)).toContain('cache 60m')
  })

  test('subagent requests leave the cache countdown alone', async ($, on) => {
    await start($, on, { usd: 0 })
    await step($, 'sub')
    expect(await barText($)).toContain('cache —')
  })

  test('a reload of the same session keeps thread and last-turn cost', async ($, on) => {
    const costs = { usd: 1 }
    await start($, on, costs)
    await $.turn.start({ text: 'go', turnId: 't1' })
    costs.usd = 3
    await $.turn.complete(complete('t1'))
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    expect(await barText($)).toContain('thread $3.00 (+$2.00)')
  })

  test("the last turn's tokens show on the bar once it completes", async ($, on) => {
    await start($, on, { usd: 0 })
    const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
    await $.turn.complete({ ...complete('t1'), usage: { ...usage, model: 'claude-opus-5-5' } })
    expect(await barText($)).toContain('tok — (+12k)')
  })

  test('/handoff prints the brief to the chat and copies it, writing no file', async ($, on) => {
    const brief = '## Goal\nShip aitools\n\n## Next step\nMerge'
    const writes: string[] = []
    const copies: string[] = []
    on('model.fork', () => ({
      value: { isAnswered: true, text: brief, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('fs.write', (_, e) => {
      writes.push(e.path)
      return { value: undefined }
    })
    on('ui.copy', (_, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    await start($, on, { usd: 0 })
    const result = await $.command.run({
      command: 'handoff',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
    expect(result.text).toBe(`Handoff brief\n\n${brief}`)
    expect(copies).toEqual([brief])
    expect(writes).toEqual([])
  })

  test("the tools menu's Handoff shows the brief in a pane with a Copy button, copying nothing by itself", async ($, on) => {
    const brief = '## Goal\nShip aitools\n\n## Next step\nMerge'
    const copies: string[] = []
    on('model.fork', () => ({
      value: { isAnswered: true, text: brief, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('ui.copy', (_, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    const { opened } = await start($, on, { usd: 0 })
    const ui = await $.ui.mount(band())
    await ui.press({ key: 'tools' })
    await ui.press({ key: 'handoff' })
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
    await ui.unmount()
    expect(opened).toEqual(['handoff'])
    expect(copies).toEqual([])

    const pane = await $.ui.mount({ plugin: 'aitools', surface: 'desktop', component: 'Pane', requestId: 'handoff', props: PANE })
    expect(await pane.find({ type: 'Markdown' })).toBeDefined()
    await pane.press({ key: 'copy' })
    await pane.unmount()
    expect(copies).toEqual([brief])
  })

  test("the tools menu's Workflows runs /workflows itself", async ($, on) => {
    const fills: string[] = []
    const commands: string[] = []
    on('prompt.fill', (_, e) => {
      fills.push(e.text)
      return { isFilled: true, text: e.text }
    })
    on('command.run', (_, e) => {
      commands.push(e.command)
      return {}
    })
    on('command.list', () => ({ value: [{ name: 'workflows', description: 'Workflows', source: 'builtin' as const }] }))
    await start($, on, { usd: 0 })
    const ui = await $.ui.mount(band())
    await ui.press({ key: 'tools' })
    await ui.press({ key: 'workflows' })
    expect(await ui.find({ key: 'workflows' })).toBeUndefined()
    await ui.unmount()
    expect(commands).toEqual(['workflows'])
    expect(fills).toEqual([])
  })

  test("the tools menu's Workflows stages /workflows in the prompt box when the engine has no such command", async ($, on) => {
    const commands: string[] = []
    const fills: string[] = []
    const toasts: string[] = []
    on('prompt.fill', (_, e) => {
      fills.push(e.text)
      return { isFilled: true, text: e.text }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('command.run', (_, e) => {
      commands.push(e.command)
      return {}
    })
    on('command.list', () => ({ value: [] }))
    await start($, on, { usd: 0 })
    const ui = await $.ui.mount(band())
    await ui.press({ key: 'tools' })
    await ui.press({ key: 'workflows' })
    await ui.unmount()
    expect(commands).toEqual([])
    expect(fills).toEqual(['/workflows'])
    expect(toasts).toEqual([])
  })

  describe('Task View and Clean View', () => {
    const CHECKLIST = 'mcp__aitools__checklist'
    const PLAN = {
      title: 'Dark mode',
      items: [
        { text: 'Read the theme', status: 'done' },
        { text: 'Add the tokens', status: 'doing', percent: 40 },
        { text: 'Run the checks', status: 'todo' },
      ],
    }

    /** Draws a transcript component as core would beneath the plugin, so a pass-through shows as the engine's. */
    function coreRows(on: On) {
      on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine' as const, ref: 0 }))
      on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine' as const, ref: 0 }))
    }

    function toolRow(tool: string) {
      return {
        plugin: 'aitools',
        surface: 'desktop' as const,
        component: 'ToolUse' as const,
        props: { tool_use_id: 't-1', tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false },
      }
    }

    function reply(text: string) {
      return { plugin: 'aitools', surface: 'desktop' as const, component: 'AssistantMessage' as const, props: { text, isFirstOfReply: true } }
    }

    async function isRowHidden($: Engine, target: Parameters<Engine['ui']['mount']>[0]): Promise<boolean> {
      const ui = await $.ui.mount(target)
      const isHidden = (await ui.find({ key: 'aitools-hidden' })) !== undefined
      await ui.unmount()

      return isHidden
    }

    async function pickView($: Engine, key: 'task' | 'clean') {
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      await ui.press({ key })
      await ui.unmount()
    }

    test('the 🛠 menu marks the view that is on with ●, and the other view replaces it', async ($, on) => {
      await start($, on, { usd: 0 })
      await pickView($, 'task')
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'task' }))?.text).toBe('● Task View')
      expect((await ui.find({ key: 'clean' }))?.text).toBe('○ Clean View')
      await ui.press({ key: 'clean' })
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'clean' }))?.text).toBe('● Clean View')
      await ui.press({ key: 'clean' })
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'clean' }))?.text).toBe('○ Clean View')
      await ui.unmount()
    })

    test('/taskview and /cleanview toggle the views and say which is on', async ($, on) => {
      const run = (command: string, args = '') =>
        $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
      await start($, on, { usd: 0 })
      expect((await run('taskview')).text).toBe('Task View on.')
      expect((await run('cleanview')).text).toBe('Clean View on.')
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'clean' }))?.text).toBe('● Clean View')
      expect((await ui.find({ key: 'task' }))?.text).toBe('○ Task View')
      await ui.unmount()
      expect((await run('cleanview')).text).toBe('Clean View off.')
      expect((await run('taskview', 'on')).text).toBe('Task View on.')
      expect((await run('taskview', 'off')).text).toBe('Task View off.')
      expect((await run('taskview', 'bogus')).text).toBe('Usage: /taskview [on|off] (no argument toggles Task View)')
    })

    test('the status line names the view that is on and clears when both are off', async ($, on) => {
      const statuses: (string | undefined)[] = []
      on('ui.status', (_, e) => {
        statuses.push(e.text)
        return { value: undefined }
      })
      await start($, on, { usd: 0 }, { viewMode: 'task' })
      await pickView($, 'clean')
      await pickView($, 'clean')
      expect(statuses).toEqual(['Task View', 'Clean View', undefined])
    })

    test('a saved view comes back in a new session', async ($, on) => {
      await start($, on, { usd: 0 }, { viewMode: 'clean' })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'clean' }))?.text).toBe('● Clean View')
      await ui.unmount()
    })

    test('a view adds the checklist note to each prompt; off adds none', async ($, on) => {
      const contexts: (readonly string[] | undefined)[] = []
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      await start($, on, { usd: 0 })
      await $.prompt.submit({ text: 'before', wait: false, origin: { kind: 'composer' } })
      await pickView($, 'clean')
      await $.prompt.submit({ text: 'after', wait: false, origin: { kind: 'composer' } })
      expect(contexts[0]).toBeUndefined()
      expect(contexts[1]?.[0]).toContain('Clean View is on')
    })

    test('the checklist tool draws the plan above the bar and refuses a malformed one', async ($, on) => {
      await start($, on, { usd: 0 })
      await pickView($, 'task')
      const bad = await $.tool.call({ tool: CHECKLIST, title: '', items: [] })
      expect(bad.deny).toContain('title must be a non-empty string')
      const ok = await $.tool.call({ tool: CHECKLIST, ...PLAN })
      expect(ok.result).toBe('Checklist updated.')
      const text = await barText($)
      expect(text).toContain('Dark mode')
      expect(text).toContain('1 of 3')
      expect(text).toContain('● Add the tokens 40% ▰▰▰▰▱▱▱▱▱▱')
      expect(text).toContain('○ Run the checks  0% ▱▱▱▱▱▱▱▱▱▱')
      expect(text).toContain('✓ Read the theme100% ▰▰▰▰▰▰▰▰▰▰')
    })

    test('the checklist sits below the bar with green, blue and dim marks', async ($, on) => {
      await start($, on, { usd: 0 })
      await pickView($, 'task')
      await $.tool.call({ tool: CHECKLIST, ...PLAN })
      const text = await barText($)
      expect(text.indexOf('AI Tools')).toBeLessThan(text.indexOf('Dark mode'))
      const ui = await $.ui.mount(band())
      const texts = await ui.findAll({ type: 'Text' })
      await ui.unmount()
      const marks = texts.filter(t => ['✓ ', '● ', '○ '].includes(t.text))
      expect(marks.map(m => [m.text, m.props.color ?? null, m.props.dimColor ?? false])).toEqual([
        ['✓ ', '#6fbe49', false],
        ['● ', '#478487', false],
        ['○ ', null, true],
      ])
      const doing = texts.find(t => t.text === 'Add the tokens')
      expect([doing?.props.color, doing?.props.bold ?? false, doing?.props.dimColor ?? false]).toEqual(['#b0b0b0', false, false])
      const fills = texts.filter(t => /^▰+$/.test(t.text))
      expect(fills.map(f => [f.text, f.props.color ?? null])).toEqual([
        ['▰▰▰▰▰▰▰▰▰▰', '#6fbe49'],
        ['▰▰▰▰', '#478487'],
      ])
    })

    test('a finished checklist folds to one line', async ($, on) => {
      await start($, on, { usd: 0 })
      await pickView($, 'task')
      await $.tool.call({ tool: CHECKLIST, ...PLAN, items: PLAN.items.map(i => ({ ...i, status: 'done' })) })
      const text = await barText($)
      expect(text).toContain('✓ Done: Dark mode (3 steps)')
      expect(text).not.toContain('Read the theme')
    })

    test('the × at the end of the Done line closes it', async ($, on) => {
      await start($, on, { usd: 0 })
      await pickView($, 'task')
      await $.tool.call({ tool: CHECKLIST, ...PLAN, items: PLAN.items.map(i => ({ ...i, status: 'done' })) })
      const ui = await $.ui.mount(band())
      expect((await ui.find({ key: 'checklist-close' }))?.text).toBe('×')
      await ui.press({ key: 'checklist-close' })
      expect(await ui.find({ text: /Done: Dark mode/ })).toBeUndefined()
      expect(await ui.find({ key: 'checklist-close' })).toBeUndefined()
      await ui.unmount()
    })

    test('Task View hides only the checklist tool row; Clean View hides every tool row', async ($, on) => {
      coreRows(on)
      await start($, on, { usd: 0 })
      await pickView($, 'task')
      expect(await isRowHidden($, toolRow(CHECKLIST))).toBe(true)
      expect(await isRowHidden($, toolRow('Bash'))).toBe(false)
      expect(await isRowHidden($, reply('Let me look.'))).toBe(false)
      await pickView($, 'clean')
      expect(await isRowHidden($, toolRow('Bash'))).toBe(true)
    })

    test("Clean View hides replies until they are part of a finished turn's final answer", async ($, on) => {
      coreRows(on)
      await start($, on, { usd: 0 })
      await pickView($, 'clean')
      expect(await isRowHidden($, reply('Let me read the theme first.'))).toBe(true)
      expect(await isRowHidden($, reply('Dark mode is in.'))).toBe(true)
      await $.turn.complete({ ...complete('t1'), answer: 'Dark mode is in.' })
      expect(await isRowHidden($, reply('Dark mode is in.'))).toBe(false)
      expect(await isRowHidden($, reply('Let me read the theme first.'))).toBe(true)
    })

    test('Clean View shows final replies of turns that ended before the mod loaded', async ($, on) => {
      coreRows(on)
      await start($, on, { usd: 0 }, { viewMode: 'clean' }, [
        { role: 'user', text: 'Add dark mode', toolUses: [] },
        { role: 'assistant', text: 'Let me look.', toolUses: [] },
        { role: 'user', text: '', toolUses: [], toolResults: [] },
        { role: 'assistant', text: 'Dark mode is in.', toolUses: [] },
      ])
      expect(await isRowHidden($, reply('Dark mode is in.'))).toBe(false)
      expect(await isRowHidden($, reply('Let me look.'))).toBe(true)
    })
  })

  describe('Agent Dock', () => {
    const run = (on$: Engine, command: string) =>
      on$.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

    /** Answers a spawn as core does beneath the plugin, recording what reached it. */
    function coreSpawn(on: On, seen: { model?: string; prompt: string }[]) {
      let n = 0
      on('agent.spawn', (_, e) => {
        seen.push({ model: e.model, prompt: e.prompt })
        n += 1
        return { model: e.model ?? 'parent', agentId: `agent-${n}` }
      })
    }

    const DOCK = { plugin: 'aitools', surface: 'desktop' as const, component: 'Pane' as const, props: PANE }

    async function dockText($: Engine): Promise<string> {
      const pane = await $.ui.mount({ ...DOCK, requestId: 'agentdock' })
      const text = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('')
      await pane.unmount()

      return text
    }

    let spawned = 0

    /** Starts a helper the way the Agent tool would, every field the engine fills given. */
    function spawn($: Engine, description: string, prompt = description) {
      spawned += 1
      return $.agent.spawn({
        tool_use_id: `call-${spawned}`,
        prompt,
        description,
        subagentType: 'general-purpose',
        provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'claude-opus-5-5',
        background: true,
        fork: false,
      })
    }

    test('/agentdock opens the dock pane; the team and helper picks show with a warning past 10', async ($, on) => {
      const panes = await start($, on, { usd: 0 })
      expect((await run($, 'agentdock')).text).toBe('Agent Dock open: 5 Same as chat helpers.')
      expect(panes.open.has('agentdock')).toBe(true)
      const ui = await $.ui.mount({ ...DOCK, requestId: 'agentdock' })
      expect((await ui.find({ key: 'team-5' }))?.text).toBe('● 5')
      expect((await ui.find({ key: 'helpers-same' }))?.text).toBe('● Same as chat')
      const order = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('helpers-'))
      expect(order).toEqual(['helpers-same', 'helpers-fast'])
      expect(await ui.find({ text: /uses your Claude usage much faster/ })).toBeUndefined()
      await ui.press({ key: 'team-20' })
      await ui.press({ key: 'helpers-fast' })
      expect((await ui.find({ key: 'team-20' }))?.text).toBe('● 20')
      expect((await ui.find({ key: 'helpers-fast' }))?.text).toBe('● Fast & cheap')
      expect(await ui.find({ text: '⚠ A team of 20 uses your Claude usage much faster.' })).toBeDefined()
      await ui.unmount()
      expect((await run($, 'agentdock')).text).toBe('Agent Dock closed.')
      expect(panes.open.has('agentdock')).toBe(false)
      expect((await run($, 'agentdock')).text).toBe('Agent Dock open: 20 Fast & cheap helpers.')
    })

    test('the 🛠 menu opens and closes the dock, marking it ● while open', async ($, on) => {
      const panes = await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'agentdock' }))?.text).toBe('○ Agent Dock')
      await ui.press({ key: 'agentdock' })
      expect(panes.open.has('agentdock')).toBe(true)
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'agentdock' }))?.text).toBe('● Agent Dock')
      await ui.press({ key: 'agentdock' })
      await ui.unmount()
      expect(panes.open.has('agentdock')).toBe(false)
    })

    test('a dock whose pane is gone turns off: no note goes with the next prompt', async ($, on) => {
      const contexts: (readonly string[] | undefined)[] = []
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      const panes = await start($, on, { usd: 0 })
      await run($, 'agentdock')
      panes.open.delete('agentdock')
      await $.prompt.submit({ text: 'after closing', wait: false, origin: { kind: 'composer' } })
      expect(contexts).toEqual([undefined])
      expect((await run($, 'agentdock')).text).toContain('Agent Dock open')
    })

    test('the status line adds Agent Dock beside the view while the dock is open', async ($, on) => {
      const statuses: (string | undefined)[] = []
      on('ui.status', (_, e) => {
        statuses.push(e.text)
        return { value: undefined }
      })
      await start($, on, { usd: 0 }, { viewMode: 'task' })
      await run($, 'agentdock')
      await run($, 'taskview')
      await run($, 'agentdock')
      expect(statuses).toEqual(['Task View', 'Task View, Agent Dock', 'Agent Dock', undefined])
    })

    test('the dock labels read Team size: and Helpers:', async ($, on) => {
      await start($, on, { usd: 0 })
      await run($, 'agentdock')
      const text = await dockText($)
      expect(text).toContain('Team size:')
      expect(text).toContain('Helpers:')
    })

    test('saved team and helper picks come back, but the dock starts closed', async ($, on) => {
      const panes = await start($, on, { usd: 0 }, { agentTeam: 3, agentHelpers: 'same' })
      expect(panes.opened).toEqual([])
      expect((await run($, 'agentdock')).text).toBe('Agent Dock open: 3 Same as chat helpers.')
    })

    test('the dock note goes with prompts only while the dock is open', async ($, on) => {
      const contexts: (readonly string[] | undefined)[] = []
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      await start($, on, { usd: 0 })
      await $.prompt.submit({ text: 'before', wait: false, origin: { kind: 'composer' } })
      await run($, 'agentdock')
      await $.prompt.submit({ text: 'after', wait: false, origin: { kind: 'composer' } })
      expect(contexts[0]).toBeUndefined()
      expect(contexts[1]?.[0]).toContain('Agent Dock is on')
    })

    test('a helper runs Fast & cheap, reports progress on its card, and a full team queues the rest', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      const steps: Step[] = []
      coreSpawn(on, seen)
      await start($, on, { usd: 0 }, { agentTeam: 1, agentHelpers: 'fast' }, [], steps)
      expect((await spawn($, 'Ignored', 'outside')).model).toBe('parent')
      await run($, 'agentdock')
      const first = await spawn($, 'Licenses', 'Research licenses')
      expect(first.agentId).toBe('agent-2')
      expect(seen[1]?.model).toBe('claude-sonnet-5-5')
      expect(seen[1]?.prompt).toContain('mcp__aitools__agent_progress')
      expect((await spawn($, 'Floor plan', 'Plan')).deny).toContain('all 1 helpers are busy')

      const progress = { doing: 'Reading the city site', percent: 40 }
      await $.tool.call({ tool: 'mcp__aitools__agent_progress', agentId: 'agent-2', ...progress })
      const helperStep = { turnId: 't9', index: 0, model: 'claude-opus-5-5', effort: 'high' as const, messageCount: 1 }
      for await (const _ of $.turn.step({ ...helperStep, agentId: 'agent-2' })) {
        // drain
      }
      expect(steps.at(-1)).toEqual({ agentId: 'agent-2', model: 'claude-sonnet-5-5', effort: 'low' })
      const text = await dockText($)
      const dock = await $.ui.mount({ ...DOCK, requestId: 'agentdock' })
      const task = (await dock.findAll({ type: 'Text' })).find(t => t.text.startsWith('Licenses'))
      await dock.unmount()
      expect([task?.props.color, task?.props.bold ?? false]).toEqual(['#b0b0b0', false])
      expect(text).toContain('1 agent · 1 working · 1 queued')
      expect(text).toContain('Licenses · Reading the city site')
      expect(text).toContain(' 40% ▰▰▰▰▱▱▱▱▱▱')
    })

    test("a helper's report arriving as a prompt keeps the run; the person's next prompt clears it", async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => ({ text: e.text }))
      await start($, on, { usd: 0 })
      await run($, 'agentdock')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('h1', 'agent-1'), answer: 'Found three licenses.' })
      await $.prompt.submit({ text: 'report', wait: false, origin: { kind: 'task-notification' } as never })
      await $.turn.complete({ ...complete('t2'), answer: 'Here is the plan.' })
      const text = await dockText($)
      expect(text).toContain('✓ Licenses')
      expect(text).toContain('The helper finished in 0 seconds.')
      await $.prompt.submit({ text: 'next job', wait: false, origin: { kind: 'composer' } })
      expect(await dockText($)).toContain('Your next prompt can hand work to 5')
    })

    test('a helper the engine lists as finished is settled even if its finish was missed', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('agent.list', () => ({ value: [{ id: 'agent-1', description: 'Licenses', type: 'general-purpose', status: 'completed' }] }))
      await start($, on, { usd: 0 })
      await run($, 'agentdock')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('t2'), answer: 'All done.' })
      expect(await dockText($)).toContain('The helper finished in 0 seconds.')
    })

    test('helpers started together respect the team size and keep every card', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      await start($, on, { usd: 0 }, { agentTeam: 3 })
      await run($, 'agentdock')
      const results = await Promise.all(['A', 'B', 'C', 'D', 'E'].map(name => spawn($, name)))
      expect(results.filter(r => r.agentId !== undefined)).toHaveLength(3)
      expect(results.filter(r => r.deny !== undefined)).toHaveLength(2)
      const text = await dockText($)
      expect(text).toContain('3 agents · 3 working · 2 queued')
      expect(text.match(/● /g)).toHaveLength(3)
    })

    test("a helper's first request waits for its start, so it runs Fast & cheap", async ($, on) => {
      const steps: Step[] = []
      let release = () => {}
      let entered = () => {}
      const gate = new Promise<void>(resolve => (release = resolve))
      const reachedEngine = new Promise<void>(resolve => (entered = resolve))
      on('agent.spawn', async (_, e) => {
        entered()
        await gate
        return { model: e.model ?? 'parent', agentId: 'agent-1' }
      })
      await start($, on, { usd: 0 }, { agentHelpers: 'fast' }, [], steps)
      await run($, 'agentdock')
      // The helper's first request goes out while its start is still being recorded.
      const spawning = spawn($, 'Licenses')
      await reachedEngine
      const stepping = (async () => {
        const first = { turnId: 'h', index: 0, model: 'claude-opus-5-5', effort: 'high' as const, messageCount: 1 }
        for await (const _ of $.turn.step({ ...first, agentId: 'agent-1' })) {
          // drain
        }
      })()
      release()
      await Promise.all([spawning, stepping])
      expect(steps.find(s => s.agentId === 'agent-1')).toEqual({ agentId: 'agent-1', model: 'claude-sonnet-5-5', effort: 'low' })
    })

    test('a helper the engine no longer lists is settled as finished', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('agent.list', () => ({ value: [] }))
      await start($, on, { usd: 0 })
      await run($, 'agentdock')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('t2'), answer: 'All done.' })
      expect(await dockText($)).toContain('The helper finished in 0 seconds.')
    })

    test("the person's prompt clears the last job even while the dock is closed", async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => ({ text: e.text }))
      await start($, on, { usd: 0 })
      await run($, 'agentdock')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('h1', 'agent-1'), answer: 'Done.' })
      await $.turn.complete({ ...complete('t2'), answer: 'All done.' })
      await run($, 'agentdock')
      await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
      await run($, 'agentdock')
      expect(await dockText($)).toContain('Your next prompt can hand work to 5')
    })

    test('a dock pane that is open but not on screen applies nothing and says so', async ($, on) => {
      const statuses: (string | undefined)[] = []
      const contexts: (readonly string[] | undefined)[] = []
      on('ui.status', (_, e) => {
        statuses.push(e.text)
        return { value: undefined }
      })
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      const panes = await start($, on, { usd: 0 })
      await run($, 'agentdock')
      panes.isPlaced = false
      await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
      expect(contexts).toEqual([undefined])
      expect(statuses.at(-1)).toBe('Agent Dock (not shown)')
    })

    test('a helper outside the dock reports nothing; the main chat cannot report progress', async ($, on) => {
      await start($, on, { usd: 0 })
      const denied = await $.tool.call({ tool: 'mcp__aitools__agent_progress', doing: 'x', percent: 5 })
      expect(denied.deny).toBe('Only Agent Dock helpers report progress.')
    })

    test('when every helper is done and Claude replies, the dock adds a finish line under the cards', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => ({ text: e.text }))
      const { opened } = await start($, on, { usd: 0 })
      await run($, 'agentdock')
      await spawn($, 'Licenses', 'a')
      await spawn($, 'Floor plan', 'b')
      await $.turn.complete({ ...complete('t1'), answer: 'Still working.' })
      expect(opened).toEqual(['agentdock'])
      expect(await dockText($)).toContain('5 agents · 2 working · 3 idle')
      await $.turn.complete({ ...complete('h1', 'agent-1'), answer: 'Found three licenses.' })
      await $.turn.complete({ ...complete('h2', 'agent-2'), reason: 'error', answer: '' })
      await $.turn.complete({ ...complete('t2'), answer: 'Here is the plan.' })
      await $.turn.complete({ ...complete('t3'), answer: 'Anything else?' })
      expect(opened).toEqual(['agentdock'])
      const text = await dockText($)
      expect(text).toContain('✓ Licenses')
      expect(text).toContain('✕ Floor plan')
      expect(text).toContain('1 of 2 helpers finished and 1 failed, in 0 seconds each.')
      expect(text).not.toContain('Found three licenses.')
      expect(text).not.toContain('Here is the plan.')
      await $.prompt.submit({ text: 'next job', wait: false, origin: { kind: 'composer' } })
      expect(await dockText($)).toContain('Your next prompt can hand work to 5')
    })
  })

  function runAitools($: Engine, args: string) {
    return $.command.run({ command: 'aitools', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  }

  async function hasBar($: Engine): Promise<boolean> {
    const ui = await $.ui.mount(band())
    const found = (await ui.find({ key: 'settings' })) !== undefined
    await ui.unmount()

    return found
  }

  function engineBand(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, ($e, e) => $e.ui.resolve(e).Text({ children: 'engine band' }))
  }

  test('/aitools toggles the bar and on/off set it', async ($, on) => {
    engineBand(on)
    await start($, on, { usd: 0 })
    expect(await hasBar($)).toBe(true)
    expect((await runAitools($, '')).text).toBe('aitools bar hidden. Run /aitools to show it.')
    expect(await hasBar($)).toBe(false)
    expect((await runAitools($, 'on')).text).toBe('aitools bar shown.')
    expect(await hasBar($)).toBe(true)
    await runAitools($, 'off')
    expect(await hasBar($)).toBe(false)
  })

  test('/aitools with an unknown argument explains usage', async ($, on) => {
    await start($, on, { usd: 0 })
    expect((await runAitools($, 'bogus')).text).toBe('Usage: /aitools [on|off] (no argument toggles the bar)')
  })

  test('the bar stacks above a band a plugin beneath drew', async ($, on) => {
    engineBand(on)
    await start($, on, { usd: 0 })
    const ui = await $.ui.mount(band())
    expect(await ui.find({ key: 'settings' })).toBeDefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  })

  test('a hidden bar stays hidden in a new session', async ($, on) => {
    engineBand(on)
    await start($, on, { usd: 0 }, { isHidden: true })
    expect(await hasBar($)).toBe(false)
  })

  describe('mascot', () => {
    /** What the mascot's drawing says on the desktop bar, and its source. */
    async function mascot($: Engine): Promise<{ alt: unknown; source: unknown }> {
      const ui = await $.ui.mount(band())
      const art = await ui.find({ type: 'Svg' })
      await ui.unmount()

      return { alt: art?.props.alt, source: art?.props.source }
    }
    const pose = async ($: Engine) => (await mascot($)).alt

    /** Starts a session past its greeting, with the person's prompts and a Read tool answered beneath. */
    async function begin($: Engine, on: On, messages: Row[] = []) {
      on('prompt.submit', (_, e) => ({ text: e.text }))
      on('tool.call', { tool: 'Read' }, () => ({ result: 'file text' }))
      on('tool.call', { tool: 'Bash' }, () => ({ result: 'boom', isError: true as const }))
      await start($, on, { usd: 0 }, {}, messages)
    }

    /** The person's prompt and the turn it starts. */
    async function prompt($: Engine, text: string) {
      await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
      await $.turn.start({ text, turnId: 't1' })
    }

    test('a new session starts him waving, then standing', async ($, on) => {
      await begin($, on)
      expect(await pose($)).toBe('Clawd waving')
      await clock.advance(3000)
      expect(await pose($)).toBe('Clawd standing')
    })

    test('a prompt that starts no turn leaves him as he is', async ($, on) => {
      await begin($, on)
      await clock.advance(3000)
      await $.prompt.submit({ text: 'blocked', wait: false, origin: { kind: 'composer' } })
      expect(await pose($)).toBe('Clawd standing')
    })

    test('reading lasts until the last of several read-only calls returns', async ($, on) => {
      let release = () => {}
      const slow = new Promise<void>(resolve => (release = resolve))
      on('tool.call', { tool: 'WebFetch' }, async () => {
        await slow
        return { result: 'page text' }
      })
      await begin($, on)
      await prompt($, 'Look things up')
      const pending = $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x' } as never)
      await clock.settle()
      await $.tool.call({ tool: 'Read', file_path: '/a' } as never)
      expect(await pose($)).toBe('Clawd reading a sheet of paper')
      release()
      await pending
      expect(await pose($)).toBe('Clawd typing on a laptop')
    })

    test('a prompt sets him typing; a read-only tool has him reading, then typing again', async ($, on) => {
      let during: unknown
      on('tool.call', { tool: 'WebFetch' }, async () => {
        during = await pose($)
        return { result: 'page text' }
      })
      await begin($, on)
      await prompt($, 'Fix the bug')
      expect(await pose($)).toBe('Clawd typing on a laptop')
      await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x' } as never)
      expect(during).toBe('Clawd reading a sheet of paper')
      expect(await pose($)).toBe('Clawd typing on a laptop')
    })

    test('a failed tool startles him for a moment, then he types again', async ($, on) => {
      await begin($, on)
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.tool.call({ tool: 'Bash', command: 'false' } as never)
      expect(await pose($)).toBe('Clawd startled')
      await clock.advance(3000)
      expect(await pose($)).toBe('Clawd typing on a laptop')
    })

    test('a finished answer is celebrated, then he stands', async ($, on) => {
      await begin($, on)
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.turn.complete({ ...complete('t1'), answer: 'Fixed it.' })
      expect(await pose($)).toBe('Clawd celebrating')
      await clock.advance(3000)
      expect(await pose($)).toBe('Clawd standing')
    })

    test('an answer that asks something puzzles him until the person replies', async ($, on) => {
      await begin($, on)
      await $.turn.complete({ ...complete('t1'), answer: 'Which file should I change?' })
      expect(await pose($)).toBe('Clawd looking puzzled')
      await clock.advance(10 * 60_000)
      expect(await pose($)).toBe('Clawd looking puzzled')
      await prompt($, 'bar.tsx')
      expect(await pose($)).toBe('Clawd typing on a laptop')
    })

    test('an interrupted turn startles him, then he stands', async ($, on) => {
      await begin($, on)
      await $.turn.complete({ ...complete('t1'), reason: 'aborted', isAborted: true })
      expect(await pose($)).toBe('Clawd startled')
      await clock.advance(3000)
      expect(await pose($)).toBe('Clawd standing')
    })

    test('puzzled while an AskUserQuestion dialog is open, typing once it is answered', async ($, on) => {
      let during: unknown
      on('tool.call', { tool: 'AskUserQuestion' }, async () => {
        during = await pose($)
        return { result: 'Picked blue' }
      })
      await begin($, on)
      await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
      expect(during).toBe('Clawd looking puzzled')
      expect(await pose($)).toBe('Clawd typing on a laptop')
    })

    test('standing idle for five minutes he falls asleep; a prompt wakes him', async ($, on) => {
      await begin($, on)
      await clock.advance(3000)
      await clock.advance(4 * 60_000)
      expect(await pose($)).toBe('Clawd standing')
      // Checked every 30 seconds, so asleep within half a minute past five.
      await clock.advance(90_000)
      expect(await pose($)).toBe('Clawd asleep')
      await prompt($, 'Wake up')
      expect(await pose($)).toBe('Clawd typing on a laptop')
    })

    test('a change of pose plays its transition, then the source drops it', async ($, on) => {
      await begin($, on)
      await clock.advance(3000)
      await prompt($, 'go')
      const first = await mascot($)
      await clock.advance(2000)
      const settled = await mascot($)
      expect(settled.alt).toBe(first.alt)
      expect(settled.source).not.toBe(first.source)
      expect(String(first.source).length).toBeGreaterThan(String(settled.source).length)
    })

    test("the mod's own checklist tool leaves him as he is", async ($, on) => {
      await begin($, on)
      await clock.advance(3000)
      await $.tool.call({ tool: 'mcp__aitools__checklist', title: 'Plan', items: [{ text: 'One', status: 'doing' }] })
      expect(await pose($)).toBe('Clawd standing')
    })

    test('a question left open before the mod loaded still puzzles him after his greeting', async ($, on) => {
      await begin($, on, [
        { role: 'user', text: 'Add dark mode', toolUses: [] },
        { role: 'assistant', text: 'Should it follow the system setting?', toolUses: [] },
      ])
      await clock.advance(3000)
      expect(await pose($)).toBe('Clawd looking puzzled')
    })
  })

  describe('features turned off do no work', () => {
    const command = ($: Engine, name: string, args = '') =>
      $.command.run({ command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

    async function toggleOption($: Engine, key: string) {
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'settings' })
      await ui.press({ key })
      await ui.press({ key: 'settings' })
      await ui.unmount()
    }

    test('no transcript scan while the month, thread tokens and weekly share are all off; turning one on scans', async ($, on) => {
      const off = { monthlyCost: false, threadTokens: false, threadPercent: false }
      await start($, on, { usd: 0 }, { settings: off })
      await $.turn.complete({ ...complete('t1'), answer: 'Done.' })
      await clock.settle()
      expect(scans).toBe(0)
      await toggleOption($, 'monthlyCost')
      await clock.settle()
      expect(scans).toBeGreaterThan(0)
    })

    test('no scan while the bar is hidden; showing it scans', async ($, on) => {
      await start($, on, { usd: 0 }, { isHidden: true })
      await clock.settle()
      expect(scans).toBe(0)
      await command($, 'aitools', 'on')
      await clock.settle()
      expect(scans).toBeGreaterThan(0)
    })

    test('the checklist and progress tools are offered only once their view or the dock is on', async ($, on) => {
      await start($, on, { usd: 0 })
      expect(registered).toEqual([])
      await command($, 'taskview', 'on')
      expect(registered).toEqual(['checklist'])
      await command($, 'agentdock')
      expect(registered).toEqual(['checklist', 'agent_progress'])
    })

    test('a saved view offers its tool when the session starts', async ($, on) => {
      await start($, on, { usd: 0 }, { viewMode: 'clean' })
      expect(registered).toEqual(['checklist'])
    })

    test('the mascot follows nothing while his option is off, and starts from where things stand when turned on', async ($, on) => {
      on('prompt.submit', (_, e) => ({ text: e.text }))
      await start($, on, { usd: 0 }, { settings: { mascot: false } }, [
        { role: 'user', text: 'Pick a color', toolUses: [] },
        { role: 'assistant', text: 'Which one do you want?', toolUses: [] },
      ])
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.turn.complete({ ...complete('t1'), answer: 'Which one do you want?' })
      await toggleOption($, 'mascot')
      const ui = await $.ui.mount(band())
      expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Clawd looking puzzled')
      await ui.unmount()
    })
  })
})
