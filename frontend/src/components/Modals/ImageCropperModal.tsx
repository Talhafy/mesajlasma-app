import React, { useState, useRef, useEffect } from 'react';
import './Modals.css';

/**
 * ImageCropperModal bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface ImageCropperModalProps {
  /** Kırpılmak istenen ham resim dosyası (File nesnesi) */
  file: File;
  /** Modal kapatıldığında çalıştırılacak fonksiyon */
  onClose: () => void;
  /** Resim kırpma ve dönüştürme işlemi tamamlandığında kırpılmış File nesnesini aktaran geri çağırma (callback) fonksiyonu */
  onCropComplete: (croppedFile: File) => void;
}

/**
 * Profil resmi ve grup avatarı seçildiğinde resmi dairesel alana göre kaydırma (drag)
 * ve yakınlaştırma (zoom / pinch-to-zoom) yaparak kırpmayı sağlayan modal bileşeni.
 * Seçilen alanı HTML5 Canvas kullanarak 400x400 piksel JPEG formatına dönüştürür.
 */
export default function ImageCropperModal({ file, onClose, onCropComplete }: ImageCropperModalProps) {
  // --- DURUM DEĞİŞKENLERİ (STATE) ---
  /** FileReader ile okunan resmin Data URL formatındaki kaynağı */
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  /** Resmin mevcut yakınlaştırma oranı (Scale: 1 ile 4 arasında) */
  const [scale, setScale] = useState<number>(1);
  /** Resmin dairesel merkezden X ve Y eksenlerindeki kayma pozisyonu */
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Resmin kırpıcı alanına uyarlandıktan sonraki piksel genişlik ve yüksekliği */
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 300, height: 300 });
  /** Fare veya dokunma ile sürükleme işleminin aktif olup olmadığı */
  const [isDragging, setIsDragging] = useState<boolean>(false);
  
  // --- REFERANSLAR (REFS) ---
  /** Sürükleme başladığı andaki imleç koordinat farkını tutan referans */
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Görsel DOM elemanına doğrudan erişim referansı */
  const imageRef = useRef<HTMLImageElement | null>(null);
  
  /** Mobil cihazlarda iki parmakla yakınlaştırma (Pinch-to-Zoom) ilk parmak arası mesafesi */
  const initialTouchDistance = useRef<number | null>(null);
  /** Mobil yakınlaştırma başladığı andaki başlangıç yakınlaştırma ölçeği */
  const initialTouchScale = useRef<number>(1);

  // Dosya değiştiğinde yerel olarak okunup Data URL (base64) formatına dönüştürülmesi
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }, [file]);

  /**
   * Resim DOM'a yüklendiğinde boyutlarını hesaplar.
   * Kısa kenarı 300px (kırpma çemberi boyutu) olacak şekilde en-boy oranını koruyarak boyutlandırır.
   */
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth, naturalHeight } = img;
    
    let width = 300;
    let height = 300;
    
    if (naturalWidth > naturalHeight) {
      width = (naturalWidth / naturalHeight) * 300;
    } else {
      height = (naturalHeight / naturalWidth) * 300;
    }
    
    setImageSize({ width, height });
    setPosition({ x: 0, y: 0 });
    setScale(1);
  };

  /**
   * Masaüstü cihazlarda fare tekerleği (wheel) ile yakınlaştırma/uzaklaştırma mantığı.
   * Ölçeği min: 1, max: 4 sınırları arasında tutar.
   */
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 0.08;
    const newScale = e.deltaY < 0 ? scale + zoomFactor : scale - zoomFactor;
    setScale(Math.max(1, Math.min(4, newScale)));
  };

  /** Fare basıldığında sürükleme modunu başlatır */
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  /**
   * Fare hareket ettirildiğinde resmi kaydırır.
   * Resmin kırpma dairesinin dışına tamamen çıkmasını önlemek için sınır (bounds) kontrolü uygular.
   */
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;
    
    // Taşma sınırlarını hesaplama
    const maxBoundX = (imageSize.width * scale - 150) / 2;
    const maxBoundY = (imageSize.height * scale - 150) / 2;
    
    setPosition({
      x: Math.max(-maxBoundX, Math.min(maxBoundX, newX)),
      y: Math.max(-maxBoundY, Math.min(maxBoundY, newY))
    });
  };

  /** Fare bırakıldığında veya alan dışına çıktığında sürüklemeyi sonlandırır */
  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  /**
   * Mobil Dokunmatik Olaylar (Touch Events):
   * 1 Parmak -> Sürükleme (Drag)
   * 2 Parmak -> Çimdikleyerek Yakınlaştırma (Pinch-to-zoom)
   */
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // İki parmakla yakınlaştırma başladı
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialTouchDistance.current = dist;
      initialTouchScale.current = scale;
    } else if (e.touches.length === 1) {
      // Tek parmakla sürükleme başladı
      setIsDragging(true);
      dragStart.current = {
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y
      };
    }
  };

  /** Mobil cihazlarda dokunmatik hareket takibi */
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialTouchDistance.current !== null) {
      // İki parmak arası mesafe değişimine göre yakınlaştırma ölçeğini güncelle
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / initialTouchDistance.current;
      const newScale = initialTouchScale.current * factor;
      setScale(Math.max(1, Math.min(4, newScale)));
    } else if (isDragging && e.touches.length === 1) {
      // Tek parmak ile pozisyonu güncelle
      const newX = e.touches[0].clientX - dragStart.current.x;
      const newY = e.touches[0].clientY - dragStart.current.y;
      
      const maxBoundX = (imageSize.width * scale - 150) / 2;
      const maxBoundY = (imageSize.height * scale - 150) / 2;
      
      setPosition({
        x: Math.max(-maxBoundX, Math.min(maxBoundX, newX)),
        y: Math.max(-maxBoundY, Math.min(maxBoundY, newY))
      });
    }
  };

  /** Dokunma sona erdiğinde sürüleme durumunu sıfırla */
  const handleTouchEnd = () => {
    setIsDragging(false);
    initialTouchDistance.current = null;
  };

  /**
   * Kırpılan resmi Canvas üzerine çizip JPEG formatında dışa aktarır ve `onCropComplete`'e iletir.
   */
  const handleSave = () => {
    if (!imageRef.current) return;
    
    // Dışa aktarım için görünmez bir canvas oluştur
    const canvas = document.createElement('canvas');
    const exportSize = 400; // Çıktı çözünürlüğü: 400x400px
    canvas.width = exportSize;
    canvas.height = exportSize;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    // Canvas temizliği
    ctx.clearRect(0, 0, exportSize, exportSize);
    
    // Orijini canvas merkezine taşı
    ctx.translate(exportSize / 2, exportSize / 2);
    
    // Sürükleme kayma miktarlarını dışa aktarım boyutuna (400px) oranlayarak uygula
    const scaleFactor = exportSize / 300;
    ctx.translate(position.x * scaleFactor, position.y * scaleFactor);
    
    // Büyütme ölçeğini uygula
    ctx.scale(scale, scale);
    
    // Resmi merkezlenmiş şekilde canvas'a çiz
    const drawWidth = imageSize.width * scaleFactor;
    const drawHeight = imageSize.height * scaleFactor;
    ctx.drawImage(
      imageRef.current,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight
    );
    
    // Canvas içeriğini JPEG Blob nesnesine dönüştür ve backend uzantı doğrulamasını geçmek için .jpg dosyası oluştur
    canvas.toBlob((blob) => {
      if (blob) {
        const dotIndex = file.name.lastIndexOf('.');
        const originalBaseName = dotIndex !== -1 ? file.name.substring(0, dotIndex) : file.name;
        const croppedFileName = `${originalBaseName || 'avatar'}.jpg`;

        const croppedFile = new File([blob], croppedFileName, {
          type: 'image/jpeg',
          lastModified: Date.now()
        });
        onCropComplete(croppedFile);
      }
    }, 'image/jpeg', 0.9);
  };

  return (
    // Karartılmış Modal Arka Plan Katmanı
    <div className="cropper-overlay" onClick={onClose}>
      {/* Modal Pencere Kapsayıcısı */}
      <div className="cropper-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Üst Başlık */}
        <div className="cropper-header">
          <h3>Profil Resmini Ayarla</h3>
          <button className="cropper-close-btn" onClick={onClose}>✖</button>
        </div>
        
        {/* Kırpma Çalışma Alanı Kapsayıcısı */}
        <div className="cropper-workspace-wrapper">
          <div 
            className="cropper-workspace"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUpOrLeave}
            onMouseLeave={handleMouseUpOrLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
          >
            {/* Düzenlenen Resim */}
            {imageSrc && (
              <img
                ref={imageRef}
                src={imageSrc}
                alt="Düzenlenen Görsel"
                onLoad={handleImageLoad}
                style={{
                  width: `${imageSize.width}px`,
                  height: `${imageSize.height}px`,
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: 'center center',
                  cursor: 'move',
                  userSelect: 'none',
                  pointerEvents: 'none'
                }}
              />
            )}
            {/* Dairesel Kırpma Maskesi (Ortası şeffaf, etrafı yarı saydam maske) */}
            <div className="cropper-circle-mask" />
          </div>
        </div>

        {/* Modal Alt Butonlar */}
        <div className="cropper-footer">
          <button className="cropper-btn-secondary" onClick={onClose}>İptal</button>
          <button className="cropper-btn-primary" onClick={handleSave}>Kaydet</button>
        </div>
      </div>
    </div>
  );
}

