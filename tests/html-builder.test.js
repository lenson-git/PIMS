import { describe, it, expect } from 'vitest';
import { safeHTML, buildAttrs, buildClass, buildStyle } from '../js/html-builder.js';

describe('html-builder', () => {
    describe('safeHTML', () => {
        it('should escape HTML in values', () => {
            const userInput = '<script>alert(1)</script>';
            const html = safeHTML`<div>${userInput}</div>`;
            expect(html).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
        });

        it('should handle numbers and booleans', () => {
            const num = 123;
            const bool = true;
            const html = safeHTML`<div>${num}-${bool}</div>`;
            expect(html).toBe('<div>123-true</div>');
        });

        it('should handle null and undefined', () => {
            const n = null;
            const u = undefined;
            const html = safeHTML`<div>${n}${u}</div>`;
            expect(html).toBe('<div></div>');
        });
    });

    describe('buildAttrs', () => {
        it('should build attributes string', () => {
            const attrs = { class: 'btn', id: 'submit' };
            expect(buildAttrs(attrs)).toBe('class="btn" id="submit"');
        });

        it('should escape attribute values', () => {
            const attrs = { 'data-val': '"quote"' };
            expect(buildAttrs(attrs)).toBe('data-val="&quot;quote&quot;"');
        });

        it('should ignore null/undefined values', () => {
            const attrs = { class: 'btn', disabled: null, checked: undefined };
            expect(buildAttrs(attrs)).toBe('class="btn"');
        });
    });

    describe('buildClass', () => {
        it('should join string classes', () => {
            expect(buildClass('btn', 'btn-primary')).toBe('btn btn-primary');
        });

        it('should handle conditional objects', () => {
            expect(buildClass('btn', { active: true, disabled: false })).toBe('btn active');
        });

        it('should ignore falsy values', () => {
            expect(buildClass('btn', null, undefined, '')).toBe('btn');
        });
    });

    describe('buildStyle', () => {
        it('should build style string', () => {
            expect(buildStyle({ color: 'red', fontSize: '14px' })).toBe('color: red; font-size: 14px');
        });

        it('should ignore null/undefined values', () => {
            expect(buildStyle({ color: 'red', display: null })).toBe('color: red');
        });
    });
});
