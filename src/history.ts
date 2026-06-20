export type HistoryEntry = {
  type: string
  text: string
  createdAt: string
}

export class HistoryLog {
  readonly entries: HistoryEntry[] = []

  add(type: string, text: string): void {
    this.entries.push({
      type,
      text,
      createdAt: new Date().toISOString(),
    })
  }
}

