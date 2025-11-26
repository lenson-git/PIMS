/**
 * PIMS 动画系统 JavaScript 工具库 v1.0
 * 基于 Web应用动画系统实施规范
 * 创建时间: 2025-11-26
 */

/* ============================================
   1. 中心加载动画
   ============================================ */

/**
 * 显示全局加载动画
 * @param {string} message - 加载提示文字
 */
export function showLoading(message = '加载中...') {
    let overlay = document.getElementById('loading-overlay');

    if (!overlay) {
        // 如果不存在,创建加载遮罩
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text">${message}</div>
    `;
        document.body.appendChild(overlay);
    } else {
        // 更新文字
        const textEl = overlay.querySelector('.loading-text');
        if (textEl) textEl.textContent = message;
    }

    // 显示遮罩
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
}

/**
 * 隐藏全局加载动画
 */
export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/* ============================================
   2. 顶部进度条
   ============================================ */

let progressInterval = null;

/**
 * 显示进度条
 * @param {number} percent - 进度百分比 (0-100)
 */
export function showProgress(percent = 0) {
    let container = document.getElementById('progress-bar-container');

    if (!container) {
        // 创建进度条容器
        container = document.createElement('div');
        container.id = 'progress-bar-container';
        container.className = 'progress-bar-container';
        container.innerHTML = '<div class="progress-bar" id="progress-bar"></div>';
        document.body.appendChild(container);
    }

    const bar = document.getElementById('progress-bar');
    container.classList.add('active');

    if (bar) {
        bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
}

/**
 * 隐藏进度条
 */
export function hideProgress() {
    const container = document.getElementById('progress-bar-container');
    if (container) {
        // 先设置到100%
        const bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = '100%';

        // 延迟隐藏,让用户看到完成状态
        setTimeout(() => {
            container.classList.remove('active');
            // 重置进度
            setTimeout(() => {
                if (bar) bar.style.width = '0%';
            }, 300);
        }, 200);
    }

    // 清除自动进度
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

/**
 * 自动进度(模拟进度,适用于无法获取真实进度的场景)
 * @param {number} duration - 总时长(毫秒)
 */
export function autoProgress(duration = 2000) {
    showProgress(0);

    const bar = document.getElementById('progress-bar');
    if (bar) {
        bar.classList.add('auto');

        setTimeout(() => {
            bar.classList.remove('auto');
        }, duration);
    }
}

/* ============================================
   3. Toast 提示框
   ============================================ */

/**
 * 确保 Toast 容器存在
 */
function ensureToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

/**
 * 显示 Toast 提示
 * @param {string} type - 类型: success/error/warning/info
 * @param {string} message - 提示消息
 * @param {number} duration - 显示时长(毫秒)
 */
function showToast(type, message, duration = 3000) {
    const container = ensureToastContainer();

    // 图标SVG
    const icons = {
        success: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
        error: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
        warning: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
        info: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
    ${icons[type] || ''}
    <span>${message}</span>
  `;

    container.appendChild(toast);

    // 触发动画
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // 自动移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * 显示成功提示
 * @param {string} message - 提示消息
 * @param {number} duration - 显示时长(毫秒)
 */
export function showSuccess(message, duration = 3000) {
    showToast('success', message, duration);
}

/**
 * 显示错误提示
 * @param {string} message - 提示消息
 * @param {number} duration - 显示时长(毫秒)
 */
export function showError(message, duration = 5000) {
    console.error(message);
    showToast('error', message, duration);
}

/**
 * 显示警告提示
 * @param {string} message - 提示消息
 * @param {number} duration - 显示时长(毫秒)
 */
export function showWarning(message, duration = 4000) {
    showToast('warning', message, duration);
}

/**
 * 显示信息提示
 * @param {string} message - 提示消息
 * @param {number} duration - 显示时长(毫秒)
 */
export function showInfo(message, duration = 3000) {
    showToast('info', message, duration);
}

/* ============================================
   4. 列表动画
   ============================================ */

/**
 * 高亮行
 * @param {HTMLElement} element - 要高亮的元素
 */
export function highlightRow(element) {
    if (!element) return;

    element.classList.remove('row-highlight');
    // 强制重排以重新触发动画
    void element.offsetWidth;
    element.classList.add('row-highlight');
}

/**
 * 删除行(带滑出动画)
 * @param {HTMLElement} element - 要删除的元素
 * @param {Function} callback - 删除完成后的回调
 */
export function removeRow(element, callback) {
    if (!element) return;

    element.classList.add('row-removing');

    setTimeout(() => {
        element.remove();
        if (callback) callback();
    }, 300);
}

/* ============================================
   5. 表单动画
   ============================================ */

/**
 * 抖动元素(用于错误提示)
 * @param {HTMLElement} element - 要抖动的元素
 */
export function shakeElement(element) {
    if (!element) return;

    element.classList.remove('shake');
    void element.offsetWidth;
    element.classList.add('shake');

    // 移除类,以便可以再次触发
    setTimeout(() => {
        element.classList.remove('shake');
    }, 400);
}

/**
 * 显示成功勾选动画
 * @param {HTMLElement} container - 容器元素
 * @param {Function} callback - 动画完成后的回调
 */
export function showCheckmark(container, callback) {
    if (!container) return;

    const checkmarkHTML = `
    <div class="checkmark-container">
      <svg class="checkmark" viewBox="0 0 52 52">
        <circle class="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
        <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
      </svg>
    </div>
  `;

    container.innerHTML = checkmarkHTML;

    // 动画完成后回调
    if (callback) {
        setTimeout(callback, 1200);
    }
}

/* ============================================
   6. 工具函数
   ============================================ */

/**
 * 等待动画完成
 * @param {HTMLElement} element - 元素
 * @returns {Promise} Promise对象
 */
export function waitForAnimation(element) {
    return new Promise(resolve => {
        const onAnimationEnd = () => {
            element.removeEventListener('animationend', onAnimationEnd);
            resolve();
        };
        element.addEventListener('animationend', onAnimationEnd);
    });
}

/**
 * 检查用户是否偏好减少动画
 * @returns {boolean} 是否偏好减少动画
 */
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 添加涟漪效果到按钮
 * @param {HTMLElement} button - 按钮元素
 */
export function addRippleEffect(button) {
    if (!button || button.classList.contains('btn-ripple')) return;

    button.classList.add('btn-ripple');
}

/**
 * 批量添加涟漪效果
 * @param {string} selector - CSS选择器
 */
export function addRippleEffectToAll(selector = '.btn') {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(button => addRippleEffect(button));
}

/* ============================================
   7. 图片加载动画
   ============================================ */

/**
 * 设置图片加载动画
 * @param {HTMLImageElement} img - 图片元素
 */
export function setupImageLoading(img) {
    if (!img) return;

    img.addEventListener('load', function () {
        this.classList.add('loaded');
        // 移除骨架屏
        const skeleton = this.previousElementSibling;
        if (skeleton && skeleton.classList.contains('skeleton-image')) {
            setTimeout(() => skeleton.remove(), 300);
        }
    });
}

/**
 * 批量设置图片加载动画
 * @param {string} selector - CSS选择器
 */
export function setupAllImageLoading(selector = 'img[loading="lazy"]') {
    const images = document.querySelectorAll(selector);
    images.forEach(img => setupImageLoading(img));
}

/* ============================================
   8. 初始化
   ============================================ */

/**
 * 初始化动画系统
 */
export function initAnimations() {
    // 添加按钮涟漪效果
    addRippleEffectToAll('.btn');

    // 设置图片加载动画
    setupAllImageLoading();

    console.log('[动画系统] 初始化完成');
}

// 自动初始化(如果DOM已加载)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnimations);
} else {
    initAnimations();
}

/* ============================================
   9. 导出全局函数(兼容现有代码)
   ============================================ */

// 将函数挂载到window对象,方便现有代码调用
if (typeof window !== 'undefined') {
    window.showLoading = showLoading;
    window.hideLoading = hideLoading;
    window.showProgress = showProgress;
    window.hideProgress = hideProgress;
    window.autoProgress = autoProgress;
    window.showSuccess = showSuccess;
    window.showError = showError;
    window.showWarning = showWarning;
    window.showInfo = showInfo;
    window.highlightRow = highlightRow;
    window.removeRow = removeRow;
    window.shakeElement = shakeElement;
    window.showCheckmark = showCheckmark;
}
