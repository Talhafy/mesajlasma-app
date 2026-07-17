import './Modals.css';

interface AvatarViewerModalProps {
  avatarUrl: string | null;
  username: string;
  onClose: () => void;
}

export default function AvatarViewerModal({ avatarUrl, username, onClose }: AvatarViewerModalProps) {
  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-container" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-image-wrapper">
          {avatarUrl ? (
            <img 
              className="viewer-image" 
              src={avatarUrl} 
              alt={username} 
            />
          ) : (
            <div 
              className="viewer-image" 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                background: '#f97316', 
                color: 'white', 
                fontSize: '120px', 
                fontWeight: 'bold',
                userSelect: 'none'
              }}
            >
              {username?.[0]?.toUpperCase()}
            </div>
          )}
          <button className="viewer-close-btn" onClick={onClose} title="Kapat">
            ✖
          </button>
        </div>
        <div className="viewer-title">{username}</div>
      </div>
    </div>
  );
}
