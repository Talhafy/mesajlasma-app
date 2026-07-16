interface EmptyChatStateProps {
  panelBg: string;
  textColor: string;
  iconColor: string;
}

export default function EmptyChatState({ panelBg, textColor, iconColor }: EmptyChatStateProps) {
  return (
    <div className="chat-area empty-chat-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: panelBg }}>
      <div className="welcome-logo-container" style={{ marginBottom: '28px', opacity: 0.85 }}>
        <svg className="brand-logo-svg" viewBox="0 0 100 100" width="300" height="300" style={{ display: 'block', margin: '0 auto' }}>
          <defs>
            <filter id="lightning-fractal-welcome" x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>

          {/* Multiple cascading lightning bolts deformed by the fractal noise */}
          <g filter="url(#lightning-fractal-welcome)" strokeLinecap="round" strokeLinejoin="round">
            <path className="old-lightning-hair" d="M26 35 L18 52 L28 68 L16 88" fill="none" strokeWidth="2.2" />
            <path className="old-lightning-hair" d="M42 35 L38 52 L48 68 L36 88" fill="none" strokeWidth="2.2" />
            <path className="old-lightning-hair" d="M58 35 L62 52 L54 68 L64 88" fill="none" strokeWidth="2.2" />
            <path className="old-lightning-hair" d="M74 35 L82 52 L72 68 L80 88" fill="none" strokeWidth="2.2" />
          </g>

          {/* Cloud shape with a WhatsApp-style message bubble tail (flashes on strike) */}
          <path className="brand-cloud" d="M20 32 C 20 20, 35 15, 50 20 C 65 15, 80 20, 80 32 C 92 32, 95 42, 85 49 C 75 53, 35 53, 28 52 L 12 65 C 12 65, 18 57, 18 49 C 5 42, 8 32, 20 32 Z" />

          {/* Smiling face elements inside/emerging from the cloud */}
          <circle className="discord-face-element" cx="38" cy="30" r="3" fill="#ffffff" />
          <circle className="discord-face-element" cx="62" cy="30" r="3" fill="#ffffff" />
          <path className="discord-face-element" d="M42 37 Q50 43 58 37" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="empty-chat-box" style={{ color: textColor, fontWeight: 300 }}>Mesajlaşmaya Başla</h2>
      <p style={{ color: iconColor, marginTop: '10px' }}>Sohbet etmek için sol taraftan bir kişi veya grup seçin.</p>
    </div>
  );
}
