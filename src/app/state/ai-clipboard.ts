export interface ClipboardLike {
  writeText: (value: string) => Promise<void>
}

export type ClipboardWriteResult =
  | {
    ok: true
    message: string
  }
  | {
    ok: false
    message: string
    error?: unknown
  }

function defaultClipboard(): ClipboardLike | undefined {
  const candidate = globalThis.navigator?.clipboard
  return candidate && typeof candidate.writeText === 'function' ? candidate : undefined
}

export async function writeTextToClipboard(text: string, clipboard: ClipboardLike | undefined = defaultClipboard()): Promise<ClipboardWriteResult> {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      ok: false,
      message: 'Nothing is ready to copy yet.',
    }
  }
  if (!clipboard) {
    return {
      ok: false,
      message: 'Clipboard access is unavailable here. Copy the text manually.',
    }
  }
  try {
    await clipboard.writeText(text)
    return {
      ok: true,
      message: 'Copied to the clipboard.',
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const rejected = /notallowed|denied|permission|rejected|blocked/i.test(rawMessage)
    return {
      ok: false,
      message: rejected
        ? 'Clipboard access was rejected. Copy the text manually.'
        : 'Could not write to the clipboard. Copy the text manually.',
      error,
    }
  }
}
