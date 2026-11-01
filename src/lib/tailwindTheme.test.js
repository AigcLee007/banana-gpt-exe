import { describe, expect, it } from 'vitest'
import config from '../../tailwind.config.js'

describe('Tailwind color scheme', () => {
  it('activates dark variants from the app theme instead of the operating system', () => {
    expect(config.darkMode).toEqual(['selector', '[data-theme="dark"]'])
  })
})
