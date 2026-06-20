export type SetupState = {
  cwd: string
  trusted: boolean
}

export function createSetupState(cwd: string): SetupState {
  return {
    cwd,
    trusted: false,
  }
}

