let audioContext: AudioContext | undefined

function getAudioContext(): AudioContext | undefined {
  if (typeof window === 'undefined' || !window.AudioContext) return undefined
  audioContext ??= new window.AudioContext()
  return audioContext
}

export async function enableSuccessSound(): Promise<boolean> {
  try {
    const context = getAudioContext()
    if (!context) return false
    if (context.state !== 'running') await context.resume()
    return context.state === 'running'
  } catch {
    return false
  }
}

export function playSuccessSound(): void {
  const context = audioContext
  if (!context || context.state !== 'running') return

  try {
    const startAt = context.currentTime
    const notes = [
      { frequency: 659.25, delay: 0, duration: 0.19 },
      { frequency: 880, delay: 0.12, duration: 0.27 },
    ]

    for (const note of notes) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const noteStart = startAt + note.delay
      const noteEnd = noteStart + note.duration

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(note.frequency, noteStart)
      gain.gain.setValueAtTime(0.0001, noteStart)
      gain.gain.exponentialRampToValueAtTime(0.035, noteStart + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(noteStart)
      oscillator.stop(noteEnd)
    }
  } catch {
    // Audio is optional; playback failures must not affect a confirmed payment.
  }
}
