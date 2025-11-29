/**
 * Settings Module
 * 系统设置模块
 */

import {
    fetchSettings,
    fetchWarehouseConstraints,
    fetchPriceRules
} from '../supabase-client.js';
import { showError, showSuccess } from '../utils.js';
import { logger } from '../logger.js';

// ==========================================
// 全局配置缓存加载
// ==========================================

/**
 * 加载全局配置缓存
 */
export async function loadSettings() {
    try {
        const types = ['shop', 'warehouse', 'inbound_type', 'outbound_type', 'expense_type', 'status', 'sales_channel'];
        await Promise.all(types.map(async type => {
            const data = await fetchSettings(type);
            if (!window._settingsCache[type]) window._settingsCache[type] = {};
            data.forEach(item => {
                window._settingsCache[type][item.code] = item.name;
            });
        }));
        console.log('Settings cache updated');
    } catch (err) {
        logger.error('Failed to load settings cache:', err);
    }
}

/**
 * 加载仓库约束关系
 */
export async function loadWarehouseConstraints() {
    try {
        const data = await fetchWarehouseConstraints();

        // 构建 WAREHOUSE_RULES 格式
        const rules = {};
        data.forEach(constraint => {
            if (!rules[constraint.warehouse_code]) {
                rules[constraint.warehouse_code] = { inbound: [], outbound: [] };
            }
            rules[constraint.warehouse_code][constraint.direction].push(
                constraint.movement_type_code
            );
        });

        window._warehouseConstraints = rules;
        console.log('仓库约束关系已加载:', rules);
    } catch (error) {
        logger.error('加载仓库约束关系失败:', error);
        // 使用空对象作为后备
        window._warehouseConstraints = {};
    }
}

/**
 * 加载价格规则
 */
export async function loadPriceRules() {
    try {
        const data = await fetchPriceRules();

        // 构建 PRICE_RULES 格式
        const rules = {};
        data.forEach(rule => {
            rules[rule.code] = {
                source: rule.price_source,
                currency: rule.currency
            };
        });

        window._priceRules = rules;
        console.log('价格规则已加载:', rules);
    } catch (error) {
        logger.error('加载价格规则失败:', error);
        // 使用空对象作为后备
        window._priceRules = {};
    }
}

// ==========================================
// 系统设置页面
// ==========================================

/**
 * 加载系统设置页面
 */
export async function loadSystemSettings() {
    try {
        const { data, error } = await window.supabase
            .from('settings')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('Error fetching settings:', error);
            throw error;
        }

        // 分组
        const groups = {
            shop: [],
            warehouse: [],
            inbound_type: [],
            outbound_type: [],
            expense_type: [],
            status: [],
            sales_channel: []
        };

        data.forEach(item => {
            let typeKey = item.type.toLowerCase();

            // Handle CamelCase to snake_case
            if (item.type === 'InboundType') typeKey = 'inbound_type';
            else if (item.type === 'OutboundType') typeKey = 'outbound_type';
            else if (item.type === 'ExpenseType') typeKey = 'expense_type';
            else if (item.type === 'SalesChannel') typeKey = 'sales_channel';
            else if (item.type === 'Status') typeKey = 'status';

            if (groups[typeKey]) {
                groups[typeKey].push(item);
            }
        });

        // 渲染
        Object.keys(groups).forEach(type => {
            renderSettingList(type, groups[type]);
        });

    } catch (err) {
        logger.error('加载系统设置失败:', err);
        showError('加载系统设置失败');
    }
}

/**
 * 渲染设置列表
 */
export function renderSettingList(type, items) {
    const container = document.getElementById(`${type}-list`);
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div class="text-center text-secondary text-sm" style="padding: 20px;">暂无数据</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        const isDisabled = item.status === 'disabled';
        return `
            <div class="setting-item">
                <span class="setting-name ${isDisabled ? 'disabled' : ''}">${item.name}</span>
                <div class="setting-actions">
                    <button class="btn-icon-only" title="编辑" onclick="editSetting('${item.id}', '${item.name}')">
                        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-only" title="${isDisabled ? '启用' : '禁用'}" onclick="toggleSettingStatus('${item.id}', '${isDisabled ? 'active' : 'disabled'}')">
                        ${isDisabled
                ? '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
                : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 获取数据库存储的类型名称 (PascalCase)
 */
export function getDBSettingType(type) {
    const typeMap = {
        shop: 'Shop',
        warehouse: 'Warehouse',
        inbound_type: 'InboundType',
        outbound_type: 'OutboundType',
        expense_type: 'ExpenseType',
        status: 'Status',
        sales_channel: 'SalesChannel'
    };
    return typeMap[type] || type.replace(/(^|_)(\w)/g, (_, __, ch) => ch.toUpperCase()).replace(/_/g, '');
}

/**
 * 切换设置状态
 */
export async function toggleSettingStatus(id, newStatus) {
    try {
        // 先获取这个设置的类型，以便知道要刷新哪些下拉选项
        const { data: settingData, error: fetchError } = await window.supabase
            .from('settings')
            .select('type')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;

        // 更新状态
        const { error } = await window.supabase
            .from('settings')
            .update({ status: newStatus })
            .eq('id', id);

        if (error) throw error;

        // 先刷新UI,再显示成功消息
        await loadSystemSettings();
        await loadSettings();

        // 自动刷新所有相关的下拉选项
        refreshSelectOptionsByType(settingData.type);

        showSuccess(newStatus === 'active' ? '已启用' : '已禁用');

    } catch (err) {
        showError('操作失败: ' + err.message);
    }
}

/**
 * 根据设置类型刷新对应的下拉选项
 */
function refreshSelectOptionsByType(type) {
    // 类型映射：数据库类型 -> 下拉选项名称
    const typeToSelectMap = {
        'Shop': 'shop_code',
        'Warehouse': 'warehouse_code',
        'InboundType': 'inbound_type_code',
        'OutboundType': 'outbound_type_code',
        'ExpenseType': 'ExpenseType',
        'Status': 'status_code',
        'SalesChannel': 'sales_channel'
    };

    const selectName = typeToSelectMap[type];
    if (!selectName) return;

    // 转换为 fetchSettings 需要的格式
    const typeMap = {
        'Shop': 'shop',
        'Warehouse': 'warehouse',
        'InboundType': 'inbound_type',
        'OutboundType': 'outbound_type',
        'ExpenseType': 'expense_type',
        'Status': 'status',
        'SalesChannel': 'sales_channel'
    };

    const fetchType = typeMap[type];
    if (!fetchType) return;

    // 调用 loadSelectOptions 刷新所有相关下拉框
    if (typeof window.loadSelectOptions === 'function') {
        window.loadSelectOptions(selectName, fetchType);
    }
}

// 当前编辑的设置 ID
let currentEditingSettingId = null;

/**
 * 编辑设置
 */
export function editSetting(id, currentName) {
    currentEditingSettingId = id;
    const input = document.getElementById('edit-setting-input');
    if (input) {
        input.value = currentName;
        window.openModal('edit-setting-modal');
        setTimeout(() => input.focus(), 100);
    }
}

/**
 * 保存设置编辑
 */
export async function saveSettingEdit() {
    if (!currentEditingSettingId) return;

    const input = document.getElementById('edit-setting-input');
    const newName = input.value.trim();

    if (!newName) {
        showError('名称不能为空');
        return;
    }

    try {
        const { error } = await window.supabase
            .from('settings')
            .update({ name: newName })
            .eq('id', currentEditingSettingId);

        if (error) throw error;

        showSuccess('更新成功');
        window.closeModal('edit-setting-modal');
        loadSystemSettings();
        loadSettings(); // Update global cache

    } catch (err) {
        logger.error('Update failed:', err);
        showError('更新失败: ' + err.message);
    }
}

/**
 * 初始化设置编辑按钮
 */
export function initSettingsEditButton() {
    const saveBtn = document.getElementById('save-setting-btn');
    if (saveBtn && !saveBtn._settingsBound) {
        saveBtn.onclick = saveSettingEdit;
        saveBtn._settingsBound = true;
    }
}

// ==========================================
// 全局暴露
// ==========================================

window.loadSettings = loadSettings;
window.loadWarehouseConstraints = loadWarehouseConstraints;
window.loadPriceRules = loadPriceRules;
window.loadSystemSettings = loadSystemSettings;
window.toggleSettingStatus = toggleSettingStatus;
window.editSetting = editSetting;

// 初始化编辑按钮（在 DOM 加载后）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsEditButton);
} else {
    initSettingsEditButton();
}
