const THEME_KEY = 'play-chat-theme'
export type Theme = 'light' | 'dark'

const applyTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

const saveTheme = (theme: Theme) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_KEY, theme)
}

export const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'dark' || saved === 'light') return saved

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

export const initTheme = () => {
  applyTheme(getInitialTheme())
}

export const toggleTheme = (): Theme => {
  const current = getInitialTheme()
  const next = current === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  saveTheme(next)
  return next
}

export const setTheme = (theme: Theme) => {
  applyTheme(theme)
  saveTheme(theme)
}
