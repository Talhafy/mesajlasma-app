import './Modals.css';

/**
 * AvatarViewerModal bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface AvatarViewerModalProps {
  /** Görüntülenecek avatar resminin URL adresi (resim yüklü değilse null) */
  avatarUrl: string | null;
  /** Avatarı gösterilen kullanıcının adı */
  username: string;
  /** Modal kapatılmak istendiğinde tetiklenecek geri çağırma (callback) fonksiyonu */
  onClose: () => void;
}

/**
 * Kullanıcı veya grup avatarlarını büyük ekranda / tam boyutta görüntülemeyi sağlayan modal bileşeni.
 * Profil resmi mevcut değilse kullanıcının adının ilk harfini turuncu bir daire içinde görüntüler.
 */
export default function AvatarViewerModal({ avatarUrl, username, onClose }: AvatarViewerModalProps) {
  return (
    // Arka plan karartma katmanı (Overlay). Dışarı tıklandığında modalı kapatır.
    <div className="viewer-overlay" onClick={onClose} style={{ zIndex: 200000 }}>
      {/* Modal kapsayıcısı. İçeriğe tıklandığında dış katman onClick olayının tetiklenmesini engeller. */}
      <div className="viewer-container" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-image-wrapper">
          {/* Kullanıcının profil resmi varsa img etiketi ile, yoksa isim baş harfi ile gösterilir */}
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
          {/* Resim üzerindeki modal kapatma butonu */}
          <button className="viewer-close-btn" onClick={onClose} title="Kapat">
            ✖
          </button>
        </div>
        {/* Avatarın altında yer alan kullanıcı ismi */}
        <div className="viewer-title">{username}</div>
      </div>
    </div>
  );
}

