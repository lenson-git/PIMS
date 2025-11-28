import {
    fetchSKUs, createSKU, uploadImage, fetchSettings, createSignedUrlFromPublicUrl, fetchSKUByBarcode, createStockMovement, fetchStockMovements, fetchSKUById, fetchStockTotalBySKU, fetchStockTotalBySKUs, fetchStockBySKUsWarehouse, fetchSales30dBySKU, updateSKU, createTransformedUrlFromPublicUrl, deleteSKU, fetchWarehouseStockMap, fetchStockBySKUWarehouse, createSetting, fetchAllStock, fetchSafetyStock,
    fetchExpenses, createExpense, updateExpense, deleteExpense, fetchWarehouseConstraints, fetchPriceRules, supabase
} from './supabase-client.js?v=20251125-1734';
import { WAREHOUSE_RULES, PRICE_RULES, FIELD_LABELS } from './config.js'
import { checkAuth, loginWithGoogle, initAuth, logout, enforceAuth } from './auth.js'
import { getSettingName, showError, showInfo, showSuccess, formatCurrency, formatDate, escapeHtml } from './utils.js'
import { logger } from './logger.js'
import { safeHTML, buildAttrs, buildClass, buildStyle } from './html-builder.js'
import { loadDashboard, fetchExchangeRate, getCurrentExchangeRate } from './modules/dashboard.js'
import './modules/expenses.js'  // 导入 Expenses 模块（自动注册到 window）
import './modules/settings.js'  // 导入 Settings 模块（自动注册到 window）
import './modules/inbound.js'   // 导入 Inbound 模块（自动注册到 window）
import './modules/ui-helpers.js' // 导入 UI 辅助函数模块
import './modules/sku.js'        // 导入 SKU 管理模块
import './modules/outbound.js'   // 导入出库管理模块
import './modules/stock.js'      // 导入库存管理模块

// 将 supabase 暴露到全局作用域，供非模块脚本使用
window.supabase = supabase;

// 将工具函数暴露到全局作用域
window.showSuccess = showSuccess;
window.showError = showError;
window.showInfo = showInfo;
window.getSettingName = getSettingName;
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.escapeHtml = escapeHtml;
window.createTransformedUrlFromPublicUrl = createTransformedUrlFromPublicUrl;
window.createSignedUrlFromPublicUrl = createSignedUrlFromPublicUrl;

// 通过条码获取 SKU (带缓存) - 在 app.js 中实现避免循环依赖
window.getSKUByBarcodeCached = async function (code) {
    if (window._skuCacheByBarcode && window._skuCacheByBarcode[code]) {
        return window._skuCacheByBarcode[code];
    }
    const sku = await fetchSKUByBarcode(code);
    if (sku) {
        if (!window._skuCacheByBarcode) window._skuCacheByBarcode = {};
        window._skuCacheByBarcode[code] = sku;
    }
    return sku;
};

// ==========================================
// Core Logic
// ==========================================

// 全局配置映射缓存
window._settingsCache = {
    shop: {},
    warehouse: {},
    inbound_type: {},
    outbound_type: {}
};

// 仓库约束关系缓存 (动态加载)
window._warehouseConstraints = null;
// 价格规则缓存 (动态加载)
window._priceRules = null;

// ==========================================
// Dashboard Logic (已移至 modules/dashboard.js)
// ==========================================

// 页面导航控制
function navigate(viewName) {

    // 关闭可能打开的扫描器（防止摄像头一直开着）
    if (typeof window.closeBarcodeScanner === 'function') {
        window.closeBarcodeScanner();
    }

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // 由于 onclick 是在 div 上，我们需要手动处理 active 类
    document.querySelectorAll('.nav-item').forEach(item => {
        const onclick = item.getAttribute('onclick');
        if (onclick && onclick.includes("'" + viewName + "'")) {
            item.classList.add('active');
        }
    });

    // 切换视图
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    const view = document.getElementById(viewName + '-view');
    if (view) {
        view.classList.add('active');
    } else {
        logger.error('View not found:', viewName + '-view');
    }

    // 更新标题
    const titles = {
        'dashboard': '仪表盘',
        'sku': 'SKU管理',
        'inbound': '入库',
        'outbound': '出库',
        'stock': '库存管理',
        'settings': '系统设置',
        'expenses': '费用管理'
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[viewName] || 'PIMS';

    if (viewName === 'sku') {
        loadSKUs();
        setTimeout(() => document.getElementById('sku-main-input')?.focus(), 100);
    } else if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'inbound') {
        preloadInbound();
        setTimeout(() => document.getElementById('inbound-sku-input')?.focus(), 100);
    } else if (viewName === 'outbound') {
        preloadOutbound();
        setTimeout(() => document.getElementById('outbound-sku-input')?.focus(), 100);
    } else if (viewName === 'settings') {
        loadSystemSettings();
    } else if (viewName === 'stock') {
        // 立即聚焦输入框，不等待数据加载
        setTimeout(() => document.getElementById('stock-search-input')?.focus(), 100);
        // 异步加载数据
        loadStockList();
    } else if (viewName === 'expenses') {
        // 刷新费用类型下拉列表，确保系统设置的修改能及时反映
        loadSelectOptions('ExpenseType', 'ExpenseType');

        // 设置默认日期为今天
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('new-expense-date');
        const dateToInput = document.getElementById('date-to');

        if (dateInput && !dateInput.value) dateInput.value = today;
        if (dateToInput && !dateToInput.value) dateToInput.value = today;

        loadExpenses();

        // 重置快速录入下拉为未选择
        setTimeout(() => {
            const typeSelect = document.getElementById('new-expense-type');
            const currencySelect = document.getElementById('new-expense-currency');
            if (typeSelect) {
                typeSelect.value = '';
                typeSelect.dispatchEvent(new Event('change'));
            }
            if (currencySelect) {
                currencySelect.value = '';
                currencySelect.dispatchEvent(new Event('change'));
            }
            try { initFloatingLabels(); } catch (_) { }
        }, 200);
    }

    // 重新绑定扫描按钮（因为视图已更新）
    if (typeof window.bindScanButtons === 'function') {
        setTimeout(() => window.bindScanButtons(), 100);
    }
}



// 明确暴露到全局
window.navigate = navigate;

// 暴露给全局以便 HTML onclick 调用
window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        try {
            setTimeout(initFloatingLabels, 50);
        } catch (e) {
            logger.error('Error initializing floating labels:', e);
        }
    } else {
        logger.error('Modal not found:', modalId);
    }
}

window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// 初始化浮动标签
function initFloatingLabels() {
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

// 加载下拉选项
// 加载下拉选项
async function loadSelectOptions(selectName, type, selectedValue, targetId = null) {
    try {
        const data = await fetchSettings(type);

        // Update Cache
        if (!window._settingsCache[type]) window._settingsCache[type] = {};
        data.forEach(item => {
            window._settingsCache[type][item.code || item.name] = item.name;
        });

        let selects;
        if (targetId) {
            const el = document.getElementById(targetId);
            selects = el ? [el] : [];
        } else {
            selects = document.querySelectorAll('select[name="' + selectName + '"]');
        }

        selects.forEach(select => {
            let specialOptions = [];
            Array.from(select.options).forEach(opt => {
                if (opt.value === '' || opt.value === '__new__') {
                    specialOptions.push(opt);
                }
            });

            select.innerHTML = '';

            const emptyOpt = specialOptions.find(o => o.value === '');
            if (emptyOpt) select.appendChild(emptyOpt);

            data.forEach(item => {
                // 跳过已禁用的选项
                if (item.status === 'disabled') return;

                const option = document.createElement('option');
                option.value = item.code || item.name;
                option.textContent = item.name;
                if (selectedValue && option.value === selectedValue) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            let newOpt = specialOptions.find(o => o.value === '__new__');
            if (!newOpt) {
                newOpt = document.createElement('option');
                newOpt.value = '__new__';
                newOpt.textContent = '+ 新建...';
            }
            select.appendChild(newOpt);

            if (select.value) select.parentElement.classList.add('active');

            // 监听选择变化
            select.addEventListener('change', function () {
                if (this.value === '__new__') {
                    // 存储当前选中的值以便取消时恢复(如果需要)
                    // 但这里我们只是重置为空或者默认值
                    // 更好的做法是: 如果用户取消, 恢复到之前的值. 但这里简单处理: 重置为空

                    const previousValue = this.getAttribute('data-prev-value') || '';

                    openAddSettingModal(type, this.getAttribute('id') || this.getAttribute('name'));

                    // 立即重置为之前的值,防止界面显示 __new__
                    // 如果用户保存成功, saveNewSetting 会再次更新这个值
                    this.value = previousValue;
                } else {
                    // 记录当前有效值
                    this.setAttribute('data-prev-value', this.value);
                }
            });

            // 初始化 data-prev-value
            if (select.value && select.value !== '__new__') {
                select.setAttribute('data-prev-value', select.value);
            }

        });
    } catch (err) {
        logger.error('加载下拉选项失败:', selectName, err);
    }
}

// 暴露到全局
window.loadSelectOptions = loadSelectOptions;

// 打开新增配置模态框
window.openAddSettingModal = function (type, targetSelectId) {
    document.getElementById('new-setting-type').value = type;
    // 如果 targetSelectId 是 undefined，设置为空字符串
    document.getElementById('new-setting-target-select').value = targetSelectId || '';
    document.getElementById('new-setting-name').value = '';
    document.getElementById('new-setting-code').value = '';

    // 更新模态框标题
    const typeNameMap = {
        shop: '店铺',
        warehouse: '仓库',
        inbound_type: '入库类型',
        outbound_type: '出库类型',
        expense_type: '费用类型',
        ExpenseType: '费用类型',
        status: '状态',
        sales_channel: '销售渠道'
    };
    const typeName = typeNameMap[type] || '配置';
    document.querySelector('#add-setting-modal h3').textContent = '新建' + typeName;

    window.openModal('add-setting-modal');
    setTimeout(() => document.getElementById('new-setting-name').focus(), 100);
}

// 监听名称输入,自动填充代码(如果代码框为空)
document.getElementById('new-setting-name').addEventListener('input', function (e) {
    const codeInput = document.getElementById('new-setting-code');
    if (!codeInput.value) {
        // 简单的自动生成预览: 转大写, 空格变下划线
        // 这里只做简单的预览, 实际保存时会有更严格的处理
        const val = e.target.value.trim();
        if (val) {
            // 尝试转为拼音或英文? 目前只能做简单的 ASCII 处理
            // 如果是中文, 暂时不填充, 让用户自己填
            if (/^[\w\s]+$/.test(val)) {
                codeInput.placeholder = val.toUpperCase().replace(/\s+/g, '_');
            }
        }
    }
});

// 针对特定类型刷新设置列表 (比全量刷新更高效且可靠)
async function reloadSettingsByType(type) {
    try {
        const dbType = getDBSettingType(type);
        console.log(`Reloading settings for type: ${type} (DB: ${dbType})`);

        const { data, error } = await supabase
            .from('settings')
            .select('*')
            .eq('type', dbType)
            .order('created_at', { ascending: true });

        if (error) throw error;

        renderSettingList(type, data);
        console.log(`Refreshed ${data.length} items for ${type}`);

        // 同时更新全局缓存
        if (!window._settingsCache[type]) window._settingsCache[type] = {};
        data.forEach(item => {
            window._settingsCache[type][item.code] = item.name;
        });

    } catch (err) {
        logger.error(`Failed to reload settings for ${type}: `, err);
        showError('刷新列表失败');
    }
}

// 保存新配置
window.saveNewSetting = async function () {
    const type = document.getElementById('new-setting-type').value;
    const targetSelectId = document.getElementById('new-setting-target-select').value;
    const name = document.getElementById('new-setting-name').value.trim();
    let code = document.getElementById('new-setting-code').value.trim();

    if (!name) {
        showError('请输入名称');
        return;
    }

    if (!code) {
        showError('请输入代码');
        return;
    }

    // 强制转大写
    code = code.toUpperCase();

    // 1. 格式验证: 必须是大写字母、数字、下划线
    if (!/^[A-Z0-9_]+$/.test(code)) {
        showError('代码格式错误: 只能包含大写字母、数字和下划线');
        return;
    }

    // 2. 唯一性验证
    const existingCodes = window._settingsCache[type] ? Object.keys(window._settingsCache[type]) : [];
    if (existingCodes.includes(code)) {
        showError('代码 ' + code + ' 已存在, 请使用其他代码');
        return;
    }

    try {
        // 使用辅助函数获取正确的数据库类型 (PascalCase)
        const dbType = getDBSettingType(type);

        const payload = {
            type: dbType,
            code: code,
            name: name,
            status: 'Active'
        };

        await createSetting(code, name, dbType);

        showSuccess('创建成功');
        closeModal('add-setting-modal');

        // 刷新缓存
        window._settingsCache[type] = null;

        // 如果有 targetSelectId 且不为空，说明是下拉框触发的，刷新对应下拉框
        if (targetSelectId && targetSelectId !== '') {
            console.log('Refreshing select options for:', targetSelectId);
            // 查找所有使用该类型的下拉框并重新加载
            const selectMap = {
                'shop': 'shop_code',
                'warehouse': 'warehouse_code',
                'inbound_type': 'inbound_type_code',
                'outbound_type': 'outbound_type_code',
                'expense_type': 'expense_type',
                'ExpenseType': 'ExpenseType',
                'status': 'status_code',
                'sales_channel': 'sales_channel_code'
            };

            const selectName = selectMap[type];
            if (selectName) {
                await loadSelectOptions(selectName, type, code);
            } else {
                // 尝试刷新触发的特定下拉框
                const targetSelect = document.getElementById(targetSelectId);
                if (targetSelect) {
                    const nameAttr = targetSelect.getAttribute('name');
                    if (nameAttr) {
                        await loadSelectOptions(nameAttr, type, code);
                    }
                }
            }

            // 特殊处理库存调整模态框中的仓库选择器
            if (targetSelectId === 'adjust-warehouse' && type === 'warehouse') {
                const data = await fetchSettings('warehouse');
                if (!window._settingsCache['warehouse']) window._settingsCache['warehouse'] = {};
                data.forEach(item => {
                    window._settingsCache['warehouse'][item.code || item.name] = item.name;
                });
                const warehouseSelect = document.getElementById('adjust-warehouse');
                if (warehouseSelect) {
                    warehouseSelect.innerHTML = '<option value="">请选择仓库</option>';
                    data.forEach(item => {
                        const option = document.createElement('option');
                        option.value = item.code || item.name;
                        option.textContent = item.name;
                        warehouseSelect.appendChild(option);
                    });
                    // 添加新建选项
                    const newOpt = document.createElement('option');
                    newOpt.value = '__new__';
                    newOpt.textContent = '+ 新建...';
                    warehouseSelect.appendChild(newOpt);
                    warehouseSelect.value = code;
                    warehouseSelect.dispatchEvent(new Event('change'));
                }
            }
        } else {
            console.log('Refreshing settings list for type:', type);
            // 针对性刷新当前类型的列表
            await reloadSettingsByType(type);

            // 同时刷新页面上所有相关的下拉框
            const selectMap = {
                'shop': 'shop_code',
                'warehouse': 'warehouse_code',
                'inbound_type': 'inbound_type_code',
                'outbound_type': 'outbound_type_code',
                'expense_type': 'expense_type',
                'ExpenseType': 'ExpenseType',
                'status': 'status_code',
                'sales_channel': 'sales_channel_code'
            };

            const selectName = selectMap[type];
            if (selectName) {
                // 查找所有 name 属性匹配的 select 元素并刷新
                const selects = document.querySelectorAll(`select[name = "${selectName}"]`);
                console.log(`Found ${selects.length} select elements with name = "${selectName}", refreshing...`);

                for (const select of selects) {
                    const currentValue = select.value;
                    await loadSelectOptions(selectName, type, currentValue);
                }
            }

            // 更新全局缓存以便其他地方使用
            loadSettings();
        }

    } catch (err) {
        showError('创建失败: ' + err.message);
    }
}

// 移除 addSetting 函数，因为它已被模态框取代
// window.addSetting = ... (deleted)

// 根据选中的仓库过滤入/出库类型选项，仅显示允许的集合（选项值为代码）
/**
 * 根据仓库类型过滤移库类型
 * @param {string} warehouseCode - 仓库代码 (MAIN/AFTERSALE)
 * @param {HTMLSelectElement} selectEl - 移库类型选择框的DOM元素
 * @param {string} direction - 方向 (inbound/outbound)
 */
function filterTypes(warehouseCode, selectEl, direction) {
    // 优先使用动态加载的配置,否则回退到静态配置
    const rules = (window._warehouseConstraints || WAREHOUSE_RULES)[warehouseCode];
    if (!rules) return;

    const allow = direction === 'inbound' ? rules.inbound : rules.outbound;
    const typeMap = window._settingsCache[direction === 'inbound' ? 'inbound_type' : 'outbound_type'] || {};

    // 保留空选项和"新建"选项
    const preserved = [];
    Array.from(selectEl.options).forEach(opt => {
        if (opt.value === '' || opt.value === '__new__') preserved.push(opt);
    });

    const current = selectEl.value;
    selectEl.innerHTML = '';
    preserved.forEach(o => selectEl.appendChild(o));

    // 根据允许的 code 列表添加选项
    const allowedOptions = [];
    Object.entries(typeMap).forEach(([code, name]) => {
        if (Array.isArray(allow) && allow.includes(code)) {  // allow 包含的是 code
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name;
            selectEl.appendChild(opt);
            allowedOptions.push({ code, name });
        }
    });

    // 如果当前选中的值在允许列表中,保持选中
    if (Array.isArray(allow) && allow.includes(current)) {
        selectEl.value = current;
    } else {
        selectEl.value = '';
    }

    // 如果只有一个选项,自动选中
    if (allowedOptions.length === 1) {
        selectEl.value = allowedOptions[0].code;
        if (selectEl.parentElement) selectEl.parentElement.classList.add('active');
    }
}

// 校验仓库与出/入库类型的合法性（传入代码，规则以名称比对）
/**
 * 验证库存移动数据的完整性
 * @param {string} warehouseCode - 仓库代码
 * @param {string} typeCode - 移库类型代码
 * @param {string} direction - 移动方向 ('inbound' 或 'outbound')
 * @returns {boolean} 验证是否通过
 */
function validateMovement(warehouseCode, typeCode, direction) {
    // 优先使用动态加载的配置,否则回退到静态配置
    const rules = (window._warehouseConstraints || WAREHOUSE_RULES)[warehouseCode];
    if (!rules) return false;
    const allow = direction === 'inbound' ? rules.inbound : rules.outbound;
    // 直接检查 typeCode 是否在允许列表中(allow 现在包含 code)
    return Array.isArray(allow) && allow.includes(typeCode);
}

// 按类型返回对应币种的单价（不做汇率换算）
function getUnitPriceForMovement(sku, movementType) {
    // 优先使用动态加载的配置,否则回退到静态配置
    const rule = (window._priceRules || PRICE_RULES)[movementType];
    if (!rule) return { unit_price_rmb: null, unit_price_thb: null };
    const value = Number(sku[rule.source]) || 0;
    if (rule.currency === 'RMB') return { unit_price_rmb: value, unit_price_thb: null };
    return { unit_price_rmb: null, unit_price_thb: value };
}

// ==========================================
// SKU Logic (已移至 modules/sku.js)
// ==========================================

// 保留必要的全局状态变量
window._viewReady = { inbound: false, outbound: false, sku: false, stock: false, expenses: false };
window._skuCacheByBarcode = {};

// ==========================================
// Inbound Logic (已移至 modules/inbound.js)
// ==========================================

// ==========================================
// UI Helper Functions (已移至 modules/ui-helpers.js)
// ==========================================

// ==========================================
// Outbound Logic (已移至 modules/outbound.js)
// ==========================================

// ==========================================
// Stock Logic (已移至 modules/stock.js)
// ==========================================

// ==========================================

// ==========================================
// Initialization
// ==========================================

document.addEventListener('DOMContentLoaded', async function () {

    // Init Floating Labels
    initFloatingLabels();

    // Init Auth
    initAuth();

    // 初始化用户状态
    await checkAuth()

    // 强制认证检查
    try {
        const isAuthenticated = await enforceAuth();

        // 只有认证通过才加载数据
        if (isAuthenticated) {
            // 默认加载仪表盘
            navigate('dashboard');

            loadSelectOptions('shop_code', 'shop');
            loadSelectOptions('warehouse_code', 'warehouse');
            loadSelectOptions('inbound_type_code', 'inbound_type');

            // 加载动态配置
            loadWarehouseConstraints();
            loadPriceRules();
            loadSelectOptions('outbound_type_code', 'outbound_type');
            loadSelectOptions('ExpenseType', 'ExpenseType');
            loadSelectOptions('status_code', 'status');
            loadSelectOptions('sales_channel', 'sales_channel');

            // 监听出库仓库变化，过滤出库类型
            const outboundWarehouseSelect = document.getElementById('outbound-warehouse');
            const outboundTypeSelect = document.getElementById('outbound-type');
            const channelGroup = document.getElementById('outbound-channel-group');

            if (outboundWarehouseSelect && outboundTypeSelect) {
                outboundWarehouseSelect.addEventListener('change', () => filterTypes(outboundWarehouseSelect.value, outboundTypeSelect, 'outbound'));
            }

            document.querySelectorAll('select').forEach(select => {
                if (![...select.options].some(o => o.value === '__new__')) {
                    const newOpt = document.createElement('option');
                    newOpt.value = '__new__';
                    newOpt.textContent = '+ 新建...';
                    select.appendChild(newOpt);
                }
            });
        }
    } catch (error) {
        logger.error('enforceAuth failed:', error)
        // 出错时显示登录界面
        const authOverlay = document.getElementById('auth-overlay')
        if (authOverlay) authOverlay.style.display = 'flex'
    }

    const inboundWarehouse = document.getElementById('inbound-warehouse');
    const inboundType = document.getElementById('inbound-type');
    if (inboundWarehouse && inboundType) {
        inboundWarehouse.addEventListener('change', () => filterTypes(inboundWarehouse.value, inboundType, 'inbound'));
        filterTypes(inboundWarehouse.value, inboundType, 'inbound');
    }

    const outboundWarehouse = document.getElementById('outbound-warehouse');
    const outboundType = document.getElementById('outbound-type');
    if (outboundWarehouse && outboundType) {
        outboundWarehouse.addEventListener('change', () => filterTypes(outboundWarehouse.value, outboundType, 'outbound'));
        filterTypes(outboundWarehouse.value, outboundType, 'outbound');
    }

    // 移除 focus 事件监听器，避免干扰扫码
    // const barcodeInputs = ['inbound-sku-input', 'outbound-sku-input', 'stock-search-input'];
    // ...

    const inboundInput = document.getElementById('inbound-sku-input');
    if (inboundInput) {
        // 移除 focus 自动清空，避免误操作
        // inboundInput.addEventListener('focus', ...);

        inboundInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 阻止默认提交行为
                const code = inboundInput.value.trim();
                // 立即清空输入框，防止重复或叠加
                inboundInput.value = '';

                if (!code) return;
                if (inboundScanLock) return;

                inboundScanLock = true;
                try {
                    const sku = await getSKUByBarcodeCached(code);
                    if (!sku) {
                        showError('该产品不存在或已下架，禁止入库');
                        inboundLastCode = code;
                        return;
                    }
                    const statusName = getSettingName('status', sku.status_code) || '';
                    const isDown = sku.status_code === 'down' || sku.status_code === 'inactive' || statusName.includes('下架');
                    if (isDown) {
                        window._inboundCreateBarcode = code;
                        editSKU(sku.id);
                        return;
                    }
                    if (sku) {
                        // 添加到待入库清单
                        const pending = window.getPendingInbound();
                        if (!pending[code]) pending[code] = 0;
                        pending[code] += 1;
                        window.setPendingInbound(pending);
                        await renderInboundList();
                        const row = document.querySelector(`#inbound-list-body tr[data-code="${code}"]`);
                        if (row) {
                            const input = row.querySelector('input[data-role="inbound-qty"]');
                            if (input) input.value = pending[code];
                        }
                        flashRow(code);
                        playBeep();
                        inboundLastCode = code;
                    }
                } catch (err) {
                    showError('扫描入库失败: ' + err.message);
                    // 如果失败，可能需要把码放回去？通常不需要，让用户重扫即可
                } finally {
                    setTimeout(() => { inboundScanLock = false; }, 200);
                    inboundInput.focus(); // 保持聚焦
                }
            }
        });
    }

    const outboundInput = document.getElementById('outbound-sku-input');
    if (outboundInput) {
        outboundInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 阻止默认提交
                const code = outboundInput.value.trim();
                // 立即清空
                outboundInput.value = '';

                if (!code) return;
                if (outboundScanLock) return;

                outboundScanLock = true;
                try {
                    const sku = await getSKUByBarcodeCached(code);
                    if (!sku) {
                        showError('未找到该条码的 SKU');
                        outboundLastCode = code;
                        return;
                    }
                    const statusName = getSettingName('status', sku.status_code) || '';
                    const isDown = sku.status_code === 'down' || sku.status_code === 'inactive' || statusName.includes('下架');
                    if (isDown) {
                        showError('该产品已下架，禁止出库');
                        outboundLastCode = code;
                        return;
                    }

                    // 更新数量或新增行
                    if (!pendingOutbound[code]) pendingOutbound[code] = 0;

                    // 预先检查库存（如果是已有行）
                    // 注意：如果是新行，appendOutboundRowIfNeeded 会处理库存显示，但这里我们先增加数量
                    // 为了安全，先增加，然后检查
                    pendingOutbound[code] += 1;

                    await appendOutboundRowIfNeeded(code);

                    const row = document.querySelector(`#outbound-list-body tr[data-code="${code}"]`);
                    if (row) {
                        const cell = row.querySelector('[data-role="current-stock"]');
                        const max = cell ? parseInt(cell.textContent, 10) : NaN;

                        // 检查库存上限
                        if (!Number.isNaN(max) && pendingOutbound[code] > max) {
                            pendingOutbound[code] = max;
                            showError('超过当前库存，已回退到最大可用值');
                        }

                        const input = row.querySelector('input[data-role="outbound-qty"]');
                        if (input) input.value = pendingOutbound[code];
                    }

                    flashOutboundRow(code);
                    playBeep();
                    outboundLastCode = code;
                } catch (err) {
                    showError('扫描出库失败: ' + err.message);
                } finally {
                    setTimeout(() => { outboundScanLock = false; }, 200);
                    outboundInput.focus();
                }
            }
        });
    }

    const stockInput = document.getElementById('stock-search-input');
    if (stockInput) {
        stockInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 阻止默认提交
                const q = stockInput.value.trim();
                // 立即清空
                stockInput.value = '';

                if (!q) return;
                // 允许重复搜索相同的码（如果用户想重新定位）
                // if (window._stockLastQuery === q) { showInfo('已搜索过该条码或关键词'); return; }
                window._stockLastQuery = q;
                try {
                    // 注意：searchStock 通常会读取 input 的值，我们需要修改它以接受参数
                    // 或者我们临时把值放回去？
                    // 更好的做法是修改 searchStock 函数接受参数，或者在这里临时设置回去
                    // 但由于我们已经清空了，searchStock 如果只读 DOM 就会失败

                    // 让我们先看看 searchStock 的实现
                    // 假设 searchStock 读取 DOM，我们需要传递参数
                    // 如果 searchStock 不支持参数，我们需要重构它

                    // 暂时方案：手动设置 input 值供 searchStock 读取，但在 UI 上看起来是清空的？
                    // 不，这很奇怪。
                    // 正确做法：searchStock 应该支持参数。

                    // 让我们先假设 searchStock 需要重构支持参数
                    // 如果不支持，我们在这里调用它之前，先不清空？
                    // 不，不清空就会有重复输入问题。

                    // 让我们先检查 searchStock 的实现
                    await searchStock(q);
                    stockInput.focus();
                } catch (err) { showError('库存搜索失败: ' + err.message); }
            }
        });
    }

    const stockWarehouse = document.getElementById('stock-warehouse');
    if (stockWarehouse) {
        stockWarehouse.addEventListener('change', () => {
            const q = document.getElementById('stock-search-input').value || '';
            const w = stockWarehouse.value || '';
            loadStockList(q, w);
        });
    }

    const inboundTbody = document.getElementById('inbound-list-body');
    if (inboundTbody) {
        inboundTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target && target.matches('input[data-role="inbound-qty"]'))) return;
            const tr = target.closest('tr');
            const code = tr && tr.getAttribute('data-code');
            if (!code) return;
            const val = parseInt(target.value, 10) || 0;
            if (val < 1) target.value = 1;
            const pending = window.getPendingInbound();
            pending[code] = val;
            window.setPendingInbound(pending);
        });
    }

    const outboundTbody = document.getElementById('outbound-list-body');
    if (outboundTbody) {
        outboundTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (!(target && target.matches('input[data-role="outbound-qty"]'))) return;
            const tr = target.closest('tr');
            const code = tr && tr.getAttribute('data-code');
            if (!code) return;
            let val = parseInt(target.value, 10);
            if (Number.isNaN(val)) val = 1;
            val = Math.max(1, val);
            const cell = tr.querySelector('[data-role="current-stock"]');
            const max = cell ? parseInt(cell.textContent, 10) : NaN;
            if (!Number.isNaN(max) && val > max) {
                val = max;
                showError('超过当前库存，已回退到最大可用值');
            }
            target.value = String(val);
            pendingOutbound[code] = val;
        });
    }

    const searchInput = document.getElementById('sku-main-input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = searchInput.value.trim();
                if (!q) return;
                if (q === lastSearchQuery) { showInfo('已搜索过该条码或关键词'); return; }
                lastSearchQuery = q;
                loadSKUs(1, q);
                searchInput.value = '';
                searchInput.focus();
            }
        });
    }

    window.handleImgError = async function (img) {
        try {
            const signed = await createSignedUrlFromPublicUrl(img.src, 3600);
            if (signed) {
                img.onerror = null;
                img.src = signed;
                return;
            }
        } catch (_) { }
        img.onerror = null;
        img.src = 'https://via.placeholder.com/300';
    }

    // Bind Global Events
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });

    // Bind Image Input
    const imgInput = document.getElementById('sku-img-input');
    if (imgInput) {
        imgInput.addEventListener('change', handleImageSelect);
    }
});

async function getSKUByBarcodeCached(code) {
    if (window._skuCacheByBarcode[code]) return window._skuCacheByBarcode[code];
    const sku = await fetchSKUByBarcode(code);
    if (sku) window._skuCacheByBarcode[code] = sku;
    return sku;
}

// Expose auth actions
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;

// ==========================================
// ==========================================
// ==========================================
// Expenses Logic (已移至 modules/expenses.js)
// ==========================================

// ==========================================
// ==========================================
// System Settings Logic (已移至 modules/settings.js)
// ==========================================

// 切换侧边栏 (移动端)
window.toggleSidebar = function () {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

// 初始化移动端菜单
function initMobileMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', toggleSidebar);
    }

    // 点击菜单项自动关闭侧边栏
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
    });
}

// 初始化应用
async function initApp() {
    logger.info('App initialized.');
    initMobileMenu();
}

// 确保在页面加载完成后调用 initApp
document.addEventListener('DOMContentLoaded', initApp);
