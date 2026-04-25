import React, { createContext, useContext } from 'react'

/**
 * App-level context for state pages need to read or mutate.
 *
 * Shape passed in `value`:
 *   {
 *     restoreExtraction(rowOrRecord): void   // hydrate the result view from a saved record/summary
 *     reset(): void                          // clear current extraction + nav home
 *     theme, setTheme(next)                  // light / dark / system
 *     projects: ProjectRead[]                // backend projects list (cached app-wide)
 *     projectsLoading: boolean
 *     refreshProjects(): Promise<void>       // re-fetch after create/rename/delete
 *     projectById: Record<string, ProjectRead>   // quick lookup for badges
 *     plan: PlanRead | null                  // M3.5 — current plan + usage_in_period
 *     refreshPlan(): Promise<void>           // refetch after extraction/rerun
 *     showPaywall(payload): void             // imperative trigger for the upgrade modal
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
