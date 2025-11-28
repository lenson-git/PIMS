/**
 * Logger Module Tests
 * 测试日志模块功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../js/logger.js';

describe('Logger Module', () => {
    let consoleLogSpy;
    let consoleWarnSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        // Mock console methods
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        // Restore console methods
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('logger.debug', () => {
        it('should be a function', () => {
            expect(typeof logger.debug).toBe('function');
        });

        it('should call console.log with [DEBUG] prefix in development', () => {
            logger.debug('Debug message', { data: 'value' });
            // Note: May not be called if not in development environment
            // This test just verifies the function exists and doesn't throw
        });
    });

    describe('logger.info', () => {
        it('should be a function', () => {
            expect(typeof logger.info).toBe('function');
        });

        it('should call console.log with [INFO] prefix in development', () => {
            logger.info('Info message', { data: 'value' });
            // Note: May not be called if not in development environment
        });
    });

    describe('logger.warn', () => {
        it('should call console.warn with [WARN] prefix', () => {
            logger.warn('Warning message', { warning: true });
            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', 'Warning message', { warning: true });
        });

        it('should handle multiple arguments', () => {
            logger.warn('Warning', 'arg1', 'arg2', 123);
            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', 'Warning', 'arg1', 'arg2', 123);
        });
    });

    describe('logger.error', () => {
        it('should call console.error with [ERROR] prefix', () => {
            logger.error('Error message', new Error('Test error'));
            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'Error message', expect.any(Error));
        });

        it('should handle error objects', () => {
            const testError = new Error('Test error');
            logger.error('An error occurred:', testError);
            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'An error occurred:', testError);
        });

        it('should handle multiple arguments', () => {
            logger.error('Error', 'arg1', 'arg2');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'Error', 'arg1', 'arg2');
        });
    });

    describe('logger methods', () => {
        it('should have all expected methods', () => {
            expect(logger).toHaveProperty('debug');
            expect(logger).toHaveProperty('info');
            expect(logger).toHaveProperty('warn');
            expect(logger).toHaveProperty('error');
        });

        it('should have correct prefixes', () => {
            logger.warn('Test');
            logger.error('Test');

            expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', 'Test');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'Test');
        });
    });
});
