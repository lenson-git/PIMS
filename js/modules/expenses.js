/**
 * Expenses Module
 * 费用管理模块
 */

import {
    fetchExpenses,
    createExpense,
    updateExpense,
    deleteExpense,
    fetchSettings,
    uploadImage,
    createSignedUrlFromPublicUrl
} from '../supabase-client.js';
import { getSettingName, formatCurrency, formatDate, showError, showSuccess } from '../utils.js';
import { logger } from '../logger.js';
import { fetchExchangeRate, getCurrentExchangeRate } from './dashboard.js';

// ==========================================
// 初始化
// ==========================================

/**
 * 初始化费用视图
 */
export function initExpensesView() {
    // 1. 设置默认日期
    const today = new Date().toISOString().split('T')[0];

    // 快速录入: 默认为今天
    const newExpenseDate = document.getElementById('new-expense-date');
    if (newExpenseDate && !newExpenseDate.value) {
        newExpenseDate.value = today;
    }

    // 筛选: 结束日期默认为今天
    const filterDateTo = document.getElementById('date-to');
    if (filterDateTo && !filterDateTo.value) {
        filterDateTo.value = today;
    }

    // 筛选: 开始日期默认为本月第一天
    const filterDateFrom = document.getElementById('date-from');
    if (filterDateFrom && !filterDateFrom.value) {
        const monthStart = new Date();
        monthStart.setDate(1);
        filterDateFrom.value = monthStart.toISOString().split('T')[0];
    }

    // 2. 加载费用列表
    loadExpenses();

    // 3. 初始化浮动标签
    if (typeof window.initFloatingLabels === 'function') {
        window.initFloatingLabels();
    }

    // 4. 绑定图片自动上传
    setupImageAutoUpload();
}

// ==========================================
// 图片自动上传
// ==========================================

/**
 * 设置图片自动上传
 */
function setupImageAutoUpload() {
    // 新增费用的图片上传 - 立即绑定
    const newImageInput = document.getElementById('expense-image-input');
    if (newImageInput) {
        console.log('[Expenses] Found new expense image input, binding change event');
        // 移除旧的监听器（如果有）- 虽然 addEventListener 不会重复添加相同的函数引用，但这里是匿名函数
        // 为了安全起见，我们可以先克隆节点来移除所有监听器，或者只依赖 _uploadBound 标记
        if (!newImageInput._uploadBound) {
            newImageInput.addEventListener('change', async (e) => {
                console.log('[Expenses] New expense image input changed');
                await handleImageUpload(e.target, 'expense-image-success', 'new');
            });
            newImageInput._uploadBound = true;  // 标记已绑定
            console.log('[Expenses] New expense image input bound');
        } else {
            console.log('[Expenses] New expense image input already bound');
        }
    } else {
        console.warn('[Expenses] New expense image input not found');
    }
}

/**
 * 设置编辑模态框的图片自动上传
 */
function setupEditImageAutoUpload() {
    // 编辑费用的图片上传 - 在打开模态框时绑定
    const editImageInput = document.getElementById('edit-expense-image-input');
    if (editImageInput) {
        console.log('[Expenses] Found edit expense image input, binding change event');
        if (!editImageInput._uploadBound) {
            editImageInput.addEventListener('change', async (e) => {
                console.log('[Expenses] Edit expense image input changed');
                await handleImageUpload(e.target, 'edit-expense-image-success', 'edit');
            });
            editImageInput._uploadBound = true;  // 标记已绑定
            console.log('[Expenses] Edit expense image input bound');
        } else {
            console.log('[Expenses] Edit expense image input already bound');
        }
    } else {
        console.warn('[Expenses] Edit expense image input not found');
    }
}

/**
 * 处理图片上传
 */
async function handleImageUpload(inputElement, successBadgeId, context) {
    console.log(`[Expenses] Handling image upload for context: ${context}`);
    const file = inputElement.files[0];
    if (!file) {
        console.log('[Expenses] No file selected');
        return;
    }

    const successBadge = document.getElementById(successBadgeId);

    try {
        // 显示上传中状态
        if (successBadge) {
            successBadge.style.display = 'none'; // 先隐藏成功标记
        }

        // 找到触发按钮
        const wrapper = inputElement.closest('.image-upload-wrapper');
        const btn = wrapper ? wrapper.querySelector('.btn') : null;
        const originalBtnText = btn ? btn.innerHTML : '';

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `
                <div class="loading-spinner-small"></div>
                上传中...
            `;
        }

        // 上传图片
        console.log('[Expenses] Starting upload...');
        const imageUrl = await uploadImage(file, 'expenses');
        console.log('[Expenses] Upload success, URL:', imageUrl);

        // 保存上传的 URL 到临时变量
        if (context === 'new') {
            window._newExpenseImageUrl = imageUrl;
        } else if (context === 'edit') {
            window._editExpenseImageUrl = imageUrl;
        }

        // 恢复按钮状态
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnText;
        }

        // 显示成功标记
        if (successBadge) {
            successBadge.style.display = 'flex';
            successBadge.style.width = '';
            successBadge.style.borderRadius = '';
            successBadge.style.padding = '';
            successBadge.style.background = '';
            successBadge.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
        }

        showSuccess('图片上传成功');
    } catch (err) {
        logger.error('图片上传失败:', err);
        showError('图片上传失败: ' + err.message);

        // 隐藏成功标识
        if (successBadge) {
            successBadge.style.display = 'none';
        }

        // 清空文件输入
        inputElement.value = '';
    }
}

// ==========================================
// 数据加载
// ==========================================

/**
 * 加载费用列表
 */
export async function loadExpenses() {
    const tbody = document.getElementById('expenses-list-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">加载中...</td></tr>';

    try {
        const filters = {
            startDate: document.getElementById('date-from').value,
            endDate: document.getElementById('date-to').value,
            type: document.getElementById('expense-type-filter').value
        };

        await fetchExchangeRate();
        const [expenses, expenseTypes] = await Promise.all([
            fetchExpenses(filters),
            fetchSettings('ExpenseType')
        ]);

        if (!window._settingsCache['ExpenseType']) window._settingsCache['ExpenseType'] = {};
        expenseTypes.forEach(item => {
            window._settingsCache['ExpenseType'][item.code || item.name] = item.name;
        });

        renderExpenses(expenses);
    } catch (err) {
        logger.error('加载费用失败:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-error">加载失败</td></tr>';
        showError('加载费用列表失败');
    }
}

/**
 * 渲染费用列表
 */
function renderExpenses(expenses) {
    // 缓存费用数据供编辑功能使用
    window._expensesCache = expenses;

    const tbody = document.getElementById('expenses-list-body');
    tbody.innerHTML = '';

    if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">暂无数据</td></tr>';
        return;
    }

    let totalAmountTHB = 0;

    expenses.forEach((expense, index) => {
        const amt = parseFloat(expense.amount || 0);
        const cur = (expense.currency || 'THB').toUpperCase();
        const rateCnyToThb = getCurrentExchangeRate() || 4.8;
        if (cur === 'THB') totalAmountTHB += amt;
        else if (cur === 'RMB' || cur === 'CNY') totalAmountTHB += amt * rateCnyToThb;
        else totalAmountTHB += amt;

        const tr = document.createElement('tr');

        // 凭证列: 有图片显示图标, 无图片显示 -
        const receiptCell = expense.picture_id
            ? `<button class="btn-view-image" onclick="showLightbox('${expense.picture_id}')" title="查看凭证">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
               </button>`
            : `<span class="text-secondary">-</span>`;

        // 类型名称
        const typeName = getSettingName('ExpenseType', expense.expense_type_code) || expense.expense_type_code;

        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${formatDate(expense.timestamp)}</td>
            <td><span class="expense-type-badge">${typeName}</span></td>
            <td class="text-right font-num">${formatCurrency(expense.amount, expense.currency || 'THB')}</td>
            <td class="text-secondary">${expense.description || '-'}</td>
            <td class="text-center">${receiptCell}</td>
            <td class="text-center">
                <div class="action-icons">
                    <button class="btn-icon-action" onclick="openEditExpenseModal('${expense.id}')" title="编辑">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-action text-error" onclick="deleteExpenseAction('${expense.id}')" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 更新统计信息
    const rateCnyToThb = getCurrentExchangeRate() || 4.8;
    document.querySelector('.expenses-list-panel .panel-info').innerHTML =
        `共 <strong>${expenses.length}</strong> 条记录 | 总计: <strong class="text-error">${formatCurrency(totalAmountTHB, 'THB')}</strong>` +
        ` <span class="text-secondary">(汇率: 1 CNY ≈ ${rateCnyToThb.toFixed(2)} THB)</span>`;
}

// ==========================================
// 筛选功能
// ==========================================

/**
 * 快速日期选择
 */
export function selectQuickDate(period) {
    const today = new Date();
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');

    switch (period) {
        case 'today':
            dateFrom.value = today.toISOString().split('T')[0];
            dateTo.value = today.toISOString().split('T')[0];
            break;
        case 'thisWeek':
            const weekStart = new Date(today.setDate(today.getDate() - today.getDay()));
            dateFrom.value = weekStart.toISOString().split('T')[0];
            dateTo.value = new Date().toISOString().split('T')[0];
            break;
        case 'thisMonth':
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            dateFrom.value = monthStart.toISOString().split('T')[0];
            dateTo.value = new Date().toISOString().split('T')[0];
            break;
        case 'lastMonth':
            const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
            dateFrom.value = lastMonthStart.toISOString().split('T')[0];
            dateTo.value = lastMonthEnd.toISOString().split('T')[0];
            break;
    }

    // 触发浮动标签更新
    if (typeof window.initFloatingLabels === 'function') {
        window.initFloatingLabels();
    }
    loadExpenses();
}

/**
 * 应用筛选
 */
export function applyFilters() {
    loadExpenses();
}

/**
 * 重置筛选
 */
export function resetFilters() {
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = new Date().toISOString().split('T')[0];
    document.getElementById('expense-type-filter').value = '';
    if (typeof window.initFloatingLabels === 'function') {
        window.initFloatingLabels();
    }
    loadExpenses();
}

// ==========================================
// CRUD 操作
// ==========================================

/**
 * 添加费用
 */
export async function addExpense() {
    const date = document.getElementById('new-expense-date').value;
    const type = document.getElementById('new-expense-type').value;
    const amount = document.getElementById('new-expense-amount').value;
    const currency = document.getElementById('new-expense-currency').value;
    const note = document.getElementById('new-expense-note').value;
    const imageInput = document.getElementById('expense-image-input');
    const successBadge = document.getElementById('expense-image-success');

    if (!date || !type || !amount) {
        showError('请填写必填项：日期、类型、金额');
        // 摇动第一个空的必填项
        const firstEmpty = !date ? document.getElementById('new-expense-date') :
            !type ? document.getElementById('new-expense-type') :
                document.getElementById('new-expense-amount');
        if (firstEmpty && typeof window.shakeElement === 'function') {
            window.shakeElement(firstEmpty.parentElement || firstEmpty);
        }
        return;
    }

    try {
        // 使用已上传的图片 URL
        let imageUrl = window._newExpenseImageUrl || null;

        // 兜底逻辑：如果自动上传没成功（imageUrl为空），但用户选了文件，则尝试手动上传
        if (!imageUrl && imageInput.files.length > 0) {
            console.log('[Expenses] Auto-upload URL not found, trying manual upload...');
            if (successBadge) {
                successBadge.style.display = 'flex';
                successBadge.innerHTML = '<span>上传中...</span>';
            }
            imageUrl = await uploadImage(imageInput.files[0], 'expenses');
            console.log('[Expenses] Manual upload success, URL:', imageUrl);
        }

        await createExpense({
            timestamp: date,
            expense_type_code: type,
            amount: parseFloat(amount),
            currency,
            description: note,
            picture_id: imageUrl
        });

        showSuccess('添加费用成功');

        // 清空表单
        document.getElementById('new-expense-amount').value = '';
        document.getElementById('new-expense-note').value = '';
        imageInput.value = '';

        // 清空临时变量和成功标识
        window._newExpenseImageUrl = null;
        if (successBadge) successBadge.style.display = 'none';

        loadExpenses();
    } catch (err) {
        logger.error('添加费用失败:', err);
        showError('添加费用失败: ' + err.message);
        // 如果失败，也要隐藏上传标识（如果是手动上传触发的）
        if (successBadge && !window._newExpenseImageUrl) successBadge.style.display = 'none';
    }
}

/**
 * 打开编辑模态框
 */
export async function openEditExpenseModal(id) {
    try {
        if (!window._expensesCache) {
            showError('数据未加载,请刷新重试');
            return;
        }

        const expense = window._expensesCache.find(e => e.id == id);

        if (!expense) {
            showError('未找到该费用记录');
            return;
        }

        // 保存当前编辑的ID
        window._editingExpenseId = id;

        // 填充表单
        document.getElementById('edit-expense-date').value = expense.timestamp.split('T')[0];
        document.getElementById('edit-expense-amount').value = expense.amount;
        document.getElementById('edit-expense-currency').value = expense.currency || 'THB';
        document.getElementById('edit-expense-note').value = expense.description || '';

        // 填充类型下拉框 - 修复：不传入 selectedValue，避免影响筛选器
        const typeSelect = document.getElementById('edit-expense-type');
        if (typeof window.loadSelectOptions === 'function') {
            // 只加载选项，不设置选中值（避免影响其他同名 select）
            await window.loadSelectOptions('ExpenseType', 'ExpenseType', null, 'edit-expense-type');
        }
        // 手动设置编辑模态框的选中值
        typeSelect.value = expense.expense_type_code;

        // 显示当前图片
        const currentImageDiv = document.getElementById('edit-expense-current-image');
        const imagePreview = document.getElementById('edit-expense-image-preview');
        if (expense.picture_id) {
            const imageUrl = await createSignedUrlFromPublicUrl(expense.picture_id);
            imagePreview.src = imageUrl;
            currentImageDiv.style.display = 'block';
        } else {
            currentImageDiv.style.display = 'none';
        }

        // 隐藏上传成功标识
        const successBadge = document.getElementById('edit-expense-image-success');
        if (successBadge) successBadge.style.display = 'none';

        // 清空文件输入
        document.getElementById('edit-expense-image-input').value = '';

        // 打开模态框
        document.getElementById('edit-expense-modal').classList.add('active');
        if (typeof window.initFloatingLabels === 'function') {
            window.initFloatingLabels();
        }

        // 绑定编辑图片的自动上传
        setupEditImageAutoUpload();

    } catch (err) {
        logger.error('打开编辑框失败:', err);
        showError('打开编辑框失败: ' + err.message);
    }
}

/**
 * 关闭编辑模态框
 */
export function closeEditExpenseModal() {
    document.getElementById('edit-expense-modal').classList.remove('active');
    window._editingExpenseId = null;
}

/**
 * 保存编辑
 */
export async function saveExpenseEdit() {
    const id = window._editingExpenseId;
    if (!id) {
        showError('无效的编辑操作');
        return;
    }

    const date = document.getElementById('edit-expense-date').value;
    const type = document.getElementById('edit-expense-type').value;
    const amount = document.getElementById('edit-expense-amount').value;
    const currency = document.getElementById('edit-expense-currency').value;
    const note = document.getElementById('edit-expense-note').value;
    const imageInput = document.getElementById('edit-expense-image-input');

    if (!date || !type || !amount) {
        showError('请填写必填项:日期、类型、金额');
        // 摇动第一个空的必填项
        const firstEmpty = !date ? document.getElementById('edit-expense-date') :
            !type ? document.getElementById('edit-expense-type') :
                document.getElementById('edit-expense-amount');
        if (firstEmpty && typeof window.shakeElement === 'function') {
            window.shakeElement(firstEmpty.parentElement || firstEmpty);
        }
        return;
    }

    try {
        const updates = {
            timestamp: date,
            expense_type_code: type,
            amount: parseFloat(amount),
            currency,
            description: note
        };

        // 如果有已上传的图片,使用它
        if (window._editExpenseImageUrl) {
            updates.picture_id = window._editExpenseImageUrl;
        }
        // 兜底逻辑：如果自动上传没成功，但用户选了文件，则尝试手动上传
        else if (imageInput.files.length > 0) {
            console.log('[Expenses] Auto-upload URL not found for edit, trying manual upload...');
            updates.picture_id = await uploadImage(imageInput.files[0], 'expenses');
            console.log('[Expenses] Manual upload success for edit');
        }

        await updateExpense(id, updates);
        showSuccess('更新成功');

        // 清空临时变量
        window._editExpenseImageUrl = null;

        closeEditExpenseModal();
        loadExpenses();
    } catch (err) {
        logger.error('更新失败:', err);
        showError('更新失败: ' + err.message);
    }
}

/**
 * 删除费用
 */
export async function deleteExpenseAction(id) {
    const ok = window.confirm('确定要删除这条费用记录吗?');
    if (!ok) return;

    try {
        await deleteExpense(id);
        showSuccess('删除成功');
        loadExpenses();
    } catch (err) {
        showError('删除失败: ' + err.message);
    }
}

// ==========================================
// 全局暴露
// ==========================================

window.initExpensesView = initExpensesView;
window.loadExpenses = loadExpenses;
window.selectQuickDate = selectQuickDate;
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.addExpense = addExpense;
window.openEditExpenseModal = openEditExpenseModal;
window.closeEditExpenseModal = closeEditExpenseModal;
window.saveExpenseEdit = saveExpenseEdit;
window.deleteExpenseAction = deleteExpenseAction;
