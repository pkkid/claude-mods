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

  test('the display options come five to a row; Mascot leads the first row, on the desktop only', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    const counts: Record<string, (number | undefined)[]> = {}
    for (const surface of SURFACES) {
      const ui = await $.ui.mount(band(surface))
      await ui.press({ key: 'settings' })
      const rows = []
      for (let i = 0; (await ui.find({ key: `settings-row-${i}` })) !== undefined; i++) {
        rows.push(await ui.find({ key: `settings-row-${i}` }))
      }
      counts[surface] = rows.map(r => r?.children.length)
      expect((await ui.find({ key: 'label' }))?.text).toBe('● Title')
      expect((await ui.find({ key: 'mascot' })) !== undefined).toBe(surface === 'desktop')
      expect((await ui.find({ key: 'settings-row-0' }))?.text.startsWith('● Mascot')).toBe(surface === 'desktop')
      await ui.press({ key: 'settings' })
      await ui.unmount()
    }
    expect(counts).toEqual({ terminal: [5, 5, 5], desktop: [6, 5, 5] })
  })

  test('the mascot stands at the start of the bar on the desktop only, and Mascot hides him', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    const terminal = await $.ui.mount(band('terminal'))
    expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
    await terminal.unmount()

    const ui = await $.ui.mount(band('desktop'))
    const art = await ui.find({ type: 'Svg' })
    expect(art?.props.alt).toBe('Clawd standing')
    expect(art?.props.width).toBe(48)
    expect(art?.props.height).toBe(20)
    expect(art?.props.isInteractive).toBeUndefined()
    expect(String(art?.props.source)).toMatch(/^<svg [\s\S]*<\/svg>$/)
    await ui.press({ key: 'settings' })
    expect((await ui.find({ key: 'mascot' }))?.text).toBe('● Mascot')
    await ui.press({ key: 'mascot' })
    expect((await ui.find({ key: 'mascot' }))?.text).toBe('○ Mascot')
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('metric labels stay dim; their values are the half-dim grey', async ($, on) => {
    coreBand(on)
    mock.store(on, {})
    mock.clock(on, { now: NOW })
    const ui = await $.ui.mount(band('desktop'))
    const texts = await ui.findAll({ type: 'Text' })
    await ui.unmount()
    // The month is still loading here: `month …`.
    const label = texts.find(t => t.text === 'month ')
    const value = texts.find(t => t.text.startsWith('…'))
    expect(label?.props.dimColor).toBe(true)
    expect(value?.props.color).toBe('#b0b0b0')
    expect(value?.props.dimColor).toBeUndefined()
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

  test('the tools button always shows, even with a saved setting from when it could be hidden', async ($, on) => {
    coreBand(on)
    mock.store(on, { settings: { handoffButton: false } })
    mock.clock(on, { now: NOW })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount(band('desktop'))
    expect(await ui.find({ key: 'tools' })).toBeDefined()
    await ui.press({ key: 'settings' })
    expect(await ui.find({ text: /Tools menu/ })).toBeUndefined()
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
