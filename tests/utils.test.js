import { describe, it, expect, beforeEach } from 'vitest';
import { escapeHtml, formatCurrency, getSettingName } from '../js/utils.js';

describe('utils', () => {
    describe('escapeHtml', () => {
        it('should escape special characters', () => {
            expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
            expect(escapeHtml('&')).toBe('&amp;');
        });

        it('should escape quotes', () => {
            expect(escapeHtml('"')).toBe('&quot;');
            expect(escapeHtml("'")).toBe('&#39;');
        });

        it('should handle empty input', () => {
            expect(escapeHtml('')).toBe('');
            expect(escapeHtml(null)).toBe('');
        });
    });

    describe('formatCurrency', () => {
        it('should format RMB/CNY', () => {
            expect(formatCurrency(100, 'RMB')).toBe('¥ 100.00');
            expect(formatCurrency(1234.56, 'CNY')).toBe('¥ 1,234.56');
        });

        it('should format THB', () => {
            expect(formatCurrency(100, 'THB')).toBe('฿ 100.00');
        });

        it('should handle other currencies', () => {
            expect(formatCurrency(100, 'USD')).toBe('USD 100.00');
        });

        it('should handle zero and null', () => {
            expect(formatCurrency(0)).toBe('¥ 0.00'); // Default is CNY/RMB logic in code? No, default is THB in code logic if not RMB/CNY?
            // Let's check code: default currency param is 'CNY'.
            // Code: const currencyUpper = (currency || 'THB').toUpperCase();
            // Wait, param default is 'CNY', but inside it says `(currency || 'THB')`.
            // If I pass undefined, it uses 'CNY'.
            // If I pass null, it uses 'THB'.

            // Let's verify default behavior
            expect(formatCurrency(0)).toBe('¥ 0.00');
            expect(formatCurrency(null)).toBe('0');
        });
    });

    describe('getSettingName', () => {
        beforeEach(() => {
            window._settingsCache = {
                shop: { 'S1': 'Shop 1' }
            };
        });

        it('should return name from cache', () => {
            expect(getSettingName('shop', 'S1')).toBe('Shop 1');
        });

        it('should return code if not found', () => {
            expect(getSettingName('shop', 'S2')).toBe('S2');
        });

        it('should return empty string for null code', () => {
            expect(getSettingName('shop', null)).toBe('');
        });
    });
});
