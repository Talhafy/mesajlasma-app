import { useState } from 'react';

export default function CallAvatar({ name, src, className = '' }: { name: string; src?: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('tr');
  return (
    <div className={`call-profile ${className}`}>
      {src && src !== failedUrl
        ? <img src={src} alt={`${name} profil fotoğrafı`} onError={() => setFailedUrl(src)} />
        : <span aria-label={name}>{initials || '?'}</span>}
    </div>
  );
}
