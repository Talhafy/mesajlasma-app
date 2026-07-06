import React from 'react';
import './Button.css';

interface ButtonProps {
  text?: React.ReactNode; // DÜZELTME: Artık sadece metin değil, her türlü React objesi (SVG vs.) alabilir
  icon?: React.ReactNode; // YENİ: Yazının yanına ikon eklemek için
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'danger' | 'outline' | 'ghost' | 'icon'; // YENİ: 'icon' varyasyonu
  size?: 'normal' | 'small' | 'large';
  fullWidth?: boolean;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties; // YENİ: Dışarıdan renk vb. müdahaleler için
}

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
  style
}: ButtonProps) {

  const btnClasses = `custom-btn ${variant} ${size === 'small' ? 'small' : ''} ${size === 'large' ? 'large' : ''} ${fullWidth ? 'full-width' : ''}`;

  return (
    <button
      type={type}
      className={btnClasses}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
    >
      {/* Eğer sol tarafa bir ikon verildiyse önce onu çiz */}
      {icon && <span className="btn-icon-wrapper">{icon}</span>}

      {/* Eğer text (yazı veya tekil SVG) varsa onu çiz */}
      {text && <span>{text}</span>}
    </button>
  );
}