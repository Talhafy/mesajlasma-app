import React from 'react';
import './Button.css';

/**
 * Button bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface ButtonProps {
  /** Buton içerisinde görüntülenecek metin veya React bileşeni (SVG vs.) */
  text?: React.ReactNode;
  /** Buton yazısının sol tarafına yerleştirilecek ikon bileşeni */
  icon?: React.ReactNode;
  /** Butona tıklandığında çalıştırılacak fonksiyon */
  onClick?: () => void;
  /** HTML buton tipi: 'button', 'submit' veya 'reset' (Varsayılan: 'button') */
  type?: 'button' | 'submit' | 'reset';
  /** Butonun stil varyasyonu ('primary', 'danger', 'outline', 'ghost', 'icon') */
  variant?: 'primary' | 'danger' | 'outline' | 'ghost' | 'icon';
  /** Butonun boyut seçeneği ('normal', 'small', 'large') */
  size?: 'normal' | 'small' | 'large';
  /** Butonun bulunduğu kapsayıcının tüm genişliğini kaplamasını sağlar (true/false) */
  fullWidth?: boolean;
  /** Butonun etkileşime kapalı / pasif olma durumu (true/false) */
  disabled?: boolean;
  /** Fare üzerine geldiğinde gösterilecek araç ipucu (tooltip) metni */
  title?: string;
  /** Özel CSS stil müdahaleleri için stil nesnesi */
  style?: React.CSSProperties;
  /** Ekran okuyucular için erişilebilirlik (accessibility) etiketi */
  'aria-label'?: string;
}

/**
 * Uygulama genelinde kullanılan yeniden kullanılabilir ve özelleştirilebilir Buton bileşeni.
 * Farklı tema (variant), boyut (size), ikon ve tam genişlik (fullWidth) gibi özellikleri destekler.
 */
export default function Button({
  text,
  icon,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'normal',
  fullWidth = false,
  disabled = false,
  title,
  style,
  'aria-label': ariaLabel
}: ButtonProps) {

  // Prop verilerine göre birleştirilmiş dinamik CSS sınıflarını oluşturur
  const btnClasses = `custom-btn ${variant} ${size === 'small' ? 'small' : ''} ${size === 'large' ? 'large' : ''} ${fullWidth ? 'full-width' : ''}`;

  return (
    <button
      type={type}
      className={btnClasses}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      aria-label={ariaLabel}
    >
      {/* Eğer sol tarafa bir ikon verildiyse kapsayıcı span içerisinde çiz */}
      {icon && <span className="btn-icon-wrapper">{icon}</span>}

      {/* Eğer metin veya ana içerik tanımlandıysa span içerisinde çiz */}
      {text && <span>{text}</span>}
    </button>
  );
}