/**
 * 日志工具模块
 * 根据环境自动启用/禁用调试日志
 */

// 检测是否为开发环境
const isDevelopment = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('192.168');

/**
 * 日志工具对象
 */
export const logger = {
    /**
     * 调试日志 - 仅在开发环境输出
     * @param {...any} args - 要输出的内容
     */
    debug: (...args) => {
        if (isDevelopment) {
            console.log('[DEBUG]', ...args);
        }
    },

    /**
     * 信息日志 - 仅在开发环境输出
     * @param {...any} args - 要输出的内容
     */
    info: (...args) => {
        if (isDevelopment) {
            console.log('[INFO]', ...args);
        }
    },

    /**
     * 警告日志 - 所有环境输出
     * @param {...any} args - 要输出的内容
     */
    warn: (...args) => {
        console.warn('[WARN]', ...args);
    },

    /**
     * 错误日志 - 所有环境输出
     * @param {...any} args - 要输出的内容
     */
    error: (...args) => {
        console.error('[ERROR]', ...args);
    }
};

// 暴露到全局，供非模块脚本使用
window.logger = logger;
