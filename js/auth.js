import { supabase, CONFIG } from './config.js'
import { showError } from './utils.js'

// 检查用户是否已登录
export async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return null
  }

  // 检查是否是允许的邮箱
  const email = session.user.email
  if (email !== CONFIG.ALLOWED_EMAIL) {
    await supabase.auth.signOut()
    showError('您没有权限访问此系统')
    return null
  }

  return session.user
}

// Google 登录
export async function loginWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  })

  if (error) {
    console.error('Login error:', error)
    showError('登录失败: ' + error.message)
  }

  return data
}

// 登出
export async function logout() {
  await supabase.auth.signOut()
  window.location.reload()
}

// 初始化认证状态监听
export function initAuth() {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      console.log('User signed in:', session.user.email)
      updateUIForAuth(session.user)
    } else if (event === 'SIGNED_OUT') {
      console.log('User signed out')
      updateUIForAuth(null)
    }
  })
}

// 更新 UI 显示登录状态
function updateUIForAuth(user) {
  const loginBtn = document.getElementById('login-btn')
  const logoutBtn = document.getElementById('logout-btn')
  const userEmail = document.getElementById('user-email')

  if (user) {
    if (loginBtn) loginBtn.style.display = 'none'
    if (logoutBtn) logoutBtn.style.display = 'block'
    if (userEmail) userEmail.textContent = user.email
  } else {
    if (loginBtn) loginBtn.style.display = 'block'
    if (logoutBtn) logoutBtn.style.display = 'none'
    if (userEmail) userEmail.textContent = ''
  }
}
