/**
 * Web应用动画系统实施规范 v1.0
 * 动画工具库
 */

// ==========================================
// 基础工具
// ==========================================

/**
 * 检查用户是否开启了减弱动画模式
 */
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 等待动画结束
 * @param {HTMLElement} element 
 * @returns {Promise}
 */
export function waitForAnimation(element) {
    if (prefersReducedMotion()) return Promise.resolve();

    return Promise.allSettled(
        element.getAnimations().map(animation => animation.finished)
    );
}

// ==========================================
// 1. 中心加载动画
// ==========================================

let loadingOverlay = null;

function ensureLoadingOverlay() {
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-message">加载中...</div>
            </div>
        `;
        document.body.appendChild(loadingOverlay);
    }
    return loadingOverlay;
}

/**
 * 显示全屏加载动画
 * @param {string} message - 可选的加载提示信息
 */
export function showLoading(message = '加载中...') {
    const overlay = ensureLoadingOverlay();
    const messageEl = overlay.querySelector('.loading-message');
    if (messageEl) messageEl.textContent = message;
    overlay.classList.add('active');
}

/**
 * 隐藏全屏加载动画
 */
export function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
        // 动画结束后隐藏 display: none 由 CSS transition 处理
        setTimeout(() => {
            if (!loadingOverlay.classList.contains('active')) {
                loadingOverlay.style.display = ''; // 重置为 CSS 定义的样式
            }
        }, 300);
    }
}

// ==========================================
// 2. 顶部进度条
// ==========================================

let progressBarContainer = null;
let progressBar = null;

function ensureProgressBar() {
    if (!progressBarContainer) {
        progressBarContainer = document.createElement('div');
        progressBarContainer.className = 'progress-bar-container';
        progressBarContainer.innerHTML = '<div class="progress-bar"></div>';
        document.body.appendChild(progressBarContainer);
        progressBar = progressBarContainer.querySelector('.progress-bar');
    }
    return { container: progressBarContainer, bar: progressBar };
}

/**
 * 显示进度条
 * @param {number} percent - 进度百分比 (0-100)
 */
export function showProgress(percent) {
    const { container, bar } = ensureProgressBar();
    container.classList.add('active');
    requestAnimationFrame(() => {
        bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    });
}

/**
 * 隐藏进度条
 */
export function hideProgress() {
    if (progressBarContainer) {
        progressBarContainer.classList.remove('active');
        setTimeout(() => {
            if (progressBar) progressBar.style.width = '0%';
        }, 300);
    }
}

/**
 * 自动进度条 (模拟)
 * @param {number} duration - 预计持续时间 (ms)
 */
export function autoProgress(duration = 2000) {
    showProgress(0);
    let start = null;

    function step(timestamp) {
        if (!start) start = timestamp;
        const progress = timestamp - start;
        const percent = Math.min((progress / duration) * 90, 90); // 最多到 90%

        showProgress(percent);

        if (progress < duration) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

// ==========================================
// 3. Toast 提示
// ==========================================

let toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

function createToast(message, type = 'info', duration = 3000) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    // 图标映射
    const icons = {
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    toast.innerHTML = `
        ${icons[type] || ''}
        <span class="toast-text">${message}</span>
        <button class="toast-close" aria-label="关闭">×</button>
    `;

    // 添加关闭按钮事件
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
        closeBtn.onclick = () => removeToast(toast);
    }

    container.appendChild(toast);

    // 触发重绘以激活动画
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // 自动移除
    if (duration > 0) {
        setTimeout(() => {
            removeToast(toast);
        }, duration);
    }

    return toast;
}

function removeToast(toast) {
    toast.classList.remove('show');
    waitForAnimation(toast).then(() => {
        if (toast.parentElement) toast.remove();
    });
}

export function showSuccess(message, duration = 3000) {
    return createToast(message, 'success', duration);
}

export function showError(message, duration = 5000) {
    return createToast(message, 'error', duration);
}

export function showWarning(message, duration = 4000) {
    return createToast(message, 'warning', duration);
}

export function showInfo(message, duration = 3000) {
    return createToast(message, 'info', duration);
}

// ==========================================
// 列表动画
// ==========================================

/**
 * 高亮行
 * @param {HTMLElement} element 
 */
export function highlightRow(element) {
    if (!element) return;
    element.classList.remove('row-highlight');
    void element.offsetWidth; // 触发重绘
    element.classList.add('row-highlight');
}

/**
 * 移除行（带动画）
 * @param {HTMLElement} element 
 * @param {Function} callback - 动画结束后执行的回调（通常是实际的 DOM 移除）
 */
export function removeRow(element, callback) {
    if (!element) return;
    element.classList.add('row-removing');
    waitForAnimation(element).then(() => {
        if (callback) callback();
        else element.remove();
    });
}

// ==========================================
// 表单动画
// ==========================================

/**
 * 元素抖动（错误提示）
 * @param {HTMLElement} element 
 */
export function shakeElement(element) {
    if (!element) return;
    element.classList.remove('shake');
    void element.offsetWidth;
    element.classList.add('shake');
}

// ==========================================
// 全局暴露 (兼容旧代码)
// ==========================================

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
