import { logger } from './logger.js';

// 显示加载状态
export function showLoading(message = '加载中...') {
  if (typeof window.showLoading === 'function') {
    window.showLoading(message);
  } else {
    // Fallback
    const loader = document.getElementById('loader');
    if (loader) {
      loader.textContent = message;
      loader.style.display = 'block';
    }
  }
}

// 隐藏加载状态
export function hideLoading() {
  if (typeof window.hideLoading === 'function') {
    window.hideLoading();
  } else {
    // Fallback
    const loader = document.getElementById('loader');
    if (loader) {
      loader.style.display = 'none';
    }
  }
}

// 显示错误消息
export function showError(message) {
  logger.error(message);
  if (typeof window.showError === 'function') {
    window.showError(message);
  } else {
    alert(message);
  }
}

export function showSuccess(message) {
  if (typeof window.showSuccess === 'function') {
    window.showSuccess(message);
  } else {
    alert(message);
  }
}

export function showInfo(message) {
  if (typeof window.showInfo === 'function') {
    window.showInfo(message);
  } else {
    console.log(message);
  }
}

export function confirmAction(message, options = {}) {
  const overlay = document.getElementById('confirm-modal')
  const msg = document.getElementById('confirm-message')
  const okBtn = document.getElementById('confirm-ok')
  const cancelBtn = document.getElementById('confirm-cancel')
  const closeBtn = document.getElementById('confirm-close')
  if (!overlay || !msg || !okBtn || !cancelBtn) return Promise.resolve(false)
  msg.textContent = message || ''
  if (options.okText) okBtn.textContent = options.okText
  if (options.cancelText) cancelBtn.textContent = options.cancelText
  overlay.classList.add('active')
  return new Promise(resolve => {
    const cleanup = () => {
      overlay.classList.remove('active')
      okBtn.onclick = null
      cancelBtn.onclick = null
      if (closeBtn) closeBtn.onclick = null
    }
    okBtn.onclick = () => { cleanup(); resolve(true) }
    const onCancel = () => { cleanup(); resolve(false) }
    cancelBtn.onclick = onCancel
    if (closeBtn) closeBtn.onclick = onCancel
  })
}

// 格式化日期
export function formatDate(dateString) {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN')
}

// 格式化货币
export function formatCurrency(amount, currency = 'CNY') {
  if (!amount && amount !== 0) return '0';

  // 格式化数字，添加千位分隔符
  const formattedNumber = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);

  // 根据货币类型返回对应符号
  const currencyUpper = (currency || 'THB').toUpperCase();
  if (currencyUpper === 'RMB' || currencyUpper === 'CNY') {
    return `¥ ${formattedNumber}`;
  } else if (currencyUpper === 'THB') {
    return `฿ ${formattedNumber}`;
  } else {
    return `${currencyUpper} ${formattedNumber}`;
  }
}

// 全局设置缓存
window._settingsCache = {
  shop: {},
  warehouse: {},
  inbound_type: {},
  outbound_type: {},
  ExpenseType: {}
}

// 获取配置项显示名称
export function getSettingName(type, code) {
  if (!code) return ''
  if (window._settingsCache[type] && window._settingsCache[type][code]) {
    return window._settingsCache[type][code]
  }
  return code
}

/**
 * HTML 转义函数 - 防止 XSS 攻击
 * 将特殊字符转换为 HTML 实体
 * @param {string} text - 需要转义的文本
 * @returns {string} 转义后的安全文本
 */
export function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
