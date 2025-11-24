/* global XLSX, supabase, showSuccess, showError, openModal, closeModal */
/**
 * 入库批量导入模块
 * 复用 SKU 批量导入的核心逻辑,针对入库场景定制
 */

// 备用函数：如果全局没有定义，则使用本地实现
if (typeof window.openModal === 'undefined') {
    window.openModal = function (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        }
    };
}

if (typeof window.closeModal === 'undefined') {
    window.closeModal = function (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    };
}

// 全局状态
let currentInboundData = null;
let currentValidationResult = null;

console.log('Inbound Bulk Import Script Loaded');

/**
 * 打开入库批量导入模态框
 */
window.openInboundBulkImportModal = function () {
    console.log('[DEBUG] 打开入库批量导入模态框');
    if (typeof XLSX === 'undefined') {
        console.error('XLSX library not loaded!');
        showError('系统错误：Excel 解析库未加载');
        return;
    }

    // 重置状态
    currentInboundData = null;
    currentValidationResult = null;

    // 清空文件输入
    const fileInput = document.getElementById('inbound-import-file');
    if (fileInput) {
        fileInput.value = '';
    }

    // 清空预览和验证结果
    const previewContainer = document.getElementById('inbound-preview-container');
    const validationResult = document.getElementById('inbound-validation-result');
    const previewTable = document.getElementById('inbound-preview-table');

    previewContainer.style.display = 'none';
    validationResult.style.display = 'none';
    previewTable.innerHTML = '';
    validationResult.innerHTML = '';

    // 禁用确认按钮
    document.getElementById('confirm-inbound-import-btn').disabled = true;

    // 打开模态框
    window.openModal('inbound-bulk-import-modal');

    // 事件监听器已在 HTML 的 onchange 属性中定义，无需手动绑定
};

/**
 * 处理文件选择
 */
window.handleInboundImportFile = async function (event) {
    console.log('[DEBUG] handleInboundImportFile 开始');

    const file = event.target.files[0];
    if (!file) return;

    console.log('[DEBUG] 文件名:', file.name);

    try {
        // 解析 Excel
        console.log('[DEBUG] 开始解析 Excel...');
        const data = await parseInboundExcel(file);
        console.log('[DEBUG] Excel 解析完成，数据行数:', data.length);

        // 保存数据
        currentInboundData = data;
        console.log('[DEBUG] 数据已保存');

        // 验证数据
        console.log('[DEBUG] 开始验证数据...');
        await validateInboundData(data);
        console.log('[DEBUG] 验证完成');

    } catch (error) {
        console.error('文件处理失败:', error);
        showError('文件处理失败: ' + error.message);
    }
};

/**
 * 解析 Excel 文件
 */
async function parseInboundExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                console.log('[DEBUG] 工作表列表:', workbook.SheetNames);

                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);

                console.log('[DEBUG] 使用工作表 "' + workbook.SheetNames[0] + '" 的列名:', Object.keys(jsonData[0] || {}));

                // 标准化数据
                const normalized = jsonData.map(row => ({
                    sku_id: String(row['SKU ID'] || row['sku_id'] || row['条码'] || '').trim(),
                    quantity: parseInt(row['入库数量'] || row['quantity'] || row['数量'] || 0)
                }));

                resolve(normalized);
            } catch (error) {
                reject(new Error('Excel 解析失败: ' + error.message));
            }
        };

        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 验证入库数据
 */
async function validateInboundData(data) {
    console.log('[DEBUG] validateInboundData 开始，数据行数:', data.length);

    const errors = [];
    const validationResult = document.getElementById('inbound-validation-result');
    const confirmBtn = document.getElementById('confirm-inbound-import-btn');

    try {
        // 1. 基础验证
        data.forEach((row, index) => {
            if (!row.sku_id) {
                errors.push({ row: index + 1, message: 'SKU ID 不能为空' });
            }
            if (!row.quantity || row.quantity <= 0) {
                errors.push({ row: index + 1, sku: row.sku_id, message: '入库数量必须大于 0' });
            }
        });

        // 2. 查询 SKU 是否存在
        const skuIds = data.map(row => row.sku_id).filter(Boolean);
        console.log('[DEBUG] 查询 SKU:', skuIds);

        const { data: existingSKUs, error: queryError } = await supabase
            .from('v_skus')
            .select('id, external_barcode, product_info, pic, purchase_price_rmb')
            .in('external_barcode', skuIds);

        if (queryError) throw queryError;

        console.log('[DEBUG] 查询到', existingSKUs.length, '个 SKU');

        // 3. 检查缺失的 SKU
        const existingIds = new Set(existingSKUs.map(s => s.external_barcode));
        const missingSkus = skuIds.filter(id => !existingIds.has(id));

        if (missingSkus.length > 0) {
            missingSkus.forEach(sku => {
                errors.push({ sku, message: 'SKU 不存在于数据库中，请先录入' });
            });
        }

        // 4. 显示验证结果
        validationResult.style.display = 'block';
        let html = '<div class="validation-summary">';
        html += `<p class="validation-item success">✓ 共 ${data.length} 条数据</p>`;

        if (errors.length > 0) {
            html += `<p class="validation-item error">✗ 发现 ${errors.length} 个问题</p>`;
            errors.forEach(err => {
                html += `<p class="validation-item error">• 第 ${err.row || ''} 行 ${err.sku || ''}: ${err.message}</p>`;
            });
            confirmBtn.disabled = true;
        } else {
            html += `<p class="validation-item success">✓ 所有 SKU 验证通过</p>`;
            confirmBtn.disabled = false;

            // 渲染预览
            renderInboundPreview(data, existingSKUs);
        }

        html += '</div>';
        validationResult.innerHTML = html;

        // 保存验证结果
        currentValidationResult = {
            valid: errors.length === 0,
            errors,
            skuDetails: existingSKUs
        };

    } catch (error) {
        console.error('验证失败:', error);
        showError('验证失败: ' + error.message);
    }
}

/**
 * 渲染入库预览
 */
function renderInboundPreview(data, skuDetails) {
    console.log('[DEBUG] 渲染入库预览');

    const previewContainer = document.getElementById('inbound-preview-container');
    const previewTable = document.getElementById('inbound-preview-table');

    const skuMap = new Map(skuDetails.map(s => [s.external_barcode, s]));

    let html = '<table class="data-table">';
    html += '<thead><tr>';
    html += '<th>序号</th>';
    html += '<th>产品图片</th>';
    html += '<th>SKU ID</th>';
    html += '<th>产品信息</th>';
    html += '<th>采购价格(¥)</th>';
    html += '<th>入库数量</th>';
    html += '<th>入库仓库</th>';
    html += '<th>入库类型</th>';
    html += '</tr></thead><tbody>';

    data.forEach((row, index) => {
        const sku = skuMap.get(row.sku_id);
        if (!sku) return; // 跳过不存在的 SKU

        const imgSrc = sku.pic || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><text y="50%" font-size="30" text-anchor="middle" x="50%">📦</text></svg>';

        html += '<tr>';
        html += `<td>${index + 1}</td>`;
        html += `<td><img src="${imgSrc}" alt="产品图片" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;"></td>`;
        html += `<td>${row.sku_id}</td>`;
        html += `<td>${sku.product_info || '-'}</td>`;
        html += `<td>¥${(sku.purchase_price_rmb || 0).toFixed(2)}</td>`;
        html += `<td><input type="number" class="inbound-quantity-input" data-index="${index}" value="${row.quantity}" min="1" style="width: 80px;" ${index === 0 ? 'autofocus' : ''}></td>`;
        html += `<td>主仓库</td>`;
        html += `<td>采购入库</td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';

    previewTable.innerHTML = html;
    previewContainer.style.display = 'block';

    // 绑定数量输入事件
    const inputs = document.querySelectorAll('.inbound-quantity-input');
    inputs.forEach((input, i) => {
        // 更新数据
        input.addEventListener('change', function () {
            const index = parseInt(this.dataset.index);
            const newQuantity = parseInt(this.value);
            if (currentInboundData[index]) {
                currentInboundData[index].quantity = newQuantity;
            }
        });

        // 回车跳转到下一行
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const nextInput = inputs[i + 1];
                if (nextInput) {
                    nextInput.focus();
                    nextInput.select();
                } else {
                    // 如果是最后一行，可以考虑聚焦到确认按钮
                    document.getElementById('confirm-inbound-import-btn').focus();
                }
            }
        });
    });
}

/**
 * 确认入库
 */
window.confirmInboundImport = async function () {
    if (!currentInboundData || !currentValidationResult || !currentValidationResult.valid) {
        showError('请先上传并验证文件');
        return;
    }

    try {
        console.log('[DEBUG] 开始批量入库...');

        const confirmBtn = document.getElementById('confirm-inbound-import-btn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = '入库中...';

        // 准备入库记录
        const skuMap = new Map(currentValidationResult.skuDetails.map(s => [s.external_barcode, s]));
        const records = currentInboundData
            .filter(row => skuMap.has(row.sku_id))
            .map(row => ({
                sku_id: skuMap.get(row.sku_id).id,
                warehouse_code: '主仓库',
                movement_type_code: '采购入库',
                quantity: row.quantity,
                movement_date: new Date().toISOString().split('T')[0]
            }));

        console.log('[DEBUG] 准备入库', records.length, '条记录');

        // 批量插入
        const { error } = await supabase
            .from('stock_movements')
            .insert(records);

        if (error) throw error;

        showSuccess(`成功入库 ${records.length} 条记录`);
        window.closeModal('inbound-bulk-import-modal');

        // 刷新库存列表（如果在库存页面）
        if (typeof window.loadStockList === 'function') {
            window.loadStockList();
        }

    } catch (error) {
        console.error('入库失败:', error);
        showError('入库失败: ' + error.message);
    } finally {
        const confirmBtn = document.getElementById('confirm-inbound-import-btn');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认入库';
    }
};
