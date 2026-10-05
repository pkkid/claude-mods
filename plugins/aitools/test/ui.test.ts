import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = new Date(2026, 9, 4, 12, 0).getTime()
const SURFACES = ['terminal', 'desktop'] as const

function band(surface: (typeof SURFACES)[number], over: { hasSurvey?: boolean; bodyColumns?: number } = {}) {
  return {
    plugin: 'aitools',
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

/** Answers the band as core does when no plugin beneath draws it: its own drawing, by ref. */
function coreBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
}

describe('AbovePrompt band', () => {
  test('settings open, toggle and close', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface))
      expect((await ui.find({ key: 'settings' }))?.text).toBe('⁝')
      expect(await ui.find({ text: /wk/ })).toBeDefined()

      await ui.press({ key: 'settings' })
      expect(await ui.find({ key: 'weekly' })).toBeDefined()
      expect(await ui.find({ text: /wk/ })).toBeDefined()

      await ui.press({ key: 'weekly' })
      expect((await ui.find({ key: 'weekly' }))?.text).toBe('○ Weekly usage')

      await ui.press({ key: 'weekly' })
      expect((await ui.find({ key: 'weekly' }))?.text).toBe('● Weekly usage')
      await ui.press({ key: 'weekly' })
      expect(await ui.find({ text: /wk/ })).toBeUndefined()

      await ui.press({ key: 'settings' })
      expect(await ui.find({ key: 'weekly' })).toBeUndefined()
      expect(await ui.find({ key: 'settings' })).toBeDefined()

      await ui.press({ key: 'settings' })
      await ui.press({ key: 'weekly' })
      await ui.press({ key: 'settings' })
      await ui.unmount()
    }
  })

  test('the display options come five to a row', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    const ui = await $.ui.mount(band('desktop'))
    await ui.press({ key: 'settings' })
    const rows = []
    for (let i = 0; (await ui.find({ key: `settings-row-${i}` })) !== undefined; i++) {
      rows.push(await ui.find({ key: `settings-row-${i}` }))
    }
    await ui.unmount()
    expect(rows.map(r => r?.children.length)).toEqual([5, 5, 4])
  })

  test('the AI Tools label shows by default', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    const ui = await $.ui.mount(band('desktop'))
    expect(await ui.find({ text: 'AI Tools    ' })).toBeDefined()
    await ui.unmount()
  })

  test('the AI Tools label follows its toggle', async ($, on) => {
    coreBand(on)
    mock.store(on, { settings: { label: false } })
    mock.clock(on, { now: NOW })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount(band('desktop'))
    expect(await ui.find({ text: 'AI Tools    ' })).toBeUndefined()
    await ui.unmount()
  })

  test('opening one menu closes the other', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    const ui = await $.ui.mount(band('desktop'))
    await ui.press({ key: 'tools' })
    expect(await ui.find({ key: 'workflows' })).toBeDefined()

    await ui.press({ key: 'settings' })
    expect(await ui.find({ key: 'weekly' })).toBeDefined()
    expect(await ui.find({ key: 'workflows' })).toBeUndefined()

    await ui.press({ key: 'tools' })
    expect(await ui.find({ key: 'workflows' })).toBeDefined()
    expect(await ui.find({ key: 'weekly' })).toBeUndefined()
    await ui.unmount()
  })

  test('tools menu follows its toggle', async ($, on) => {
    coreBand(on)
    mock.store(on, { settings: { handoffButton: false } })
    mock.clock(on, { now: NOW })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount(band('desktop'))
    expect(await ui.find({ key: 'tools' })).toBeUndefined()
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
    coreBand(on)
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
