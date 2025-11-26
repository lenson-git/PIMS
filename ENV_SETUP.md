# 环境变量配置指南

## 📋 概述

本项目使用环境变量来管理敏感配置信息，如 API 密钥、数据库连接等。

## 🔧 配置步骤

### 1. 创建环境变量文件

复制 `.env.example` 为 `.env`:

```bash
cp .env.example .env
```

### 2. 填写实际配置

编辑 `.env` 文件，填入实际的配置值：

```env
# Supabase 配置
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_actual_anon_key_here

# Google OAuth 配置
VITE_GOOGLE_CLIENT_ID=your_actual_client_id.apps.googleusercontent.com

# 环境
VITE_APP_ENV=development
```

### 3. 获取配置值

#### Supabase 配置

1. 登录 [Supabase Dashboard](https://app.supabase.com)
2. 选择你的项目
3. 进入 Settings → API
4. 复制 `Project URL` 和 `anon public` key

#### Google OAuth 配置

1. 访问 [Google Cloud Console](https://console.cloud.google.com)
2. 选择你的项目
3. 进入 APIs & Services → Credentials
4. 找到你的 OAuth 2.0 Client ID

## ⚠️ 重要提示

### 安全性

- ✅ `.env` 文件已添加到 `.gitignore`，不会被提交到 Git
- ✅ 永远不要将 `.env` 文件提交到版本控制
- ✅ 不要在代码中硬编码敏感信息

### 生产环境

由于本项目是静态网站部署到 GitHub Pages，环境变量的处理方式如下：

#### 方案 1: 使用 GitHub Secrets (推荐)

1. 在 GitHub 仓库设置中添加 Secrets
2. 使用 GitHub Actions 在构建时注入环境变量

#### 方案 2: 手动配置

在部署前，手动替换 `supabase-client.js` 中的配置值。

**注意**: 由于是前端代码，API 密钥会暴露在浏览器中。确保：
- 使用 Supabase 的 `anon` key（公开密钥）
- 在 Supabase 中正确配置 RLS (Row Level Security)
- 限制 API 密钥的使用域名

## 📝 环境变量说明

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase 匿名密钥 | `eyJhbGc...` |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID | `xxx.apps.googleusercontent.com` |
| `VITE_APP_ENV` | 应用环境 | `development` / `production` |

## 🔍 验证配置

启动开发服务器后，打开浏览器控制台，检查是否有配置相关的错误信息。

## 🆘 常见问题

### Q: 为什么变量名要以 `VITE_` 开头？

A: 如果将来使用 Vite 构建工具，只有以 `VITE_` 开头的环境变量才会被暴露到客户端代码。

### Q: 如何在代码中使用环境变量？

A: 当前项目是纯静态网站，暂时在 `supabase-client.js` 中直接配置。如果将来引入构建工具，可以使用：

```javascript
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

### Q: 部署到 GitHub Pages 后配置不生效？

A: 静态网站部署需要在构建时注入环境变量，或者使用 GitHub Actions 自动替换配置值。

## 📚 相关文档

- [Supabase 文档](https://supabase.com/docs)
- [Google OAuth 文档](https://developers.google.com/identity/protocols/oauth2)
- [Vite 环境变量](https://vitejs.dev/guide/env-and-mode.html)
