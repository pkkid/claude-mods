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
    plugin: 'aicost',
    surface: 'desktop' as const,
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }
}

/** Answers the band as core does when no plugin beneath draws it: its own drawing, by ref. */
function coreBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
}

/** Starts a session whose `$.session.usage()` reports `cost.usd` as `costs.usd`. */
async function start($: Engine, on: On, costs: { usd: number }, stored: Record<string, unknown> = {}) {
  mock.store(on, { lastSnapshot: PREVIOUS, ...stored })
  mock.clock(on, { now: NOW })
  coreBand(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
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
    const brief = '## Goal\nShip aicost\n\n## Next step\nMerge'
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

  test('the Handoff button puts /handoff in the prompt box', async ($, on) => {
    const fills: string[] = []
    const commands: string[] = []
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('prompt.fill', (_, e) => {
      fills.push(e.text)
      return { isFilled: true, text: e.text }
    })
    on('command.run', (_, e) => {
      commands.push(e.command)
      return { text: '' }
    })
    await start($, on, { usd: 0 })
    const ui = await $.ui.mount(band())
    await ui.press({ key: 'handoff' })
    await ui.unmount()
    expect(fills).toEqual(['/handoff'])
    expect(commands).toEqual([])
    expect(toasts).toEqual([])
  })

  function runAicost($: Engine, args: string) {
    return $.command.run({ command: 'aicost', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
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

  test('/aicost toggles the bar and on/off set it', async ($, on) => {
    engineBand(on)
    await start($, on, { usd: 0 })
    expect(await hasBar($)).toBe(true)
    expect((await runAicost($, '')).text).toBe('aicost bar hidden. Run /aicost to show it.')
    expect(await hasBar($)).toBe(false)
    expect((await runAicost($, 'on')).text).toBe('aicost bar shown.')
    expect(await hasBar($)).toBe(true)
    await runAicost($, 'off')
    expect(await hasBar($)).toBe(false)
  })

  test('/aicost with an unknown argument explains usage', async ($, on) => {
    await start($, on, { usd: 0 })
    expect((await runAicost($, 'bogus')).text).toBe('Usage: /aicost [on|off] (no argument toggles the bar)')
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
