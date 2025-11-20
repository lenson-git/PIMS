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
export function showError(message) {
  alert('错误: ' + message)
  console.error(message)
}

// 显示成功消息
export function showSuccess(message) {
  alert(message)
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
