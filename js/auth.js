import { supabase, CONFIG } from './config.js'
import { showError } from './utils.js'

// 用户状态缓存
let currentUser = null

// 检查用户是否已登录
export async function checkAuth() {
  console.log('checkAuth: starting')
  try {
    console.log('checkAuth: calling getSession()')
    const { data: { session } } = await supabase.auth.getSession()
    console.log('checkAuth: getSession returned', { hasSession: !!session })

    if (!session) {
      console.log('checkAuth: no session, returning null')
      currentUser = null
      return null
    }

    // 检查是否是允许的邮箱
    const email = session.user.email
    console.log('checkAuth: checking email', email, 'against', CONFIG.ALLOWED_EMAIL)
    if (email !== CONFIG.ALLOWED_EMAIL) {
      console.log('checkAuth: email not allowed, signing out')
      await supabase.auth.signOut()
      showError('您没有权限访问此系统')
      currentUser = null
      return null
    }

    console.log('checkAuth: user authenticated, returning user')
    currentUser = session.user
    return session.user
  } catch (error) {
    console.error('checkAuth: error', error)
    currentUser = null
    return null
  }
}

// 获取当前用户（同步）
export function getCurrentUser() {
  return currentUser
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
  console.log('Logging out...')

  // 先更新 UI，立即显示登录页面
  const authOverlay = document.getElementById('auth-overlay')
  const appContainer = document.getElementById('app-container')
  console.log('authOverlay:', authOverlay, 'appContainer:', appContainer)
  if (authOverlay) authOverlay.style.display = 'flex'
  if (appContainer) appContainer.style.display = 'none'
  console.log('UI updated to show login page')

  // 清除用户缓存
  currentUser = null

  // 然后执行登出
  try {
    await supabase.auth.signOut()
    console.log('Sign out complete')
  } catch (error) {
    console.error('Sign out error:', error)
  }
}

// 初始化认证状态监听
export function initAuth() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      console.log('User signed in:', session.user.email)

      // 检查邮箱权限
      if (session.user.email !== CONFIG.ALLOWED_EMAIL) {
        await supabase.auth.signOut()
        showError('您没有权限访问此系统')
        currentUser = null
      } else {
        currentUser = session.user
        updateUIForAuth(session.user)
        // 重新检查认证状态
        await enforceAuth()
      }
    } else if (event === 'SIGNED_OUT') {
      console.log('User signed out')
      currentUser = null
      updateUIForAuth(null)
      // 重新检查认证状态
      await enforceAuth()
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

// 强制认证检查
export async function enforceAuth() {
  console.log('enforceAuth: starting')
  const authOverlay = document.getElementById('auth-overlay')
  const appContainer = document.getElementById('app-container')
  console.log('enforceAuth: elements found', { authOverlay: !!authOverlay, appContainer: !!appContainer })

  // 使用同步的 getCurrentUser 而不是异步的 checkAuth
  const user = getCurrentUser()
  console.log('enforceAuth: getCurrentUser returned', user)

  if (user) {
    // 认证成功，隐藏登录界面，显示应用
    console.log('enforceAuth: user authenticated, showing app')
    if (authOverlay) authOverlay.style.display = 'none'
    if (appContainer) appContainer.style.display = 'flex'
    return true
  } else {
    // 未登录或未授权，显示登录界面，隐藏应用
    console.log('enforceAuth: user not authenticated, showing login')
    if (authOverlay) authOverlay.style.display = 'flex'
    if (appContainer) appContainer.style.display = 'none'
    return false
  }
}
