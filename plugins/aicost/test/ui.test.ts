import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 4, 12, 0).getTime()
const SURFACES = ['terminal', 'desktop'] as const

function band(surface: (typeof SURFACES)[number], over: { hasSurvey?: boolean; bodyColumns?: number } = {}) {
  return {
    plugin: 'aicost',
    surface,
    component: 'AbovePrompt' as const,
    props: {
      hasSurvey: over.hasSurvey ?? false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: over.bodyColumns ?? 160,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }
}

describe('AbovePrompt band', () => {
  test('settings open, toggle and close', async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface))
      expect(await ui.find({ key: 'settings' })).toBeDefined()
      expect(await ui.find({ text: /wk/ })).toBeDefined()

      await ui.press({ key: 'settings' })
      expect(await ui.find({ text: 'aicost settings' })).toBeDefined()

      await ui.press({ key: 'weekly' })
      expect((await ui.find({ key: 'weekly' }))?.text).toBe('[ ] Weekly usage')

      await ui.press({ key: 'weekly' })
      expect((await ui.find({ key: 'weekly' }))?.text).toBe('[✓] Weekly usage')
      await ui.press({ key: 'weekly' })

      await ui.press({ key: 'done' })
      expect(await ui.find({ key: 'settings' })).toBeDefined()
      expect(await ui.find({ text: /wk/ })).toBeUndefined()

      await ui.press({ key: 'settings' })
      await ui.press({ key: 'weekly' })
      await ui.press({ key: 'done' })
      await ui.unmount()
    }
  })

  test('handoff button follows its toggle', async ($, on) => {
    mock.store(on, { settings: { handoffButton: false } })
    mock.clock(on, { now: NOW })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount(band('desktop'))
    expect(await ui.find({ key: 'handoff' })).toBeUndefined()
    await ui.unmount()
  })

  test('yields to a survey', async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
      const { Text } = $e.ui.resolve(e)

      return Text({ children: 'engine survey' })
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface, { hasSurvey: true }))
      expect(await ui.find({ key: 'settings' })).toBeUndefined()
      expect(await ui.find({ text: 'engine survey' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a narrow bar wraps instead of dropping segments', async ($, on) => {
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface, { bodyColumns: 40 }))
      for (const label of ['5h', 'wk', 'ctx', 'cache', 'thread', 'month']) {
        expect(await ui.find({ text: new RegExp(`\\b${label}\\b`) })).toBeDefined()
      }
      expect(await ui.find({ key: 'settings' })).toBeDefined()
      await ui.unmount()
    }
  })
})
