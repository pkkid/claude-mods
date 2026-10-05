import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const NOW = new Date(2026, 9, 4, 12, 0).getTime()

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

/** Starts a session whose `$.session.usage()` reports `cost.usd` as `costs.usd` and whose history is `messages`. */
async function start($: Engine, on: On, costs: { usd: number }, stored: Record<string, unknown> = {}, messages: Row[] = []) {
  mock.store(on, { lastSnapshot: PREVIOUS, ...stored })
  mock.clock(on, { now: NOW })
  coreBand(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__aitools__${e.name}` } }))
  on('session.messages', () => ({ value: messages }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [], cost: { usd: costs.usd } } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
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
    const opened: string[] = []
    const copies: string[] = []
    on('model.fork', () => ({
      value: { isAnswered: true, text: brief, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.copy', (_, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    await start($, on, { usd: 0 })
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
      expect(text).toContain('● Add the tokens 40% ████░░░░░░')
      expect(text).toContain('○ Run the checks  0% ░░░░░░░░░░')
      expect(text).toContain('✓ Read the theme100% ██████████')
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
        ['✓ ', '#538d37', false],
        ['● ', '#61a9ab', false],
        ['○ ', null, true],
      ])
      const fills = texts.filter(t => /^█+$/.test(t.text))
      expect(fills.map(f => [f.text, f.props.color ?? null])).toEqual([
        ['██████████', '#538d37'],
        ['████', '#61a9ab'],
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
})
