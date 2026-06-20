import { DurableRuntime } from '../durable/index.js'
import { projectLoopState, type LoopState } from '../loop/LoopProjector.js'
import type { EventEnvelope } from '../protocol/index.js'
import { EventReplay, type ReplayTimelineItem } from './EventReplay.js'
import { ReplayReport } from './ReplayReport.js'

export type LoopReplay = {
  loopId: string
  events: EventEnvelope[]
  timeline: ReplayTimelineItem[]
  state: LoopState
}

export class ReplayReader {
  constructor(private readonly durable: DurableRuntime) {}

  read(input: { threadId?: string; runId?: string; loopId?: string } = {}): Promise<EventEnvelope[]> {
    if (input.runId) return this.durable.readRunEvents(input.runId)
    if (input.threadId) return this.durable.readThreadEvents(input.threadId)
    return this.durable.readEvents(input)
  }

  async readWithLoopProjection(input: { threadId?: string; runId?: string; loopId?: string } = {}): Promise<{ events: EventEnvelope[]; loopState?: LoopState }> {
    const events = await this.read(input)
    const loopId = input.loopId ?? events.find(event => event.loopId)?.loopId
    return {
      events,
      loopState: loopId ? projectLoopState(events.filter(event => event.loopId === loopId || event.eventType.startsWith('loop_'))) : undefined,
    }
  }

  async buildLoopReplay(loopId: string): Promise<LoopReplay> {
    const events = await this.durable.readEvents({ loopId })
    return {
      loopId,
      events,
      timeline: new EventReplay().buildTimeline(events),
      state: projectLoopState(events),
    }
  }

  replayLoop(loopId: string): Promise<LoopReplay> {
    return this.buildLoopReplay(loopId)
  }

  async buildLoopReplayMarkdown(loopId: string): Promise<string> {
    const replay = await this.buildLoopReplay(loopId)
    return new ReplayReport().toMarkdown({
      title: 'Pando Loop Replay',
      timeline: replay.timeline,
      loopState: replay.state,
    })
  }
}
