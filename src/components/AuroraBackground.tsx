export function AuroraBackground() {
  return (
    <div className="aurora-background" aria-hidden="true">
      <div className="aurora-background__wash aurora-background__parallax--far">
        <div className="aurora-field aurora-field--cyan" />
        <div className="aurora-field aurora-field--blue" />
        <div className="aurora-field aurora-field--violet" />
      </div>
      <svg className="aurora-background__orbits aurora-background__parallax--mid" viewBox="0 0 1600 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="aurora-orbit-cool" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--orbit-cyan)" stopOpacity="0" />
            <stop offset="0.32" stopColor="var(--orbit-cyan)" stopOpacity="0.78" />
            <stop offset="0.68" stopColor="var(--orbit-blue)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--orbit-violet)" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id="aurora-orbit-violet" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--orbit-violet)" stopOpacity="0" />
            <stop offset="0.4" stopColor="var(--orbit-violet)" stopOpacity="0.68" />
            <stop offset="0.72" stopColor="var(--orbit-cyan)" stopOpacity="0.72" />
            <stop offset="1" stopColor="var(--orbit-cyan)" stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <path className="aurora-orbit aurora-orbit--primary" d="M-80 560C180 510 285 280 570 238s405 111 645 80 307-138 465-150" pathLength="100" />
        <path className="aurora-orbit aurora-orbit--secondary" d="M-80 720c305 80 490-106 755-111s390 90 606 2 256-256 439-279" pathLength="100" />
        <path className="aurora-orbit aurora-orbit--lower" d="M-120 765c246-4 330-99 540-111s437 68 636 10 311-175 554-197" pathLength="100" />
        <circle className="aurora-orbit-lumen" r="3">
          <animateMotion
            dur="29s"
            repeatCount="indefinite"
            path="M-80 560C180 510 285 280 570 238s405 111 645 80 307-138 465-150"
          />
        </circle>
        <circle className="aurora-orbit-lumen aurora-orbit-lumen--violet" r="2.5">
          <animateMotion
            dur="34s"
            begin="-17s"
            repeatCount="indefinite"
            path="M-80 720c305 80 490-106 755-111s390 90 606 2 256-256 439-279"
          />
        </circle>
      </svg>

      <div className="aurora-coin aurora-background__parallax--near">
        <div className="aurora-coin__face">
          <img src="/arcsplit-mark.png" alt="" />
        </div>
      </div>

      <div className="aurora-particles aurora-background__parallax--mid">
        <span className="aurora-crystal aurora-crystal--one" />
        <span className="aurora-crystal aurora-crystal--two" />
        <span className="aurora-crystal aurora-crystal--three" />
        <span className="aurora-particle aurora-particle--one" />
        <span className="aurora-particle aurora-particle--two" />
        <span className="aurora-particle aurora-particle--three" />
        <span className="aurora-particle aurora-particle--four" />
        <span className="aurora-particle aurora-particle--five" />
        <span className="aurora-particle aurora-particle--sparkle-one" />
        <span className="aurora-particle aurora-particle--sparkle-two" />
      </div>
    </div>
  )
}
