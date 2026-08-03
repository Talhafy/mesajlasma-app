import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('renders accessible text and invokes the click handler', async () => {
    const onClick = vi.fn();
    render(<Button text="Kaydet" variant="primary" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('supports icon-only labels and disabled state', async () => {
    const onClick = vi.fn();
    render(<Button icon={<span>+</span>} aria-label="Ekle" disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Ekle' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
