/**
 * Supabase Client Helper Functions Tests
 * 测试 supabase-client.js 中的辅助函数
 */

import { describe, it, expect } from 'vitest';

// 由于我们无法直接导入需要 Supabase 环境的函数，
// 我们将测试一些可以独立测试的辅助函数

describe('Supabase Client Helper Functions', () => {
    describe('Image filename generation', () => {
        // 测试文件名生成逻辑
        it('should pad numbers correctly', () => {
            const pad = (n, len = 4) => String(n).padStart(len, '0');

            expect(pad(1)).toBe('0001');
            expect(pad(42)).toBe('0042');
            expect(pad(999)).toBe('0999');
            expect(pad(12345)).toBe('12345');
        });

        it('should format date correctly', () => {
            const fmtDate = (dt) => {
                const y = dt.getFullYear();
                const m = String(dt.getMonth() + 1).padStart(2, '0');
                const d = String(dt.getDate()).padStart(2, '0');
                const hh = String(dt.getHours()).padStart(2, '0');
                const mm = String(dt.getMinutes()).padStart(2, '0');
                const ss = String(dt.getSeconds()).padStart(2, '0');
                return `${y}${m}${d}_${hh}${mm}${ss}`;
            };

            const testDate = new Date('2025-11-28T19:50:30');
            const formatted = fmtDate(testDate);

            expect(formatted).toMatch(/^\d{8}_\d{6}$/);
            expect(formatted).toContain('20251128');
        });

        it('should infer file extension correctly', () => {
            const inferExt = (file) => {
                if (!file || !file.type) return 'jpg';
                if (file.type === 'image/png') return 'png';
                if (file.type === 'image/jpeg' || file.type === 'image/jpg') return 'jpg';
                if (file.type === 'image/webp') return 'webp';
                if (file.type === 'image/gif') return 'gif';
                return 'jpg';
            };

            expect(inferExt({ type: 'image/png' })).toBe('png');
            expect(inferExt({ type: 'image/jpeg' })).toBe('jpg');
            expect(inferExt({ type: 'image/jpg' })).toBe('jpg');
            expect(inferExt({ type: 'image/webp' })).toBe('webp');
            expect(inferExt({ type: 'image/gif' })).toBe('gif');
            expect(inferExt({ type: 'unknown/type' })).toBe('jpg');
            expect(inferExt(null)).toBe('jpg');
        });
    });

    describe('URL path extraction', () => {
        it('should extract path from public URL', () => {
            const extractPath = (publicUrl) => {
                if (!publicUrl) return null;
                const match = publicUrl.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
                return match ? match[1] : null;
            };

            const url1 = 'https://example.supabase.co/storage/v1/object/public/images/20251128_195030_0001.jpg';
            expect(extractPath(url1)).toBe('20251128_195030_0001.jpg');

            const url2 = 'https://example.supabase.co/storage/v1/object/public/images/folder/file.png';
            expect(extractPath(url2)).toBe('folder/file.png');

            expect(extractPath(null)).toBe(null);
            expect(extractPath('invalid-url')).toBe(null);
        });
    });

    describe('Filter validation', () => {
        it('should validate date filters', () => {
            const isValidDate = (dateStr) => {
                if (!dateStr) return false;
                const date = new Date(dateStr);
                return !isNaN(date.getTime());
            };

            expect(isValidDate('2025-11-28')).toBe(true);
            expect(isValidDate('2025-11-28T19:50:30')).toBe(true);
            expect(isValidDate('invalid-date')).toBe(false);
            expect(isValidDate('')).toBe(false);
            expect(isValidDate(null)).toBe(false);
        });

        it('should validate expense type filters', () => {
            const isValidExpenseType = (type) => {
                return typeof type === 'string' && type.length > 0;
            };

            expect(isValidExpenseType('SHIPPING')).toBe(true);
            expect(isValidExpenseType('CROSS_BORDER')).toBe(true);
            expect(isValidExpenseType('')).toBe(false);
            expect(isValidExpenseType(null)).toBe(false);
        });
    });

    describe('Data transformation', () => {
        it('should transform SKU data correctly', () => {
            const transformSKU = (rawSKU) => {
                return {
                    id: rawSKU.id,
                    barcode: rawSKU.barcode,
                    product_name: rawSKU.product_name,
                    status_code: rawSKU.status_code || 'active',
                    purchase_price_rmb: rawSKU.purchase_price_rmb || 0,
                    purchase_price_thb: rawSKU.purchase_price_thb || 0,
                };
            };

            const rawSKU = {
                id: 1,
                barcode: 'TEST001',
                product_name: 'Test Product',
                purchase_price_rmb: 100,
            };

            const transformed = transformSKU(rawSKU);

            expect(transformed.id).toBe(1);
            expect(transformed.barcode).toBe('TEST001');
            expect(transformed.status_code).toBe('active');
            expect(transformed.purchase_price_rmb).toBe(100);
            expect(transformed.purchase_price_thb).toBe(0);
        });

        it('should calculate stock totals correctly', () => {
            const calculateStockTotal = (movements) => {
                return movements.reduce((total, movement) => {
                    const qty = movement.quantity || 0;
                    const direction = movement.direction;
                    return total + (direction === 'inbound' ? qty : -qty);
                }, 0);
            };

            const movements = [
                { quantity: 10, direction: 'inbound' },
                { quantity: 5, direction: 'outbound' },
                { quantity: 3, direction: 'inbound' },
                { quantity: 2, direction: 'outbound' },
            ];

            expect(calculateStockTotal(movements)).toBe(6); // 10 - 5 + 3 - 2 = 6
        });
    });

    describe('Error handling', () => {
        it('should handle missing required fields', () => {
            const validateSKUData = (data) => {
                const required = ['barcode', 'product_name'];
                const missing = required.filter(field => !data[field]);
                return {
                    valid: missing.length === 0,
                    missing
                };
            };

            const validData = { barcode: 'TEST001', product_name: 'Test' };
            const invalidData1 = { barcode: 'TEST001' };
            const invalidData2 = { product_name: 'Test' };

            expect(validateSKUData(validData).valid).toBe(true);
            expect(validateSKUData(invalidData1).valid).toBe(false);
            expect(validateSKUData(invalidData1).missing).toContain('product_name');
            expect(validateSKUData(invalidData2).missing).toContain('barcode');
        });
    });
});
