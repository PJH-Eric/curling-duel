import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('queues Google tag commands as Arguments objects with the correct page identity', async () => {
  const browser = {
    GAME_ANALYTICS_CONFIG: {
      measurement_id: 'G-PG79WZK8QY', game_id: 'ice-duel',
      page_location: 'https://pjh-eric.github.io/curling-duel/',
    },
    dataLayer: [] as IArguments[],
  }
  vi.stubGlobal('window', browser)
  vi.stubGlobal('location', { hostname: 'pjh-eric.github.io' })
  vi.stubGlobal('document', {
    title: '冰壺對決', referrer: '',
    createElement: () => ({}), head: { appendChild: vi.fn() },
  })
  const { initAnalytics, pageView } = await import('../src/analytics')
  initAnalytics()
  pageView('home')
  expect(browser.dataLayer).toHaveLength(3)
  for (const command of browser.dataLayer) {
    expect(Object.prototype.toString.call(command)).toBe('[object Arguments]')
  }
  expect(Array.from(browser.dataLayer[2])).toEqual(['event', 'page_view', {
    game_id: 'ice-duel', page_location: 'https://pjh-eric.github.io/curling-duel/#/home',
    page_referrer: '', page_title: '冰壺對決 - home', screen_name: 'home',
  }])
})
