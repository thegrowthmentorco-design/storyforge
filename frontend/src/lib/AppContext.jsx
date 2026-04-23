import React, { createContext, useContext } from 'react'

/**
 * App-level context for state that pages need to read or mutate.
 *
 * Today (M1.3.3): used by Documents to restore a saved extraction.
 * Tomorrow (M1.4): Settings will read/write theme, API key, model preference.
 * Tomorrow+ (M2): replaces local state with server-backed equivalents.
 *
 * Shape passed in `value`:
 *   {
 *     restoreExtraction(payload): void   // hydrate the result view from a saved record
 *     reset(): void                      // clear current extraction + nav home
 *   }
 */
const AppCtx = createContext(null)

export function AppProvider({ value, children }) {
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const v = useContext(AppCtx)
  if (!v) {
    throw new Error('useApp must be used inside <AppProvider>')
  }
  return v
}
