import type { SVGProps } from 'react';

type IconName = 'camera' | 'camera-off' | 'mic' | 'mic-off' | 'phone' | 'hangup' | 'share' | 'users' | 'expand' | 'collapse' | 'chevron' | 'close';

export default function CallIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    camera: <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></>,
    'camera-off': <><path d="M10 6h3a2 2 0 0 1 2 2v2l6-3v10l-3-1.5M15 15v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8c0-.6.3-1.2.7-1.6M3 3l18 18" /></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6" /></>,
    'mic-off': <><path d="M9 5V4a3 3 0 0 1 6 0v7M9 9v3a3 3 0 0 0 5 2M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-3 0h6M3 3l18 18" /></>,
    phone: <path d="m7 3 3 5-3 2a14 14 0 0 0 7 7l2-3 5 3v3a1 1 0 0 1-1 1C10 21 3 14 3 4a1 1 0 0 1 1-1Z" />,
    hangup: <path d="M3 16v-4c5-5 13-5 18 0v4l-5-1v-3a13 13 0 0 0-8 0v3Z" fill="currentColor" strokeLinejoin="round" />,
    share: <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M1 21h22M12 13V7m-3 3 3-3 3 3" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3ZM16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></>,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    collapse: <path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
