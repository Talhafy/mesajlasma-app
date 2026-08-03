import { describe, expect, it, vi } from 'vitest';
import { AppError, respondWithError } from '../../src/errors/AppError';
import { errorHandler } from '../../src/middleware/errorHandler';

describe('AppError unit tests', () => {
  it('should instantiate AppError with correct properties', () => {
    const err = new AppError('CONVERSATION_FORBIDDEN', 'Bu sohbete erişim yetkiniz yok.', 403);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CONVERSATION_FORBIDDEN');
    expect(err.message).toBe('Bu sohbete erişim yetkiniz yok.');
    expect(err.statusCode).toBe(403);
    expect(err.isOperational).toBe(true);
  });

  it('should create AppError via static factory methods', () => {
    const notFound = AppError.notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe('MESSAGE_NOT_FOUND');

    const forbidden = AppError.forbidden('ASSET_NOT_OWNED', 'Yalnızca kendi yüklediğiniz dosyayı kullanabilirsiniz.');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.code).toBe('ASSET_NOT_OWNED');

    const validation = AppError.validation('Geçersiz veri biçimi.');
    expect(validation.statusCode).toBe(400);
    expect(validation.code).toBe('VALIDATION_ERROR');
  });

  it('should format JSON response in respondWithError helper', () => {
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = { status: statusMock } as any;

    const err = AppError.forbidden('CONVERSATION_FORBIDDEN', 'Erişim engellendi.');
    respondWithError(res, err);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Erişim engellendi.',
      code: 'CONVERSATION_FORBIDDEN'
    });
  });

  it('should handle unhandled Error in respondWithError helper', () => {
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const res = { status: statusMock } as any;

    respondWithError(res, new Error('Bilinmeyen hata'), 'Varsayılan hata');

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Bilinmeyen hata',
      code: 'INTERNAL_ERROR'
    });
  });

  it('errorHandler middleware should handle AppError correctly', () => {
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    const req = { id: 'req-123', method: 'GET', originalUrl: '/test', ip: '127.0.0.1' } as any;
    const res = { status: statusMock, headersSent: false } as any;
    const next = vi.fn();

    const appErr = AppError.notFound('USER_NOT_FOUND', 'Kullanıcı bulunamadı.');
    errorHandler(appErr, req, res, next);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Kullanıcı bulunamadı.',
      code: 'USER_NOT_FOUND'
    });
  });
});
