function Header() {
  return (
    <header className="site-header">
      <div className="header-content container">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M3 13v6m5-10v14m16-14v14m5-10v6M8 16h16"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <p className="brand-name">LiftBoard</p>
        </div>
        <p className="header-subtitle">Votre carnet d’haltérophilie</p>
      </div>
    </header>
  )
}

export default Header
