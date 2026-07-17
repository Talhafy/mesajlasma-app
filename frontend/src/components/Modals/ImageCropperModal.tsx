import React, { useState, useRef, useEffect } from 'react';
import './Modals.css';

interface ImageCropperModalProps {
  file: File;
  onClose: () => void;
  onCropComplete: (croppedFile: File) => void;
}

export default function ImageCropperModal({ file, onClose, onCropComplete }: ImageCropperModalProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 300, height: 300 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  
  // Refs for pinch-to-zoom on mobile
  const initialTouchDistance = useRef<number | null>(null);
  const initialTouchScale = useRef<number>(1);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }, [file]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth, naturalHeight } = img;
    
    // Resize image so the shorter side is 300px (fills the crop circle)
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

  // Mouse wheel zoom support (Desktop)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 0.08;
    const newScale = e.deltaY < 0 ? scale + zoomFactor : scale - zoomFactor;
    setScale(Math.max(1, Math.min(4, newScale)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;
    
    // Apply bounds so image doesn't slide completely off the circular crop area
    const maxBoundX = (imageSize.width * scale - 150) / 2;
    const maxBoundY = (imageSize.height * scale - 150) / 2;
    
    setPosition({
      x: Math.max(-maxBoundX, Math.min(maxBoundX, newX)),
      y: Math.max(-maxBoundY, Math.min(maxBoundY, newY))
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  // Touch support for mobile (Includes drag & pinch-to-zoom)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch to zoom started
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialTouchDistance.current = dist;
      initialTouchScale.current = scale;
    } else if (e.touches.length === 1) {
      // Single finger drag started
      setIsDragging(true);
      dragStart.current = {
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialTouchDistance.current !== null) {
      // Zooming with two fingers
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / initialTouchDistance.current;
      const newScale = initialTouchScale.current * factor;
      setScale(Math.max(1, Math.min(4, newScale)));
    } else if (isDragging && e.touches.length === 1) {
      // Dragging with one finger
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

  const handleTouchEnd = () => {
    setIsDragging(false);
    initialTouchDistance.current = null;
  };

  const handleSave = () => {
    if (!imageRef.current) return;
    
    const canvas = document.createElement('canvas');
    const exportSize = 400; // Output resolution 400x400
    canvas.width = exportSize;
    canvas.height = exportSize;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, exportSize, exportSize);
    
    // Translate origin to center of canvas
    ctx.translate(exportSize / 2, exportSize / 2);
    
    // Apply translation from panning, scaled to export size
    const scaleFactor = exportSize / 300;
    ctx.translate(position.x * scaleFactor, position.y * scaleFactor);
    
    // Apply zoom scale
    ctx.scale(scale, scale);
    
    // Draw the image centered
    const drawWidth = imageSize.width * scaleFactor;
    const drawHeight = imageSize.height * scaleFactor;
    ctx.drawImage(
      imageRef.current,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight
    );
    
    // Convert canvas to blob and upload
    canvas.toBlob((blob) => {
      if (blob) {
        // Change the extension of the original file name to .jpg to pass backend MIME validation
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
    <div className="cropper-overlay" onClick={onClose}>
      <div className="cropper-container" onClick={(e) => e.stopPropagation()}>
        <div className="cropper-header">
          <h3>Profil Resmini Ayarla</h3>
          <button className="cropper-close-btn" onClick={onClose}>✖</button>
        </div>
        
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
            {/* Circular cut-out overlay */}
            <div className="cropper-circle-mask" />
          </div>
        </div>

        <div className="cropper-footer">
          <button className="cropper-btn-secondary" onClick={onClose}>İptal</button>
          <button className="cropper-btn-primary" onClick={handleSave}>Kaydet</button>
        </div>
      </div>
    </div>
  );
}
