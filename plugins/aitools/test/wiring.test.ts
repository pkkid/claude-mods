import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { SUBAGENT_NOTE } from '../src/agentdock'
import { askmeText } from '../src/askme'

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

  describe('the ? button', () => {
    /** Records each prompt the mod submits, answering it as core would. */
    function sends(on: On) {
      const sent: { text: string; asUser?: true }[] = []
      on('prompt.submit', (_, e) => {
        if (e.origin.kind === 'plugin') sent.push({ text: e.text, asUser: e.origin.asUser })
        return { text: e.text }
      })
      return sent
    }
    const asked = { ...complete('t1'), answer: 'The bar is in. Should the ? sit left of tools?' }

    test('a reply that asks shows it left of tools; pressed, it sends the /askme prompt as the person and goes', async ($, on) => {
      const sent = sends(on)
      await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      expect(await ui.find({ key: 'askme' })).toBeUndefined()
      await $.turn.complete(asked)
      const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
      expect(keys.slice(keys.indexOf('askme'), keys.indexOf('askme') + 3)).toEqual(['askme', 'tools', 'settings'])
      expect((await ui.find({ key: 'askme' }))?.text).toBe('?')
      await ui.press({ key: 'askme' })
      expect(sent).toEqual([{ text: askmeText(''), asUser: true }])
      expect(await ui.find({ key: 'askme' })).toBeUndefined()
      await ui.unmount()
    })

    test('not after a pop-up in the same request, nor for a reply that asks nothing, nor once the person replies', async ($, on) => {
      on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: 'Picked blue' }))
      sends(on)
      await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
      await $.turn.complete(asked)
      expect(await ui.find({ key: 'askme' })).toBeUndefined()
      await $.prompt.submit({ text: 'Next', wait: false, origin: { kind: 'composer' } })
      await $.turn.complete({ ...complete('t2'), answer: 'Done.' })
      expect(await ui.find({ key: 'askme' })).toBeUndefined()
      await $.turn.complete(asked)
      expect(await ui.find({ key: 'askme' })).toBeDefined()
      await $.prompt.submit({ text: 'Left of it', wait: false, origin: { kind: 'composer' } })
      expect(await ui.find({ key: 'askme' })).toBeUndefined()
      await ui.unmount()
    })

    test('while a turn runs it puts /askme in the prompt box, ahead of the draft', async ($, on) => {
      const sent = sends(on)
      const fills: string[] = []
      on('prompt.read', () => ({ value: { text: 'only the first one', cursor: 0 } }))
      on('prompt.fill', (_, e) => {
        fills.push(e.text)
        return { isFilled: true }
      })
      await start($, on, { usd: 0 })
      await $.turn.complete(asked)
      const ui = await $.ui.mount({ ...band(), props: { ...band().props, isWorking: true } })
      await ui.press({ key: 'askme' })
      expect(sent).toEqual([])
      expect(fills).toEqual(['/askme only the first one'])
      await ui.unmount()
    })

    test('a prompt that cannot be sent goes in the box instead', async ($, on) => {
      const fills: string[] = []
      on('prompt.submit', () => ({ drop: 'busy' }))
      on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
      on('prompt.fill', (_, e) => {
        fills.push(e.text)
        return { isFilled: true }
      })
      await start($, on, { usd: 0 })
      await $.turn.complete(asked)
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'askme' })
      expect(fills).toEqual(['/askme'])
      await ui.unmount()
    })

    test('a session that loads on an unanswered question shows it', async ($, on) => {
      await start($, on, { usd: 0 }, {}, [
        { role: 'user', text: 'Add the button', toolUses: [] },
        { role: 'assistant', text: 'Which side of tools?', toolUses: [] },
      ])
      const ui = await $.ui.mount(band())
      expect(await ui.find({ key: 'askme' })).toBeDefined()
      await ui.unmount()
    })
  })

  test('/askme sends the ask-with-choices prompt as the person, with the note after it', async ($, on) => {
    const sent: { text: string; asUser?: true }[] = []
    on('prompt.submit', (_, e) => {
      sent.push({ text: e.text, asUser: e.origin?.kind === 'plugin' ? e.origin.asUser : undefined })
      return { text: e.text }
    })
    await start($, on, { usd: 0 })
    const result = await $.command.run({
      command: 'askme',
      args: 'skip the naming one',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
    expect(result.text).toBeUndefined()
    expect(sent).toEqual([])
    await clock.advance(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('AskUserQuestion')
    expect(sent[0]?.text.endsWith('Also: skip the naming one')).toBe(true)
    expect(sent[0]?.asUser).toBe(true)
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
      expect(text).toContain('● Add the tokens 40% ▰▰▱▱▱▱')
      expect(text).toContain('○ Run the checks  0% ▱▱▱▱▱▱')
      expect(text).toContain('✓ Read the theme100% ▰▰▰▰▰▰')
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
        ['▰▰▰▰▰▰', '#6fbe49'],
        ['▰▰', '#478487'],
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

  describe('Subagents', () => {
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

    /** The reads `pick` and `picks` make of a mounted pane. */
    type Mounted = {
      find(query: { key?: string; type?: string; text?: string }): Promise<{ type: string; props: Record<string, unknown>; text: string } | undefined>
      findAll(query: object): Promise<{ key: string | undefined }[]>
    }

    /** A choice as the pane draws it, a plain button as the bar's: `[x] 5` picked (full strength), `[ ] 20` dim. */
    async function pick(view: Mounted, key: string): Promise<string> {
      const el = await view.find({ key })
      const isPicked = el?.props.plain === true && el.props.dimColor === false
      return `${isPicked ? '[x]' : '[ ]'} ${el?.text}`
    }

    /** The choices of one row, by key prefix, in order: picked or not. */
    async function picks(view: Mounted, prefix: string): Promise<(string | undefined)[]> {
      return (await view.findAll({})).map(e => e.key).filter(k => k?.startsWith(prefix))
    }

    async function dockText($: Engine): Promise<string> {
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
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

    test('/subagents opens the Subagents pane; the team and helper picks show with a warning past 10', async ($, on) => {
      const panes = await start($, on, { usd: 0 }, { agentTeam: 5 })
      expect((await run($, 'subagents')).text).toBe('Subagents open: 5 Same as chat helpers.')
      expect(panes.open.has('subagents')).toBe(true)
      const ui = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      expect(await pick(ui, 'team-5')).toBe('[x] 5')
      expect(await pick(ui, 'helpers-same')).toBe('[x] Same as chat')
      const order = await picks(ui, 'helpers-')
      expect(order).toEqual(['helpers-same', 'helpers-fast'])
      expect(await ui.find({ text: /uses your Claude usage much faster/ })).toBeUndefined()
      await ui.press({ key: 'team-20' })
      await ui.press({ key: 'helpers-fast' })
      expect(await pick(ui, 'team-20')).toBe('[x] 20')
      expect(await pick(ui, 'helpers-fast')).toBe('[x] Fast & cheap')
      expect(await ui.find({ text: '⚠ A team of 20 uses your Claude usage much faster.' })).toBeDefined()
      await ui.unmount()
      expect((await run($, 'subagents')).text).toBe('Subagents closed.')
      expect(panes.open.has('subagents')).toBe(false)
      expect((await run($, 'subagents')).text).toBe('Subagents open: 20 Fast & cheap helpers.')
    })

    test('the 🛠 menu\'s Subagents only opens the pane, with no circle', async ($, on) => {
      const panes = await start($, on, { usd: 0 }, { agentTeam: 5 })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'subagents' }))?.text).toBe('Subagents')
      await ui.press({ key: 'subagents' })
      expect(panes.open.has('subagents')).toBe(true)
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'subagents' }))?.text).toBe('Subagents')
      await ui.press({ key: 'subagents' })
      await ui.unmount()
      expect(panes.open.has('subagents')).toBe(true)
    })

    test('Default, the first pick and a new setup\'s, adds no team: no note, no helper changes, no status', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      const contexts: (readonly string[] | undefined)[] = []
      const statuses: (string | undefined)[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      on('ui.status', (_, e) => {
        statuses.push(e.text)
        return { value: undefined }
      })
      await start($, on, { usd: 0 })
      expect((await run($, 'subagents')).text).toBe('Subagents open: Default, subagents run as usual.')
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      expect(await picks(pane, 'team-')).toEqual(['team-default', 'team-3', 'team-5', 'team-8', 'team-10', 'team-20'])
      expect(await pick(pane, 'team-default')).toBe('[x] Default')
      // Set model shows on Default, faint and unpickable: text, not buttons.
      expect((await pane.find({ type: 'Text', text: 'Same as chat' }))?.props.color).toBe('#808080')
      expect(await pane.find({ type: 'Button', text: 'Same as chat' })).toBeUndefined()
      expect(await pane.find({ text: /run as Claude Code normally runs them/ })).toBeUndefined()
      await pane.unmount()
      await $.prompt.submit({ text: 'Do it', wait: false, origin: { kind: 'composer' } })
      const started = await spawn($, 'Piece', 'Do a piece')
      expect(contexts).toEqual([undefined])
      expect(started.model).toBe('parent')
      // The subagent is only asked to report its progress to the pane.
      expect(seen[0]?.prompt).toBe(`Do a piece${SUBAGENT_NOTE}`)
      expect(statuses.filter(t => t?.includes('Subagents'))).toEqual([])
      expect(registered).toContain('agent_progress')
    })

    test('picking a team size starts the pane\'s work; Default stops it', async ($, on) => {
      const statuses: (string | undefined)[] = []
      on('ui.status', (_, e) => {
        statuses.push(e.text)
        return { value: undefined }
      })
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      await pane.press({ key: 'team-3' })
      expect(statuses.at(-1)).toBe('Subagents')
      expect(registered).toContain('agent_progress')
      expect(await pane.find({ key: 'helpers-same' })).toBeDefined()
      await pane.press({ key: 'team-default' })
      expect(statuses.at(-1)).toBeUndefined()
      await pane.unmount()
    })

    test('a dock whose pane is gone turns off: no note goes with the next prompt', async ($, on) => {
      const contexts: (readonly string[] | undefined)[] = []
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      const panes = await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      panes.open.delete('subagents')
      await $.prompt.submit({ text: 'after closing', wait: false, origin: { kind: 'composer' } })
      expect(contexts).toEqual([undefined])
      expect((await run($, 'subagents')).text).toContain('Subagents open')
    })

    test('the status line adds Subagents beside the view while the dock is open', async ($, on) => {
      const statuses: (string | undefined)[] = []
      on('ui.status', (_, e) => {
        statuses.push(e.text)
        return { value: undefined }
      })
      await start($, on, { usd: 0 }, { viewMode: 'task', agentTeam: 5 })
      await run($, 'subagents')
      await run($, 'taskview')
      await run($, 'subagents')
      expect(statuses).toEqual(['Task View', 'Task View, Subagents', 'Subagents', undefined])
    })

    test('the pane\'s rows read Showing:, Hide completed:, Set team size: and Set model:, in that order', async ($, on) => {
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      const text = await dockText($)
      const order = ['Showing:', 'Hide completed:', 'Set team size:', 'Set model:'].map(label => text.indexOf(label))
      expect(order.every(i => i >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

    test('saved team and helper picks come back, but the dock starts closed', async ($, on) => {
      const panes = await start($, on, { usd: 0 }, { agentTeam: 3, agentHelpers: 'same' })
      expect(panes.opened).toEqual([])
      expect((await run($, 'subagents')).text).toBe('Subagents open: 3 Same as chat helpers.')
    })

    test('the dock note goes with prompts only while the dock is open', async ($, on) => {
      const contexts: (readonly string[] | undefined)[] = []
      on('prompt.submit', (_, e) => {
        contexts.push(e.context)
        return { text: e.text }
      })
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      await $.prompt.submit({ text: 'before', wait: false, origin: { kind: 'composer' } })
      await run($, 'subagents')
      await $.prompt.submit({ text: 'after', wait: false, origin: { kind: 'composer' } })
      expect(contexts[0]).toBeUndefined()
      expect(contexts[1]?.[0]).toContain('Subagents pane is open')
    })

    test('a helper runs Fast & cheap, reports progress on its card, and a full team queues the rest', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      const steps: Step[] = []
      coreSpawn(on, seen)
      await start($, on, { usd: 0 }, { agentTeam: 3, agentHelpers: 'fast' }, [], steps)
      expect((await spawn($, 'Ignored', 'outside')).model).toBe('parent')
      await run($, 'subagents')
      const first = await spawn($, 'Licenses', 'Research licenses')
      expect(first.agentId).toBe('agent-2')
      expect(seen[1]?.model).toBe('claude-sonnet-5-5')
      expect(seen[1]?.prompt).toContain('mcp__aitools__agent_progress')
      await spawn($, 'Budget', 'Draft a budget')
      await spawn($, 'Zoning', 'Check zoning')
      expect((await spawn($, 'Floor plan', 'Plan')).deny).toContain('all 3 helpers are busy')

      const progress = { doing: 'Reading the city site', percent: 40 }
      await $.tool.call({ tool: 'mcp__aitools__agent_progress', agentId: 'agent-2', ...progress })
      const helperStep = { turnId: 't9', index: 0, model: 'claude-opus-5-5', effort: 'high' as const, messageCount: 1 }
      for await (const _ of $.turn.step({ ...helperStep, agentId: 'agent-2' })) {
        // drain
      }
      expect(steps.at(-1)).toEqual({ agentId: 'agent-2', model: 'claude-sonnet-5-5', effort: 'low' })
      const text = await dockText($)
      const dock = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      const task = (await dock.findAll({ type: 'Text' })).find(t => t.text.startsWith('Licenses'))
      await dock.unmount()
      expect([task?.props.color, task?.props.bold ?? false]).toEqual(['#b0b0b0', false])
      expect(text).toContain('3 agents · 3 working · 1 queued')
      expect(text).toContain('Licenses · Reading the city site')
      expect(text).toContain(' 40% ▰▰▱▱▱▱')
    })

    test("a helper's report arriving as a prompt keeps the run; so does the person's next prompt", async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => ({ text: e.text }))
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('h1', 'agent-1'), answer: 'Found three licenses.' })
      await $.prompt.submit({ text: 'report', wait: false, origin: { kind: 'task-notification' } as never })
      await $.turn.complete({ ...complete('t2'), answer: 'Here is the plan.' })
      const text = await dockText($)
      expect(text).toContain('✓ Licenses')
      expect(text).toContain('✓ Licenses 0:00 (just now)')
      await $.prompt.submit({ text: 'next job', wait: false, origin: { kind: 'composer' } })
      expect(await dockText($)).toContain('✓ Licenses')
    })

    test('a helper the engine lists as finished is settled even if its finish was missed', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('agent.list', () => ({ value: [{ id: 'agent-1', description: 'Licenses', type: 'general-purpose', status: 'completed' }] }))
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('t2'), answer: 'All done.' })
      expect(await dockText($)).toContain('✓ Licenses 0:00 (just now)')
    })

    test('helpers started together respect the team size and keep every card', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      await start($, on, { usd: 0 }, { agentTeam: 3 })
      await run($, 'subagents')
      const results = await Promise.all(['A', 'B', 'C', 'D', 'E'].map(name => spawn($, name)))
      expect(results.filter(r => r.agentId !== undefined)).toHaveLength(3)
      expect(results.filter(r => r.deny !== undefined)).toHaveLength(2)
      const text = await dockText($)
      expect(text).toContain('3 agents · 3 working · 2 queued')
      expect(text.match(/● /g)).toHaveLength(3)
      // Queued pieces wait above the running ones.
      // Queued pieces are only counted in the header: they get no line of their own.
      expect(text).not.toContain('○ D')
      expect(text).not.toContain('Dqueued')
    })

    test('on Default every subagent gets a line: its latest tool call, then ✓ below the running ones once done', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('tool.call', { tool: 'Read' }, () => ({ result: 'file text' }))
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      await spawn($, 'Survey the code', 'look around')
      await spawn($, 'Write tests', 'add tests')
      await $.tool.call({ tool: 'Read', file_path: '/repo/src/bar.tsx', agentId: 'agent-1' } as never)
      let text = await dockText($)
      expect(text).toContain('2 working')
      expect(text).toContain('● Survey the code · Reading bar.tsx')
      expect(text).not.toContain('%')
      await $.turn.complete({ ...complete('s1', 'agent-1'), answer: 'Surveyed.' })
      text = await dockText($)
      expect(text.indexOf('● Write tests')).toBeLessThan(text.indexOf('✓ Survey the code'))
      // Default asks the subagent only to report its progress.
      expect(seen.map(s => s.prompt)).toEqual([`look around${SUBAGENT_NOTE}`, `add tests${SUBAGENT_NOTE}`])
    })

    test('with no lines to list, the pane says what will appear, for the Showing pick', async ($, on) => {
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      expect(await pane.find({ text: 'Workflow and tool subagents will appear here when created.' })).toBeDefined()
      await pane.press({ key: 'showing-tool' })
      expect(await pane.find({ text: 'Tool subagents will appear here when created.' })).toBeDefined()
      await pane.press({ key: 'showing-current' })
      expect(await pane.find({ text: 'Subagents for the current task will appear here when created.' })).toBeDefined()
      await pane.press({ key: 'team-3' })
      expect(await pane.find({ text: 'Subagents for the current task will appear here when created.' })).toBeDefined()
      expect(await pane.find({ text: /^Your next prompt can hand work to 3 / })).toBeDefined()
      await pane.unmount()
    })

    test('on the desktop the totem stacks a mini Clawd per running subagent; the terminal draws none', async ($, on) => {
      coreSpawn(on, [])
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      const totem = async () => {
        const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
        const art = await pane.find({ type: 'Svg' })
        await pane.unmount()
        return art?.props.alt
      }
      expect(await totem()).toBe('Clawd asleep')
      await spawn($, 'Survey the code', 'look around')
      await spawn($, 'Write tests', 'add tests')
      expect(await totem()).toBe('Clawd with 2 mini Clawds stacked on his head')
      await $.turn.complete({ ...complete('s1', 'agent-1'), answer: 'Surveyed.' })
      expect(await totem()).toBe('Clawd with 1 mini Clawd stacked on his head')
      const terminal = await $.ui.mount({ ...DOCK, surface: 'terminal', requestId: 'subagents' })
      expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
      await terminal.unmount()
    })

    test("a running subagent's time ticks each second; a closed pane follows no tool calls", async ($, on) => {
      coreSpawn(on, [])
      on('tool.call', { tool: 'Read' }, () => ({ result: 'file text' }))
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      await spawn($, 'Survey the code', 'look around')
      await clock.advance(3000)
      expect(await dockText($)).toContain('0:03')
      await run($, 'subagents')
      await $.tool.call({ tool: 'Read', file_path: '/repo/src/bar.tsx', agentId: 'agent-1' } as never)
      await run($, 'subagents')
      expect(await dockText($)).not.toContain('Reading bar.tsx')
    })

    test('a tool agent that reports progress shows a bar; its line still follows its tool calls', async ($, on) => {
      coreSpawn(on, [])
      on('tool.call', { tool: 'Read' }, () => ({ result: 'file text' }))
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      await spawn($, 'Survey the code', 'look around')
      const reported = await $.tool.call({ tool: 'mcp__aitools__agent_progress', agentId: 'agent-1', doing: 'Mapping the code', percent: 50 })
      expect(reported.result).toBe('Progress noted.')
      let text = await dockText($)
      expect(text).not.toContain('will appear here')
      expect(text).toContain('● Survey the code · Mapping the code')
      expect(text).toContain(' 50% ▰▰▰▱▱▱')
      await $.tool.call({ tool: 'Read', file_path: '/repo/src/bar.tsx', agentId: 'agent-1' } as never)
      text = await dockText($)
      expect(text).toContain('● Survey the code · Reading bar.tsx')
      expect(text).toContain(' 50% ▰▰▰▱▱▱')
    })

    test('a running name is half-dim and its activity faint; a finished line is all faint with how long ago', async ($, on) => {
      coreSpawn(on, [])
      on('tool.call', { tool: 'Read' }, () => ({ result: 'file text' }))
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      await spawn($, 'Survey the code', 'look around')
      await spawn($, 'Write tests', 'add tests')
      await $.tool.call({ tool: 'Read', file_path: '/repo/src/bar.tsx', agentId: 'agent-1' } as never)
      await $.turn.complete({ ...complete('s2', 'agent-2'), answer: 'Written.' })
      await clock.advance(3 * 60_000)
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      const texts = await pane.findAll({ type: 'Text' })
      await pane.unmount()
      const find = (text: string) => texts.find(t => t.text === text)
      expect(find('Survey the code')?.props.color).toBe('#b0b0b0')
      expect(find(' · Reading bar.tsx')?.props.color).toBe('#808080')
      expect(find('✓ ')?.props.color).toBe('#808080')
      expect(find('Write tests')?.props.color).toBe('#808080')
      expect(find(' 0:00 (3m ago)')?.props.color).toBe('#808080')
      expect(find(' 0:00 (3m ago)')).toBeDefined()
    })

    test('Showing and Hide completed: their own rows, applied to the lines', async ($, on) => {
      on('prompt.submit', (_, e) => ({ text: e.text }))
      coreSpawn(on, [])
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      await spawn($, 'Earlier job')
      await $.turn.complete({ ...complete('s1', 'agent-1'), answer: 'Done.' })
      await clock.advance(2 * 60_000)
      await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
      await spawn($, 'Current job')
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      expect(await picks(pane, 'showing-')).toEqual(['showing-all', 'showing-tool', 'showing-current'])
      expect(await picks(pane, 'hide-')).toEqual(['hide-never', 'hide-15', 'hide-5', 'hide-1', 'hide-0'])
      expect(await pick(pane, 'showing-all')).toBe('[x] All')
      expect(await pick(pane, 'hide-never')).toBe('[x] Never')
      expect(await pick(pane, 'hide-0')).toBe('[ ] Immediate')
      expect(await pane.find({ text: 'Earlier job' })).toBeDefined()
      await pane.press({ key: 'showing-current' })
      expect(await pane.find({ text: 'Earlier job' })).toBeUndefined()
      expect(await pane.find({ text: 'Current job' })).toBeDefined()
      await pane.press({ key: 'showing-all' })
      await pane.press({ key: 'hide-1' })
      expect(await pane.find({ text: 'Earlier job' })).toBeUndefined()
      await pane.unmount()
    })

    test('saved Showing and Hide completed picks come back', async ($, on) => {
      await start($, on, { usd: 0 }, { agentShowing: 'tool', agentHideAfter: 0 })
      await run($, 'subagents')
      const pane = await $.ui.mount({ ...DOCK, requestId: 'subagents' })
      expect(await pick(pane, 'showing-tool')).toBe('[x] Tool agents')
      expect(await pick(pane, 'hide-0')).toBe('[x] Immediate')
      await pane.unmount()
    })

    test('with the pane closed, subagents get no lines', async ($, on) => {
      coreSpawn(on, [])
      await start($, on, { usd: 0 })
      await spawn($, 'Unwatched')
      await run($, 'subagents')
      expect(await dockText($)).not.toContain('Unwatched')
    })

    test("a workflow's agents get lines under its name; an unlisted loop with no workflow started gets none", async ($, on) => {
      on('tool.call', { tool: 'Workflow' }, () => ({ result: 'Workflow started' }))
      on('agent.list', () => ({ value: [] }))
      await start($, on, { usd: 0 })
      await run($, 'subagents')
      await step($, 'fork-1')
      expect(await dockText($)).not.toContain('agent 1')
      const script = "export const meta = { name: 'review-changes', description: 'Review' }"
      await $.tool.call({ tool: 'Workflow', script } as never)
      await step($, 'wf-a')
      await step($, 'wf-b')
      let text = await dockText($)
      expect(text).toContain('● review-changes · agent 1')
      expect(text).toContain('● review-changes · agent 2')
      await $.turn.complete({ ...complete('w1', 'wf-a'), reason: 'error' })
      text = await dockText($)
      expect(text).toContain('× review-changes · agent 1')
      expect(text.indexOf('● review-changes · agent 2')).toBeLessThan(text.indexOf('× review-changes · agent 1'))
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
      await start($, on, { usd: 0 }, { agentTeam: 5, agentHelpers: 'fast' }, [], steps)
      await run($, 'subagents')
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
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('t2'), answer: 'All done.' })
      expect(await dockText($)).toContain('✓ Licenses 0:00 (just now)')
    })

    test('finished lines stay across prompts, the pane closed and opened again', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => ({ text: e.text }))
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      await spawn($, 'Licenses', 'a')
      await $.turn.complete({ ...complete('h1', 'agent-1'), answer: 'Done.' })
      await $.turn.complete({ ...complete('t2'), answer: 'All done.' })
      await run($, 'subagents')
      await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
      await run($, 'subagents')
      expect(await dockText($)).toContain('✓ Licenses')
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
      const panes = await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      panes.isPlaced = false
      await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
      expect(contexts).toEqual([undefined])
      expect(statuses.at(-1)).toBe('Subagents (not shown)')
    })

    test('a helper outside the dock reports nothing; the main chat cannot report progress', async ($, on) => {
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      const denied = await $.tool.call({ tool: 'mcp__aitools__agent_progress', doing: 'x', percent: 5 })
      expect(denied.deny).toBe('Only subagents report progress.')
    })

    test('when every helper is done and Claude replies, the dock adds a finish line under the cards', async ($, on) => {
      const seen: { model?: string; prompt: string }[] = []
      coreSpawn(on, seen)
      on('prompt.submit', (_, e) => ({ text: e.text }))
      const { opened } = await start($, on, { usd: 0 }, { agentTeam: 5 })
      await run($, 'subagents')
      await spawn($, 'Licenses', 'a')
      await spawn($, 'Floor plan', 'b')
      await $.turn.complete({ ...complete('t1'), answer: 'Still working.' })
      expect(opened).toEqual(['subagents'])
      expect(await dockText($)).toContain('5 agents · 2 working · 3 idle')
      await $.turn.complete({ ...complete('h1', 'agent-1'), answer: 'Found three licenses.' })
      await $.turn.complete({ ...complete('h2', 'agent-2'), reason: 'error', answer: '' })
      await $.turn.complete({ ...complete('t2'), answer: 'Here is the plan.' })
      await $.turn.complete({ ...complete('t3'), answer: 'Anything else?' })
      expect(opened).toEqual(['subagents'])
      const text = await dockText($)
      expect(text).toContain('✓ Licenses')
      expect(text).toContain('× Floor plan')
      expect(text).toContain('× Floor plan 0:00 (just now)')
      expect(text).not.toContain('%')
      expect(text).not.toContain('Found three licenses.')
      expect(text).not.toContain('Here is the plan.')
      await $.prompt.submit({ text: 'next job', wait: false, origin: { kind: 'composer' } })
      await spawn($, 'Budget', 'c')
      const after = await dockText($)
      // The earlier lines stay below the new one; the finish line waits for it.
      expect(after.indexOf('● Budget')).toBeLessThan(after.indexOf('✓ Licenses'))
      expect(after).toContain('× Floor plan')
      expect(after).not.toContain('subagents finished')
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

  describe('Notes', () => {
    const FILE = '/p/.claude/notes.md'

    /** A disk holding `files`, by path; a read of `unreadable` fails. */
    function disk(on: On, files: Map<string, string>, unreadable?: string) {
      on('session.root', () => ({ value: '/p' }))
      on('fs.exists', (_, e) => ({ value: files.has(e.path) || e.path === unreadable }))
      on('fs.read', (_, e) => {
        if (e.path === unreadable) throw new Error('EACCES: permission denied')
        return { value: files.get(e.path) ?? '' }
      })
      on('fs.write', (_, e) => {
        files.set(e.path, e.text)
        return { value: undefined }
      })
    }

    const notesPane = (surface: 'terminal' | 'desktop') => ({
      plugin: 'aitools',
      surface,
      component: 'Pane' as const,
      requestId: 'notes',
      props: { ...PANE, title: 'Notes' },
    })

    test("the 🛠 menu's Notes, right after Handoff, opens the note as saved", async ($, on) => {
      const files = new Map([[FILE, 'Buy milk']])
      disk(on, files)
      const panes = await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      const keys = (await ui.findAll({ type: 'Button' })).map(b => b.props.key)
      expect(keys.indexOf('notes')).toBe(keys.indexOf('handoff') + 1)
      await ui.press({ key: 'notes' })
      await ui.unmount()
      expect(panes.open.has('notes')).toBe(true)
      const pane = await $.ui.mount(notesPane('desktop'))
      expect((await pane.find({ type: 'Client' }))?.props.props).toEqual({ text: 'Buy milk', columns: 80 })
      const saved = (await pane.findAll({ type: 'Text' }))[0]
      expect([saved?.text, saved?.props.color]).toEqual(['Note saved to .claude/notes.md in your project.', '#808080'])
      await pane.unmount()
    })

    test('Copy copies the note as it stands, typing included', async ($, on) => {
      const copies: string[] = []
      on('ui.copy', (_, e) => {
        copies.push(e.text)
        return { value: { isCopied: true as const } }
      })
      disk(on, new Map([[FILE, 'Buy milk']]))
      await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      await ui.press({ key: 'notes' })
      await ui.unmount()
      const pane = await $.ui.mount(notesPane('desktop'))
      await pane.key({ key: '!' })
      await pane.press({ key: 'copy' })
      await pane.unmount()
      expect(copies).toEqual(['Buy milk!'])
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      test(`on the ${surface}, what is typed is saved to .claude/notes.md`, async ($, on) => {
        const files = new Map<string, string>()
        disk(on, files)
        await start($, on, { usd: 0 })
        const ui = await $.ui.mount(band())
        await ui.press({ key: 'tools' })
        await ui.press({ key: 'notes' })
        await ui.unmount()
        const pane = await $.ui.mount(notesPane(surface))
        for (const key of ['h', 'i', 'return', 'there']) {
          await pane.key({ key })
        }
        await pane.key({ key: 'backspace' })
        await pane.unmount()
        expect(files.get(FILE)).toBe('hi\nther')
      })
    }

    test('a note that cannot be read shows why, and nothing writes over it', async ($, on) => {
      const files = new Map<string, string>()
      disk(on, files, FILE)
      await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      await ui.press({ key: 'notes' })
      await ui.unmount()
      const pane = await $.ui.mount(notesPane('desktop'))
      expect(await pane.find({ type: 'Client' })).toBeUndefined()
      expect((await pane.find({ type: 'Text' }))?.text).toContain('Could not read .claude/notes.md')
      await pane.unmount()
      expect(files.has(FILE)).toBe(false)
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
      await start($, on, { usd: 0 }, { agentTeam: 5 })
      expect(registered).toEqual([])
      await command($, 'taskview', 'on')
      expect(registered).toEqual(['checklist'])
      await command($, 'subagents')
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

  describe('Worktrees', () => {
    const WT = { plugin: 'aitools', surface: 'desktop' as const, component: 'Pane' as const, requestId: 'worktrees', props: PANE }
    const run = (on$: Engine, command: string) =>
      on$.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

    /** A repository with three worktrees besides /p: merged and clean, with changes, and with unpushed commits. */
    type Repo = { calls: string[]; trees: { path: string; branch: string; changed: string; ahead: string }[] }

    /** Answers git and gh as that repository would, recording each command; removed worktrees leave the list. */
    function fakeRepo(on: On): Repo {
      const repo: Repo = {
        calls: [],
        trees: [
          { path: '/p', branch: 'main', changed: '', ahead: '0' },
          { path: '/p/wt/done', branch: 'feat/done', changed: '', ahead: '0' },
          { path: '/p/wt/dirty', branch: 'feat/dirty', changed: ' M a.ts\n?? b.ts\n', ahead: '0' },
          { path: '/p/wt/wip', branch: 'feat/wip', changed: '', ahead: '2' },
        ],
      }
      on('session.cwd', () => ({ value: '/p' }))
      on('tool.call', () => ({ result: 'done' }))
      const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
      on('process.run', (_, e) => {
        const [cmd, ...args] = e.argv
        const cwd = e.init?.cwd ?? '/p'
        const line = `${cmd} ${args.join(' ')}`
        repo.calls.push(line)
        const tree = repo.trees.find(t => t.path === cwd)
        if (cmd === 'gh') {
          return ok(args[0] === 'pr' ? '[]' : JSON.stringify(repo.trees.map(t => ({ headSha: `sha-${t.branch}`, status: 'completed', conclusion: 'success' }))))
        }
        switch (args[0]) {
          case 'rev-parse':
            return ok('/p\n')
          case 'symbolic-ref':
            return ok('origin/main\n')
          case 'worktree':
            if (args[1] === 'list') {
              return ok(repo.trees.map(t => `worktree ${t.path}\nHEAD sha-${t.branch}\nbranch refs/heads/${t.branch}\n`).join('\n'))
            }
            if (args[1] === 'remove') {
              repo.trees = repo.trees.filter(t => t.path !== args.at(-1))
            }
            return ok()
          case 'for-each-ref':
            return ok(repo.trees.map(t => `${t.branch}\torigin\trefs/heads/${t.branch}\t${t.ahead === '0' ? '' : `[ahead ${t.ahead}]`}\t${Math.floor(NOW / 1000) - 3600}`).join('\n'))
          case 'status':
            return ok(tree?.changed ?? '')
          case 'rev-list':
            return ok(`${tree?.ahead ?? '0'}\n`)
          case 'merge-base':
            return ok('base\n')
          case 'diff':
            return ok(' 2 files changed, 10 insertions(+), 3 deletions(-)\n')
          default:
            return ok()
        }
      })

      return repo
    }

    async function paneText($: Engine): Promise<string> {
      const pane = await $.ui.mount(WT)
      const text = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('')
      await pane.unmount()

      return text
    }

    test('nothing is read while the pane is closed; open, it reads git and GitHub, and keeps reading', async ($, on) => {
      const repo = fakeRepo(on)
      await start($, on, { usd: 0 })
      await clock.advance(60_000)
      expect(repo.calls).toEqual([])
      expect((await run($, 'worktrees')).text).toBe('Worktrees open.')
      await clock.settle()
      expect(repo.calls).toContain('git worktree list --porcelain')
      expect(repo.calls.some(c => c.startsWith('gh pr list'))).toBe(true)
      const text = await paneText($)
      expect(text).toContain('3 worktrees · 1 to prune · 1 with changes · 1 unpushed')
      expect(text).toContain('feat/dirty · 2 changed files')
      expect(text).toContain('+10−3')
      expect(text).toContain('✓')
      const reads = repo.calls.length
      await clock.advance(10_000)
      expect(repo.calls.length).toBeGreaterThan(reads)
      expect((await run($, 'worktrees')).text).toBe('Worktrees closed.')
      const closed = repo.calls.length
      await clock.advance(120_000)
      await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
      await clock.advance(5000)
      expect(repo.calls.length).toBe(closed)
    })

    test('a tool that changes files reads the open pane again shortly after', async ($, on) => {
      const repo = fakeRepo(on)
      await start($, on, { usd: 0 })
      await run($, 'worktrees')
      await clock.settle()
      const lists = () => repo.calls.filter(c => c === 'git worktree list --porcelain').length
      const before = lists()
      await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts' } as never)
      await $.tool.call({ tool: 'Edit', file_path: '/p/b.ts' } as never)
      await clock.advance(1500)
      expect(lists()).toBe(before + 1)
    })

    test('Clean asks first, then removes only the merged clean worktree, its branch and remote branch', async ($, on) => {
      const repo = fakeRepo(on)
      await start($, on, { usd: 0 })
      await run($, 'worktrees')
      await clock.settle()
      const pane = await $.ui.mount(WT)
      await pane.press({ key: 'clean' })
      expect(await pane.find({ text: 'Remove 1 worktree and their branches?' })).toBeDefined()
      expect(repo.calls.some(c => c.includes('remove'))).toBe(false)
      await pane.press({ key: 'clean-yes' })
      await clock.settle()
      expect((await pane.find({ type: 'Svg' }))?.props.alt).toBe('Clawd sweeping up')
      expect(repo.calls).toContain('git worktree remove /p/wt/done')
      expect(repo.calls).toContain('git branch -D feat/done')
      expect(repo.calls).toContain('git push origin --delete feat/done')
      expect(repo.calls.filter(c => c.includes('dirty') || c.includes('wip')).filter(c => /remove|branch -D|push/.test(c))).toEqual([])
      await clock.advance(3000)
      expect(await pane.find({ text: 'Removed 1 worktree with 1 branch and 1 remote branch.' })).toBeDefined()
      expect((await pane.find({ type: 'Svg' }))?.props.alt).toBe('Clawd pruning a tree')
      await pane.unmount()
    })

    test("deleting a row with unpushed commits warns, forces, and keeps its remote branch", async ($, on) => {
      const repo = fakeRepo(on)
      await start($, on, { usd: 0 })
      await run($, 'worktrees')
      await clock.settle()
      const pane = await $.ui.mount(WT)
      expect(await pane.find({ key: 'delete-/p' })).toBeUndefined()
      await pane.press({ key: 'delete-/p/wt/wip' })
      expect(await pane.find({ text: 'Delete feat/wip and its branch?' })).toBeDefined()
      expect(await pane.find({ text: 'This loses 2 unpushed commits. origin/feat/wip is kept.' })).toBeDefined()
      await pane.press({ key: 'delete-no-/p/wt/wip' })
      expect(await pane.find({ key: 'delete-yes-/p/wt/wip' })).toBeUndefined()
      // × again takes the question back.
      await pane.press({ key: 'delete-/p/wt/wip' })
      await pane.press({ key: 'delete-/p/wt/wip' })
      expect(await pane.find({ key: 'delete-yes-/p/wt/wip' })).toBeUndefined()
      await pane.press({ key: 'delete-/p/wt/wip' })
      await pane.press({ key: 'delete-yes-/p/wt/wip' })
      await clock.advance(3000)
      expect(repo.calls).toContain('git worktree remove --force /p/wt/wip')
      expect(repo.calls).toContain('git branch -D feat/wip')
      expect(repo.calls.some(c => c.startsWith('git push'))).toBe(false)
      await pane.unmount()
    })

    test('every row keeps its columns the same width, with or without a delete button, asking or not', async ($, on) => {
      fakeRepo(on)
      await start($, on, { usd: 0 })
      await run($, 'worktrees')
      await clock.settle()
      const pane = await $.ui.mount(WT)
      await pane.press({ key: 'delete-/p/wt/wip' })
      const cells = await pane.findAll({ type: 'Box' })
      const widths = (key: string) => cells.filter(b => b.props.key === key).map(b => b.props.width)
      for (const [key, width] of [['age', 5], ['changes', 15], ['ci', 3], ['delete', 3]] as const) {
        expect(widths(key)).toEqual([width, width, width, width])
      }
      // The main checkout is the first row even though it is not the newest.
      const names = (await pane.findAll({ type: 'Text' })).map(t => t.text).filter(t => /^(main|feat\/)/.test(t))
      expect(names[0]).toBe('main')
      await pane.unmount()
    })

    test("a row's name and note are cut to 50 characters together, the name first", async ($, on) => {
      const repo = fakeRepo(on)
      repo.trees[3]!.branch = 'feat/a-very-long-branch-name-about-owl-mascot-guest-avatars'
      await start($, on, { usd: 0 })
      await run($, 'worktrees')
      await clock.settle()
      const texts = (await (await $.ui.mount(WT)).findAll({ type: 'Text' })).map(t => t.text)
      expect(texts).toContain('feat/a-very-long-branch-name-about-owl-mascot-gue…')
      expect(texts).toContain('feat/dirty')
      expect(texts).toContain(' · 2 changed files · merged')
    })

    test("the 🛠 menu's Worktrees opens the pane; with none but the main checkout Clawd naps", async ($, on) => {
      const repo = fakeRepo(on)
      repo.trees = repo.trees.slice(0, 1)
      const panes = await start($, on, { usd: 0 })
      const ui = await $.ui.mount(band())
      await ui.press({ key: 'tools' })
      expect((await ui.find({ key: 'worktrees' }))?.text).toBe('Worktrees')
      await ui.press({ key: 'worktrees' })
      await ui.unmount()
      expect(panes.open.has('worktrees')).toBe(true)
      await clock.settle()
      const pane = await $.ui.mount(WT)
      expect((await pane.find({ type: 'Svg' }))?.props.alt).toBe('Clawd asleep under a tree')
      expect(await pane.find({ text: 'No worktrees besides the main checkout.' })).toBeDefined()
      await pane.unmount()
    })
  })
})
