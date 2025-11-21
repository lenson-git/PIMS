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
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('show'))
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 200)
  }, duration)
}

export function showError(message) {
  console.error(message)
  showToast('error', message)
}

export function showSuccess(message) {
  showToast('success', message)
}

export function showInfo(message) {
  showToast('info', message)
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
  if (!amount) return '0'
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency
  }).format(amount)
}

// 全局设置缓存
window._settingsCache = {
  shop: {},
  warehouse: {},
  inbound_type: {},
  outbound_type: {}
}

// 获取配置项显示名称
export function getSettingName(type, code) {
  if (!code) return ''
  if (window._settingsCache[type] && window._settingsCache[type][code]) {
    return window._settingsCache[type][code]
  }
  return code
}
