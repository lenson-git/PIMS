// 显示加载状态
export function showLoading(message = '加载中...') {
  const loader = document.getElementById('loader')
  if (loader) {
    loader.textContent = message
    loader.style.display = 'block'
  }
}

// 隐藏加载状态
export function hideLoading() {
  const loader = document.getElementById('loader')
  if (loader) {
    loader.style.display = 'none'
  }
}

// 显示错误消息
function ensureToastContainer() {
  let c = document.getElementById('toast-container')
  if (!c) {
    c = document.createElement('div')
    c.id = 'toast-container'
    c.className = 'toast-container'
    document.body.appendChild(c)
  }
  return c
}

function showToast(type, message, duration = 3000) {
  const container = ensureToastContainer()

  // 图标SVG (与animations.js保持一致)
  const icons = {
    success: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    warning: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info: '<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
  }

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.setAttribute('role', 'alert')
  toast.setAttribute('aria-live', 'polite')
  toast.innerHTML = `
    ${icons[type] || ''}
    <span>${message}</span>
  `

  container.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('show'))
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

export function showError(message) {
  console.error(message)
  showToast('error', message, 5000)
}

export function showSuccess(message) {
  showToast('success', message, 3000)
}

export function showInfo(message) {
  showToast('info', message, 3000)
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
