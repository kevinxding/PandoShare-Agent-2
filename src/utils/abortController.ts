export function createAbortController(): AbortController {
  return new AbortController()
}

export function createChildAbortController(parent: AbortController): AbortController {
  const child = createAbortController()

  if (parent.signal.aborted) {
    child.abort(parent.signal.reason)
    return child
  }

  const abortChild = () => child.abort(parent.signal.reason)
  parent.signal.addEventListener('abort', abortChild, { once: true })
  child.signal.addEventListener(
    'abort',
    () => parent.signal.removeEventListener('abort', abortChild),
    { once: true },
  )

  return child
}

