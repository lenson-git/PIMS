/**
 * SKU 批量导入功能模块
 * 功能：从 Excel 批量导入 SKU，支持数据验证、重复检测和智能对比
 */

// 辅助函数：如果全局没有定义，则使用本地实现
if (typeof window.showError === 'undefined') {
    window.showError = function (message) {
        alert('错误: ' + message);
    };
}

if (typeof window.showSuccess === 'undefined') {
    window.showSuccess = function (message) {
        alert(message);
    };
}

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

// 全局变量：存储当前导入的数据
let currentImportData = null;
let currentValidationResult = null;
let duplicateComparisonData = null;
let duplicateComparisonIndex = 0;

// Excel 列名到数据库字段的映射
const EXCEL_TO_DB_MAPPING = {
    'SKU ID': 'external_barcode',
    '货品标题': 'product_info',
    '单价(元)': 'purchase_price_rmb',
    '运费(元)': 'domestic_shipping',  // 特殊处理：汇总后创建费用记录
    '店铺': 'shop_code',
    '销售价': 'selling_price_thb',
    '状态': 'status_code',
    '数量': null  // 忽略，批量入库时使用
};

// 系统字段名（用于预览表格的第一行）
const DB_FIELD_NAMES = {
    'external_barcode': '产品条码',
    'product_info': '产品信息',
    'purchase_price_rmb': '采购价(¥)',
    'domestic_shipping': '运费(¥)',
    'shop_code': '店铺',
    'selling_price_thb': '销售价(฿)',
    'status_code': '状态'
};

/**
 * 打开批量导入模态框
 */
window.importSKU = function () {
    // 重置状态
    currentImportData = null;
    currentValidationResult = null;
    duplicateComparisonData = null;

    // 清空文件输入
    const fileInput = document.getElementById('bulk-import-file');
    if (fileInput) {
        fileInput.value = '';
    }

    // 清空预览
    document.getElementById('import-preview-container').style.display = 'none';
    document.getElementById('import-validation-result').style.display = 'none';

    // 禁用确认按钮
    document.getElementById('confirm-bulk-import-btn').disabled = true;

    // 打开模态框
    window.openModal('bulk-import-modal');
};

/**
 * 处理文件选择
 */
window.handleBulkImportFile = async function (event) {
    console.log('[DEBUG] handleBulkImportFile 开始');
    const file = event.target.files[0];
    if (!file) return;

    // 检查文件类型
    const fileName = file.name.toLowerCase();
    console.log('[DEBUG] 文件名:', fileName);
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        showError('请选择 Excel 文件 (.xlsx 或 .xls)');
        return;
    }

    try {
        // 显示加载状态
        showSuccess('正在解析文件...');
        console.log('[DEBUG] 开始解析 Excel...');

        // 解析 Excel
        const data = await parseExcelFile(file);
        console.log('[DEBUG] Excel 解析完成，数据行数:', data ? data.length : 0);

        if (!data || data.length === 0) {
            showError('Excel 文件为空或格式不正确');
            return;
        }

        // 保存数据
        currentImportData = data;
        console.log('[DEBUG] 数据已保存');

        // 显示预览
        console.log('[DEBUG] 开始渲染预览...');
        renderImportPreview(data);
        console.log('[DEBUG] 预览渲染完成');

        // 验证数据
        console.log('[DEBUG] 开始验证数据...');
        await validateAndShowResult(data);
        console.log('[DEBUG] 验证完成');

    } catch (error) {
        console.error('解析文件失败:', error);
        showError('解析文件失败: ' + error.message);
    }
};

/**
 * 解析 Excel 文件
 */
async function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // 读取第一个工作表
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // 转换为 JSON
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (jsonData.length < 2) {
                    reject(new Error('Excel 文件至少需要包含表头和一行数据'));
                    return;
                }

                // 第一行是表头
                const headers = jsonData[0];
                const rows = jsonData.slice(1);

                // 转换为对象数组
                const parsedData = rows.map((row, index) => {
                    const obj = { _rowNumber: index + 2 };  // Excel 行号（从 2 开始）
                    headers.forEach((header, colIndex) => {
                        const dbField = EXCEL_TO_DB_MAPPING[header];
                        if (dbField) {
                            obj[dbField] = row[colIndex];
                        }
                        // 保留原始 Excel 列名和值（用于显示）
                        obj['_excel_' + header] = row[colIndex];
                    });
                    return obj;
                }).filter(obj => obj.external_barcode);  // 过滤掉没有 SKU ID 的行

                resolve(parsedData);

            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = function () {
            reject(new Error('读取文件失败'));
        };

        reader.readAsArrayBuffer(file);
    });
}

/**
 * 渲染导入预览表格
 */
function renderImportPreview(data) {
    const container = document.getElementById('import-preview-table');
    const previewContainer = document.getElementById('import-preview-container');

    if (!container || data.length === 0) return;

    // 显示预览容器
    previewContainer.style.display = 'block';

    // 获取所有字段
    const fields = Object.keys(EXCEL_TO_DB_MAPPING).filter(k => EXCEL_TO_DB_MAPPING[k]);

    // 构建表格 HTML
    let html = '<table class="preview-table"><thead>';

    // 第一行：系统字段名
    html += '<tr class="system-fields">';
    fields.forEach(excelCol => {
        const dbField = EXCEL_TO_DB_MAPPING[excelCol];
        const displayName = DB_FIELD_NAMES[dbField] || dbField;
        html += `<th>${displayName}</th>`;
    });
    html += '</tr>';

    // 第二行：Excel 列名
    html += '<tr class="excel-fields">';
    fields.forEach(excelCol => {
        html += `<th>${excelCol}</th>`;
    });
    html += '</tr></thead><tbody>';

    // 数据行（最多显示 10 行）
    const previewData = data.slice(0, 10);
    previewData.forEach(row => {
        html += '<tr>';
        fields.forEach(excelCol => {
            const dbField = EXCEL_TO_DB_MAPPING[excelCol];
            let value = row[dbField] || '';

            // 格式化显示
            if (dbField === 'purchase_price_rmb' || dbField === 'domestic_shipping') {
                value = value ? '¥' + parseFloat(value).toFixed(2) : '';
            } else if (dbField === 'selling_price_thb') {
                value = value ? '฿' + parseFloat(value).toFixed(2) : '';
            }

            html += `<td>${value}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';

    if (data.length > 10) {
        html += `<p class="preview-note">仅显示前 10 行，共 ${data.length} 行数据</p>`;
    }

    container.innerHTML = html;
}

/**
 * 验证数据并显示结果
 */
async function validateAndShowResult(data) {
    const resultContainer = document.getElementById('import-validation-result');
    const confirmBtn = document.getElementById('confirm-bulk-import-btn');

    try {
        // 执行验证
        const result = await validateImportData(data);
        currentValidationResult = result;

        // 显示结果
        resultContainer.style.display = 'block';

        let html = '<div class="validation-summary">';
        html += `<p class="validation-item success">✓ 共 ${data.length} 条数据</p>`;

        // 运费总计
        if (result.totalShipping > 0) {
            html += `<p class="validation-item success">✓ 运费总计：¥${result.totalShipping.toFixed(2)}</p>`;
        }

        // 错误统计
        const errorCount = result.errors.length;
        if (errorCount > 0) {
            html += `<p class="validation-item error">✗ 发现 ${errorCount} 个问题 `;
            html += `<button class="btn-link" onclick="showValidationErrors()">查看详情</button></p>`;
            confirmBtn.disabled = true;
        } else {
            confirmBtn.disabled = false;
        }

        // 重复 SKU 统计
        const duplicateCount = result.duplicates.length;
        if (duplicateCount > 0) {
            const identicalCount = result.duplicates.filter(d => d.isIdentical).length;
            const differentCount = duplicateCount - identicalCount;

            html += `<p class="validation-item warning">⚠ 发现 ${duplicateCount} 个重复 SKU `;
            html += `(${identicalCount} 个一致, ${differentCount} 个不一致) `;
            html += `<button class="btn-link" onclick="showDuplicateList()">查看详情</button></p>`;
        }

        html += '</div>';
        resultContainer.innerHTML = html;

    } catch (error) {
        console.error('验证失败:', error);
        showError('验证失败: ' + error.message);
    }
}

/**
 * 验证导入数据
 */
async function validateImportData(data) {
    console.log('[DEBUG] validateImportData 开始，数据行数:', data.length);
    const errors = [];
    const duplicates = [];
    let totalShipping = 0;

    // 1. 必填字段验证
    console.log('[DEBUG] 步骤 1: 必填字段验证...');
    data.forEach((row, index) => {
        if (!row.external_barcode) {
            errors.push({
                row: row._rowNumber,
                field: 'SKU ID',
                message: '必填字段'
            });
        }
        if (!row.product_info) {
            errors.push({
                row: row._rowNumber,
                field: '货品标题',
                message: '必填字段'
            });
        }
        if (!row.shop_code) {
            errors.push({
                row: row._rowNumber,
                field: '店铺',
                message: '必填字段'
            });
        }
    });

    // 2. 数字格式验证
    data.forEach(row => {
        if (row.purchase_price_rmb && isNaN(parseFloat(row.purchase_price_rmb))) {
            errors.push({
                row: row._rowNumber,
                field: '单价(元)',
                message: '必须是数字'
            });
        }
        if (row.selling_price_thb && isNaN(parseFloat(row.selling_price_thb))) {
            errors.push({
                row: row._rowNumber,
                field: '销售价',
                message: '必须是数字'
            });
        }
        if (row.domestic_shipping) {
            const shipping = parseFloat(row.domestic_shipping);
            if (isNaN(shipping)) {
                errors.push({
                    row: row._rowNumber,
                    field: '运费(元)',
                    message: '必须是数字'
                });
            } else {
                totalShipping += shipping;
            }
        }
    });

    // 3. Excel 内部重复检查
    const skuMap = new Map();
    data.forEach(row => {
        const sku = row.external_barcode;
        if (skuMap.has(sku)) {
            errors.push({
                row: row._rowNumber,
                field: 'SKU ID',
                message: `与第 ${skuMap.get(sku)} 行重复`
            });
        } else {
            skuMap.set(sku, row._rowNumber);
        }
    });

    // 4. 数据库重复检查
    const skuIds = data.map(row => row.external_barcode).filter(Boolean);
    if (skuIds.length > 0) {
        try {
            const { data: existingSKUs, error } = await supabase
                .from('v_skus')
                .select('external_barcode, product_info, purchase_price_rmb, selling_price_thb, shop_code, pic')
                .in('external_barcode', skuIds);

            if (error) throw error;

            if (existingSKUs && existingSKUs.length > 0) {
                // 对比数据
                existingSKUs.forEach(existing => {
                    const importing = data.find(d => d.external_barcode === existing.external_barcode);
                    if (importing) {
                        const isIdentical = (
                            existing.product_info === importing.product_info &&
                            parseFloat(existing.purchase_price_rmb || 0) === parseFloat(importing.purchase_price_rmb || 0) &&
                            parseFloat(existing.selling_price_thb || 0) === parseFloat(importing.selling_price_thb || 0) &&
                            existing.shop_code === importing.shop_code
                        );

                        duplicates.push({
                            sku: existing.external_barcode,
                            existing: existing,
                            importing: importing,
                            isIdentical: isIdentical,
                            action: isIdentical ? 'skip' : 'pending'
                        });
                    }
                });
            }
        } catch (error) {
            console.error('检查重复 SKU 失败:', error);
        }
    }

    // 5. 店铺代码验证
    const shopCodes = [...new Set(data.map(row => row.shop_code).filter(Boolean))];
    if (shopCodes.length > 0 && window._settingsCache && window._settingsCache.shop) {
        const validShops = Object.keys(window._settingsCache.shop);
        shopCodes.forEach(code => {
            if (!validShops.includes(code)) {
                const rows = data.filter(d => d.shop_code === code).map(d => d._rowNumber);
                errors.push({
                    row: rows.join(', '),
                    field: '店铺',
                    message: `无效的店铺代码: ${code}`
                });
            }
        });
    }

    return {
        errors,
        duplicates,
        totalShipping
    };
}

/**
 * 显示验证错误详情
 */
window.showValidationErrors = function () {
    if (!currentValidationResult || currentValidationResult.errors.length === 0) return;

    let html = '<div class="validation-errors">';
    html += `<h4>发现 ${currentValidationResult.errors.length} 个问题：</h4>`;
    html += '<ul>';

    currentValidationResult.errors.forEach((error, index) => {
        html += `<li>${index + 1}. 第 ${error.row} 行 - ${error.field}: ${error.message}</li>`;
    });

    html += '</ul></div>';

    document.getElementById('validation-error-content').innerHTML = html;
    window.openModal('validation-error-modal');
};

/**
 * 显示重复 SKU 列表
 */
window.showDuplicateList = function () {
    if (!currentValidationResult || currentValidationResult.duplicates.length === 0) return;

    duplicateComparisonData = currentValidationResult.duplicates;

    let html = '<div class="duplicate-list">';
    html += '<p>以下 SKU 在系统中已存在，请选择处理方式：</p>';
    html += '<div class="duplicate-actions">';
    html += '<button class="btn btn-outline" onclick="handleAllDuplicates(\'skip\')">全部跳过</button>';
    html += '<button class="btn btn-outline" onclick="handleAllDuplicates(\'overwrite\')">全部覆盖</button>';
    html += '<button class="btn btn-black" onclick="reviewDuplicatesOneByOne()">逐个确认</button>';
    html += '</div>';
    html += '<ul class="duplicate-items">';

    duplicateComparisonData.forEach((dup, index) => {
        const icon = dup.isIdentical ? '✓' : '⚠';
        const className = dup.isIdentical ? 'identical' : 'different';
        const statusText = dup.isIdentical ? '数据一致，将跳过' : '数据不一致，需要确认';

        html += `<li class="${className}">`;
        html += `<span class="dup-icon">${icon}</span>`;
        html += `<span class="dup-sku">${dup.sku}</span>`;
        html += `<span class="dup-info">${dup.existing.product_info}</span>`;
        html += `<span class="dup-status">${statusText}</span>`;
        html += '</li>';
    });

    html += '</ul></div>';

    document.getElementById('duplicate-list-content').innerHTML = html;
    window.openModal('duplicate-list-modal');
};

/**
 * 批量处理所有重复项
 */
window.handleAllDuplicates = function (action) {
    if (!duplicateComparisonData) return;

    duplicateComparisonData.forEach(dup => {
        dup.action = action;
    });

    window.closeModal('duplicate-list-modal');
    showSuccess(`已设置全部重复 SKU 为"${action === 'skip' ? '跳过' : '覆盖'}"`);
};

/**
 * 逐个确认重复项
 */
window.reviewDuplicatesOneByOne = function () {
    if (!duplicateComparisonData || duplicateComparisonData.length === 0) return;

    // 只处理不一致的项
    const itemsToReview = duplicateComparisonData.filter(d => !d.isIdentical);

    if (itemsToReview.length === 0) {
        showSuccess('所有重复 SKU 数据一致，将自动跳过');
        window.closeModal('duplicate-list-modal');
        return;
    }

    duplicateComparisonIndex = 0;
    window.closeModal('duplicate-list-modal');
    showDuplicateComparison(itemsToReview);
};

/**
 * 显示重复 SKU 详细对比
 */
function showDuplicateComparison(items) {
    if (duplicateComparisonIndex >= items.length) {
        showSuccess('所有重复 SKU 已处理完成');
        return;
    }

    const item = items[duplicateComparisonIndex];
    const existing = item.existing;
    const importing = item.importing;

    let html = '<div class="duplicate-comparison">';
    html += `<p class="comparison-progress">处理进度: ${duplicateComparisonIndex + 1} / ${items.length}</p>`;

    // 系统中已存在
    html += '<div class="comparison-section">';
    html += '<h4>系统中已存在：</h4>';
    html += '<div class="comparison-card existing">';
    if (existing.pic) {
        html += `<img src="${existing.pic}" alt="产品图片" class="comparison-img">`;
    } else {
        html += '<div class="comparison-img-placeholder">无图片</div>';
    }
    html += '<div class="comparison-details">';
    html += `<p><strong>SKU ID:</strong> ${existing.external_barcode}</p>`;
    html += `<p><strong>产品信息:</strong> ${existing.product_info || '-'}</p>`;
    html += `<p><strong>采购价:</strong> ¥${parseFloat(existing.purchase_price_rmb || 0).toFixed(2)}</p>`;
    html += `<p><strong>销售价:</strong> ฿${parseFloat(existing.selling_price_thb || 0).toFixed(2)}</p>`;
    html += `<p><strong>店铺:</strong> ${existing.shop_code || '-'}</p>`;
    html += '</div></div></div>';

    // Excel 中要导入
    html += '<div class="comparison-section">';
    html += '<h4>Excel 中要导入：</h4>';
    html += '<div class="comparison-card importing">';
    html += '<div class="comparison-img-placeholder">无图片</div>';
    html += '<div class="comparison-details">';
    html += `<p><strong>SKU ID:</strong> ${importing.external_barcode}</p>`;
    html += `<p><strong>产品信息:</strong> ${importing.product_info || '-'}</p>`;
    html += `<p><strong>采购价:</strong> ¥${parseFloat(importing.purchase_price_rmb || 0).toFixed(2)}</p>`;
    html += `<p><strong>销售价:</strong> ฿${parseFloat(importing.selling_price_thb || 0).toFixed(2)}</p>`;
    html += `<p><strong>店铺:</strong> ${importing.shop_code || '-'}</p>`;
    html += '</div></div></div>';

    html += '</div>';

    document.getElementById('duplicate-comparison-content').innerHTML = html;
    window.openModal('duplicate-comparison-modal');
}

/**
 * 处理当前重复项并继续下一个
 */
window.handleCurrentDuplicate = function (action) {
    if (!duplicateComparisonData) return;

    const itemsToReview = duplicateComparisonData.filter(d => !d.isIdentical);
    if (duplicateComparisonIndex < itemsToReview.length) {
        itemsToReview[duplicateComparisonIndex].action = action;
        duplicateComparisonIndex++;

        if (duplicateComparisonIndex < itemsToReview.length) {
            showDuplicateComparison(itemsToReview);
        } else {
            window.closeModal('duplicate-comparison-modal');
            showSuccess('所有重复 SKU 已处理完成');
        }
    }
};

/**
 * 批量处理剩余重复项
 */
window.handleRemainingDuplicates = function (action) {
    if (!duplicateComparisonData) return;

    const itemsToReview = duplicateComparisonData.filter(d => !d.isIdentical);
    for (let i = duplicateComparisonIndex; i < itemsToReview.length; i++) {
        itemsToReview[i].action = action;
    }

    window.closeModal('duplicate-comparison-modal');
    showSuccess(`已设置剩余 ${itemsToReview.length - duplicateComparisonIndex} 个重复 SKU 为"${action === 'skip' ? '跳过' : '覆盖'}"`);
};

/**
 * 确认批量导入
 */
window.confirmBulkImport = async function () {
    if (!currentImportData || !currentValidationResult) {
        showError('没有可导入的数据');
        return;
    }

    // 检查是否有错误
    if (currentValidationResult.errors.length > 0) {
        showError('请先修复所有错误');
        return;
    }

    try {
        // 显示进度
        const confirmBtn = document.getElementById('confirm-bulk-import-btn');
        confirmBtn.disabled = true;
        confirmBtn.textContent = '导入中...';

        let successCount = 0;
        let skipCount = 0;
        let updateCount = 0;
        let failCount = 0;

        // 处理每条数据
        for (const row of currentImportData) {
            const sku = row.external_barcode;

            // 检查是否是重复项
            const duplicate = currentValidationResult.duplicates.find(d => d.sku === sku);

            if (duplicate) {
                if (duplicate.action === 'skip') {
                    skipCount++;
                    continue;
                } else if (duplicate.action === 'overwrite') {
                    // 更新现有 SKU
                    try {
                        const { error } = await supabase
                            .from('skus')
                            .update({
                                product_info: row.product_info,
                                purchase_price_rmb: parseFloat(row.purchase_price_rmb || 0),
                                selling_price_thb: parseFloat(row.selling_price_thb || 0),
                                shop_code: row.shop_code,
                                status_code: row.status_code || '上架'
                            })
                            .eq('id', duplicate.existing.id);

                        if (error) throw error;
                        updateCount++;
                    } catch (error) {
                        console.error('更新 SKU 失败:', sku, error);
                        failCount++;
                    }
                    continue;
                }
            }

            // 新增 SKU
            try {
                const { error } = await supabase
                    .from('skus')
                    .insert({
                        external_barcode: row.external_barcode,
                        product_info: row.product_info,
                        purchase_price_rmb: parseFloat(row.purchase_price_rmb || 0),
                        selling_price_thb: parseFloat(row.selling_price_thb || 0),
                        shop_code: row.shop_code,
                        status_code: row.status_code || '上架',
                        domestic_shipping: parseFloat(row.domestic_shipping || 0)
                    });

                if (error) throw error;
                successCount++;
            } catch (error) {
                console.error('创建 SKU 失败:', sku, error);
                failCount++;
            }
        }

        // 创建运费记录
        if (currentValidationResult.totalShipping > 0) {
            try {
                const { error } = await supabase
                    .from('expenses')
                    .insert({
                        expense_type_code: 'DOMESTIC_SHIPPING',
                        amount: currentValidationResult.totalShipping,
                        currency: 'CNY',
                        timestamp: new Date().toISOString(),
                        description: `批量导入 SKU - 国内运费汇总 (共 ${currentImportData.length} 条)`
                    });

                if (error) throw error;
            } catch (error) {
                console.error('创建运费记录失败:', error);
            }
        }

        // 显示结果
        let message = `导入完成！\n新增: ${successCount} 条\n更新: ${updateCount} 条\n跳过: ${skipCount} 条`;
        if (failCount > 0) {
            message += `\n失败: ${failCount} 条`;
        }
        if (currentValidationResult.totalShipping > 0) {
            message += `\n运费记录已创建: ¥${currentValidationResult.totalShipping.toFixed(2)}`;
        }

        showSuccess(message);

        // 关闭模态框
        window.closeModal('bulk-import-modal');

        // 刷新 SKU 列表
        if (typeof loadSKUs === 'function') {
            loadSKUs();
        }

    } catch (error) {
        console.error('批量导入失败:', error);
        showError('批量导入失败: ' + error.message);
    } finally {
        const confirmBtn = document.getElementById('confirm-bulk-import-btn');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认导入';
    }
};
