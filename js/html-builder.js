/**
 * HTML 安全构建工具
 * 提供安全的 HTML 字符串构建功能，自动转义用户输入
 */

import { escapeHtml } from './utils.js';

/**
 * 安全的 HTML 模板标签函数
 * 自动转义所有插值，防止 XSS 攻击
 * 
 * @example
 * const userName = '<script>alert("xss")</script>';
 * const html = safeHTML`<div>Hello ${userName}</div>`;
 * // 结果: <div>Hello &lt;script&gt;alert("xss")&lt;/script&gt;</div>
 */
export function safeHTML(strings, ...values) {
    return strings.reduce((result, str, i) => {
        const value = values[i];

        // 如果值是 undefined 或 null，使用空字符串
        if (value === undefined || value === null) {
            return result + str;
        }

        // 如果值是数字或布尔值，直接转换
        if (typeof value === 'number' || typeof value === 'boolean') {
            return result + str + value;
        }

        // 字符串需要转义
        const escaped = escapeHtml(String(value));
        return result + str + escaped;
    }, '');
}

/**
 * 不转义的 HTML 模板标签函数（谨慎使用）
 * 仅在确定内容安全时使用
 * 
 * @example
 * const safeContent = '<strong>Bold</strong>';
 * const html = rawHTML`<div>${safeContent}</div>`;
 */
export function rawHTML(strings, ...values) {
    return strings.reduce((result, str, i) => {
        const value = values[i] || '';
        return result + str + value;
    }, '');
}

/**
 * 构建安全的属性字符串
 * 
 * @param {Object} attrs - 属性对象
 * @returns {string} 属性字符串
 * 
 * @example
 * const attrs = buildAttrs({ class: 'btn', 'data-id': '<script>' });
 * // 结果: class="btn" data-id="&lt;script&gt;"
 */
export function buildAttrs(attrs) {
    return Object.entries(attrs)
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
            const escapedValue = escapeHtml(String(value));
            return `${key}="${escapedValue}"`;
        })
        .join(' ');
}

/**
 * 构建安全的 class 字符串
 * 
 * @param {...(string|Object)} classes - class 名称或条件对象
 * @returns {string} class 字符串
 * 
 * @example
 * const cls = buildClass('btn', { active: true, disabled: false });
 * // 结果: "btn active"
 */
export function buildClass(...classes) {
    const result = [];

    classes.forEach(cls => {
        if (!cls) return;

        if (typeof cls === 'string') {
            result.push(cls);
        } else if (typeof cls === 'object') {
            Object.entries(cls).forEach(([name, condition]) => {
                if (condition) result.push(name);
            });
        }
    });

    return result.join(' ');
}

/**
 * 构建安全的 style 字符串
 * 
 * @param {Object} styles - 样式对象
 * @returns {string} style 字符串
 * 
 * @example
 * const style = buildStyle({ color: 'red', fontSize: '14px' });
 * // 结果: "color: red; font-size: 14px"
 */
export function buildStyle(styles) {
    return Object.entries(styles)
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
            // 转换驼峰命名为短横线命名
            const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}: ${value}`;
        })
        .join('; ');
}

// 暴露到全局，供非模块脚本使用
if (typeof window !== 'undefined') {
    window.safeHTML = safeHTML;
    window.rawHTML = rawHTML;
    window.buildAttrs = buildAttrs;
    window.buildClass = buildClass;
    window.buildStyle = buildStyle;
}
