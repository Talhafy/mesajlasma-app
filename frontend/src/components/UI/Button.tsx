import React from 'react';
import './Button.css';

interface ButtonProps {
  text: string;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'danger' | 'outline' | 'ghost'; // YENİ VARYASYONLAR EKLENDİ
  size?: 'normal' | 'small'; // YENİ BOYUT EKLENDİ
  fullWidth?: boolean;
  disabled?: boolean;
  title?: string; // YENİ: İkon butonlarının üzerine gelince çıkan yazı
}

export default function Button({
  text,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'normal',
  fullWidth = false,
  disabled = false,
  title
}: ButtonProps) {
  
  // Tüm class'ları dinamik olarak birleştiriyoruz
  const btnClasses = `custom-btn ${variant} ${size === 'small' ? 'small' : ''} ${fullWidth ? 'full-width' : ''}`;

  return (
    <button
      type={type}
      className={btnClasses}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {text}
    </button>
  );
}