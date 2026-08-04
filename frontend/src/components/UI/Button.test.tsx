import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button';

/**
 * Button bileşeni için birim (unit) test süiti.
 * Vitest ve React Testing Library kullanılarak bileşenin erişilebilirliği ve etkileşimleri doğrulanır.
 */
describe('Button Bileşeni Testleri', () => {
  /**
   * Test 1: Butonun erişilebilir metin etiketi ile ekrana çizildiğini 
   * ve tıklandığında `onClick` dinleyicisinin doğru şekilde çağrıldığını doğrular.
   */
  it('Erişilebilir metin ile ekrana çizilmeli ve tıklama olayını tetiklemeli', async () => {
    // Tıklama olayını izlemek için sahte (mock) bir fonksiyon oluşturulur
    const onClick = vi.fn();
    
    // Button bileşeni render edilir
    render(<Button text="Kaydet" variant="primary" onClick={onClick} />);
    
    // 'Kaydet' ismine sahip buton elemanı ekranda bulunarak tıklanır
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    
    // Tıklama fonksiyonunun tam olarak 1 kez çağrıldığı doğrulanır
    expect(onClick).toHaveBeenCalledOnce();
  });

  /**
   * Test 2: Sadece ikon içeren buton etiketlerini (aria-label) ve 
   * devre dışı (disabled) durumdaki butonun tıklanamama davranışını doğrular.
   */
  it('Sadece ikon içeren etiketleri ve devre dışı (disabled) durumunu desteklemeli', async () => {
    const onClick = vi.fn();
    
    // Devre dışı bırakılmış ve erişilebilirlik etiketi 'Ekle' olan ikon butonu render edilir
    render(<Button icon={<span>+</span>} aria-label="Ekle" disabled onClick={onClick} />);
    
    // Buton DOM elemanı getirilir
    const button = screen.getByRole('button', { name: 'Ekle' });
    
    // Butonun pasif (disabled) olduğu doğrulanır
    expect(button).toBeDisabled();
    
    // Pasif butona tıklanmaya çalışılır
    await userEvent.click(button);
    
    // Devre dışı buton tıklandığında onClick fonksiyonunun HİÇ çağrılmadığı doğrulanır
    expect(onClick).not.toHaveBeenCalled();
  });
});

