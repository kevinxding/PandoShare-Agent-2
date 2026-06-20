const NO_VALUE = Symbol('NO_VALUE')

export async function lastValue<T>(source: AsyncIterable<T>): Promise<T> {
  let value: T | typeof NO_VALUE = NO_VALUE
  for await (const item of source) {
    value = item
  }
  if (value === NO_VALUE) {
    throw new Error('No items in async iterable')
  }
  return value
}

export async function toArray<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const item of source) {
    values.push(item)
  }
  return values
}

export async function* fromArray<T>(values: readonly T[]): AsyncIterable<T> {
  for (const value of values) {
    yield value
  }
}

type QueuedIterator<T> = {
  done: boolean | undefined
  value: T | undefined
  iterator: AsyncIterator<T>
  promise: Promise<QueuedIterator<T>>
}

function nextQueued<T>(iterator: AsyncIterator<T>): Promise<QueuedIterator<T>> {
  let promise!: Promise<QueuedIterator<T>>
  promise = iterator.next().then(({ done, value }) => ({
    done,
    value,
    iterator,
    promise,
  }))
  return promise
}

export async function* all<T>(
  sources: readonly AsyncIterable<T>[],
  concurrencyCap = Number.POSITIVE_INFINITY,
): AsyncIterable<T> {
  if (concurrencyCap < 1) {
    throw new Error('concurrencyCap must be at least 1')
  }

  const waiting = sources.map(source => source[Symbol.asyncIterator]())
  const running = new Set<Promise<QueuedIterator<T>>>()

  while (running.size < concurrencyCap && waiting.length > 0) {
    running.add(nextQueued(waiting.shift()!))
  }

  while (running.size > 0) {
    const queued = await Promise.race(running)
    running.delete(queued.promise)

    if (!queued.done) {
      running.add(nextQueued(queued.iterator))
      if (queued.value !== undefined) {
        yield queued.value
      }
    } else if (waiting.length > 0) {
      running.add(nextQueued(waiting.shift()!))
    }
  }
}
