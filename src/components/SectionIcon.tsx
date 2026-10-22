type SectionIconProps = {
  name: 'sessions' | 'records' | 'calculator' | 'history'
}

function SectionIcon({ name }: SectionIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'sessions' && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4m10-4v4M3 11h18m-14 5h3" />
        </>
      )}
      {name === 'records' && (
        <>
          <path d="M8 3h8v5a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v5m-4 4h8m-6 0v-4h4v4" />
        </>
      )}
      {name === 'calculator' && (
        <>
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1" />
        </>
      )}
      {name === 'history' && (
        <>
          <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2" />
        </>
      )}
    </svg>
  )
}

export default SectionIcon
