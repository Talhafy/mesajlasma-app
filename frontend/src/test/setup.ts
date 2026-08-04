/**
 * Vitest ve React Testing Library ortamı için küresel (global) test yapılandırma dosyası.
 */

// React Testing Library için ek DOM eşleştiricilerini (toBeInTheDocument, toBeDisabled vb.) Vitest'e dahil eder
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Her bir test senaryosundan sonra DOM'da kalan sahte bileşenleri temizler (bellek sızıntısını önler)
afterEach(() => cleanup());

