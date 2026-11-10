export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="HNH Labs">
      <rect width="1024" height="1024" rx="220" fill="#16191f" stroke="#2a303b" strokeWidth="16" />
      <g transform="translate(101.9 757.0) scale(0.6712)">
        <path
          d="M77 0V-730H202V-550L199 -448Q209 -500 248.0 -530.0Q287 -560 347 -560Q428 -560 476.5 -506.0Q525 -452 525 -361V0H400V-346Q400 -397 373.5 -424.5Q347 -452 302 -452Q255 -452 228.5 -424.0Q202 -396 202 -344V0Z"
          fill="#ECEFF4"
        />
        <rect x="645" y="-730" width="500" height="730" fill="#8A93A3" />
      </g>
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}
