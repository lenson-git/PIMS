/**
 * UI Helpers Module
 * 通用 UI 辅助函数模块
 */

// ==========================================
// 模态框控制
// ==========================================

/**
 * 打开模态框
 */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        try {
            setTimeout(initFloatingLabels, 50);
        } catch (e) {
            console.error('Error initializing floating labels:', e);
        }
    } else {
        console.error('Modal not found:', modalId);
    }
}

/**
 * 关闭模态框
 */
export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// ==========================================
// 浮动标签
// ==========================================

/**
 * 初始化浮动标签
 */
export function initFloatingLabels() {
    document.querySelectorAll('.floating-label-group select').forEach(select => {
        if (select.dataset.floatingInit) return;
        select.dataset.floatingInit = 'true';

        function updateLabel() {
            if (select.value && select.value !== '') {
                select.parentElement.classList.add('active');
            } else {
                select.parentElement.classList.remove('active');
            }
        }

        updateLabel();
        select.addEventListener('change', updateLabel);
        select.addEventListener('focus', () => {
            select.parentElement.classList.add('active');
        });
    });
}

// ==========================================
// 视觉反馈
// ==========================================

/**
 * 闪烁行效果
 */
export function flashRow(code) {
    const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
    if (!row) return;
    row.classList.remove('row-flash');
    void row.offsetWidth;
    row.classList.add('row-flash');
}

/**
 * 播放提示音
 */
export function playBeep() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
        setTimeout(() => { try { ctx.close(); } catch (_) { } }, 200);
    } catch (_) { }
}

// ==========================================
// 图片查看器
// ==========================================

/**
 * 显示图片灯箱
 */
export function showLightbox(src) {
    const lightbox = document.getElementById('global-lightbox');
    if (lightbox) {
        const img = lightbox.querySelector('img');
        img.src = src;
        lightbox.classList.add('active');
    }
}

/**
 * 关闭图片灯箱
 */
export function closeLightbox() {
    const lightbox = document.getElementById('global-lightbox');
    if (lightbox) lightbox.classList.remove('active');
}

// ==========================================
// 全局暴露
// ==========================================

window.openModal = openModal;
window.closeModal = closeModal;
window.flashRow = flashRow;
window.playBeep = playBeep;
window.showLightbox = showLightbox;
window.closeLightbox = closeLightbox;
