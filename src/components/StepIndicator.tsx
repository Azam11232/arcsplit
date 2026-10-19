import { Check } from 'lucide-react'

interface Step {
  label: string
  sublabel: string
}

const STEPS: Step[] = [
  { label: 'Amount', sublabel: 'How much to split' },
  { label: 'Recipients', sublabel: 'Who gets paid' },
  { label: 'Review', sublabel: 'Approve and send' },
]

interface Props {
  current: number // 0-indexed
}

export function StepIndicator({ current }: Props) {
  return (
    <div className="flex items-center gap-0" role="navigation" aria-label="Steps">
      {STEPS.map((step, idx) => {
        const done = idx < current
        const active = idx === current
        return (
          <div key={idx} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all"
                style={{
                  background: done
                    ? 'var(--success)'
                    : active
                    ? 'var(--accent)'
                    : 'var(--surface-muted)',
                  color: done || active ? '#fff' : 'var(--subtle)',
                  border: active ? '2px solid var(--accent)' : '2px solid transparent',
                }}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="h-4 w-4" /> : idx + 1}
              </div>
              <span
                className="hidden text-center text-xs font-medium sm:block"
                style={{ color: active ? 'var(--ink)' : 'var(--subtle)' }}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className="mx-2 mb-4 h-px w-10 flex-shrink-0 sm:w-14 transition-all"
                style={{ background: done ? 'var(--success)' : 'var(--border)' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
