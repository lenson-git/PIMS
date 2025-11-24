/* global XLSX, supabase, showSuccess, showError, openModal, closeModal */
/**
 * 入库批量导入模块
 * Version: 20251124-2225-fix-syntax
 * 直接选择文件后验证并显示在待入库清单中
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

// 全局状态：待入库商品列表
let pendingInboundList = [];

console.log('Inbound Bulk Import Script Loaded');

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

        // 验证 SKU
        console.log('[DEBUG] 开始验证 SKU...');
        const validation = await validateInboundSKUs(data);
        console.log('[DEBUG] 验证完成');

        if (validation.missingSkus.length > 0) {
            // 显示错误提示
            showMissingSKUsError(validation.missingSkus);
        } else {
            // 添加到待入库清单
            addToPendingInbound(data, validation.skuDetails);
            // 移除成功提示
        }

    } catch (error) {
        console.error('文件处理失败:', error);
        showError('文件处理失败: ' + error.message);
    }

    // 清空文件输入
    event.target.value = '';
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
 * 验证 SKU 是否存在
 */
async function validateInboundSKUs(data) {
    const skuIds = data.map(row => row.sku_id).filter(Boolean);
    console.log('[DEBUG] 查询 SKU:', skuIds);

    const { data: existingSKUs, error } = await supabase
        .from('v_skus')
        .select('id, external_barcode, product_info, pic, purchase_price_rmb')
        .in('external_barcode', skuIds);

    if (error) throw error;

    console.log('[DEBUG] 查询到', existingSKUs.length, '个 SKU');

    const existingIds = new Set(existingSKUs.map(s => s.external_barcode));
    const missingSkus = skuIds.filter(id => !existingIds.has(id));

    return {
        skuDetails: existingSKUs,
        missingSkus: missingSkus
    };
}

/**
 * 显示缺失 SKU 错误
 */
function showMissingSKUsError(missingSkus) {
    const message = `以下 SKU 不存在，请先在 SKU 管理中添加:\n\n${missingSkus.join('\n')}`;
    showError(message);
}

/**
 * 添加到待入库清单
 */
function addToPendingInbound(data, skuDetails) {
    const skuMap = new Map(skuDetails.map(s => [s.external_barcode, s]));

    // 合并到现有清单
    data.forEach(row => {
        const sku = skuMap.get(row.sku_id);
        if (sku) {
            // 检查是否已存在
            const existingIndex = pendingInboundList.findIndex(item => item.sku_id === sku.id);
            if (existingIndex >= 0) {
                // 累加数量
                pendingInboundList[existingIndex].quantity += row.quantity;
            } else {
                // 添加新商品
                pendingInboundList.push({
                    sku_id: sku.id,
                    external_barcode: row.sku_id,
                    product_info: sku.product_info,
                    pic: sku.pic,
                    purchase_price_rmb: sku.purchase_price_rmb,
                    quantity: row.quantity
                });
            }
        }
    });

    // 渲染清单
    renderPendingInboundList();
}

// 盒子图标 SVG 常量
const BOX_ICON_SVG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"%3E%3Crect width="80" height="80" fill="%23f3f4f6"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="40"%3E📦%3C/text%3E%3C/svg%3E';

// 初始化默认值 - 使用轮询确保在选项加载后设置
document.addEventListener('DOMContentLoaded', function () {
    const maxAttempts = 20; // 最多尝试20次 (20 * 500ms = 10秒)
    let attempts = 0;

    const intervalId = setInterval(() => {
        attempts++;
        const warehouseSelect = document.getElementById('inbound-warehouse');
        const typeSelect = document.getElementById('inbound-type');
        let warehouseSet = false;
        let typeSet = false;

        // 尝试设置仓库
        if (warehouseSelect && warehouseSelect.options.length > 1) { // >1 意味着除了空选项还有其他选项
            const options = Array.from(warehouseSelect.options);
            // 查找包含"主"字的仓库，或者 value 为 "主仓库"
            const mainWarehouse = options.find(opt => opt.text.includes('主') || opt.value === '主仓库' || opt.value === 'MAIN');

            if (mainWarehouse) {
                warehouseSelect.value = mainWarehouse.value;
                // 触发 change 事件以更新 UI (浮动标签)
                warehouseSelect.dispatchEvent(new Event('change'));
                warehouseSet = true;
            }
        }

        // 尝试设置入库类型
        if (typeSelect && typeSelect.options.length > 1) {
            const options = Array.from(typeSelect.options);
            const purchaseType = options.find(opt => opt.text.includes('采购') || opt.value === '采购入库');

            if (purchaseType) {
                typeSelect.value = purchaseType.value;
                typeSelect.dispatchEvent(new Event('change'));
                typeSet = true;
            }
        }

        // 如果都设置成功，或者超时，清除定时器
        // 注意：只要找到一个就可以停止尝试那个，但为了简单，我们等待两个都找到或超时
        // 实际上，只要尝试次数够多，最终会停止。为了避免一直重置用户的选择，一旦设置成功就不再设置
        if ((warehouseSet && typeSet) || attempts >= maxAttempts) {
            clearInterval(intervalId);
            if (attempts >= maxAttempts) {
                console.log('[DEBUG] 设置默认值超时或部分未找到');
            } else {
                console.log('[DEBUG] 默认值设置成功');
            }
        }
    }, 500);
});

/**
 * 渲染待入库清单
 */
function renderPendingInboundList() {
    const tbody = document.getElementById('inbound-list-body');
    const emptyState = document.getElementById('inbound-empty-state');

    if (!tbody || !emptyState) {
        console.error('找不到待入库清单元素');
        return;
    }

    if (pendingInboundList.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'flex';
        return;
    }

    emptyState.style.display = 'none';

    let html = '';
    pendingInboundList.forEach((item, index) => {
        // 检查图片 URL 是否有效
        let imgSrc = BOX_ICON_SVG;
        // 严格检查: 必须是字符串, 非空, 非 'null', 非 'undefined'
        if (item.pic && typeof item.pic === 'string') {
            const cleanPic = item.pic.trim().toLowerCase();
            if (cleanPic !== '' && cleanPic !== 'null' && cleanPic !== 'undefined') {
                imgSrc = item.pic;
            }
        }

        html += `
            <tr>
                <td>${index + 1}</td>
                <td><img src="${imgSrc}" alt="产品图片" onerror="this.onerror=null;this.src='${BOX_ICON_SVG}'" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;"></td>
                <td>
                    <div style="font-weight: 500;">${item.external_barcode}</div>
                    <div style="color: #6b7280; font-size: 14px; margin-top: 4px;">${item.product_info || '-'}</div>
                </td>
                <td>${item.quantity}</td>
                <td>
                    <input type="number" class="quantity-input" 
                           value="0" min="0" 
                           onchange="updatePendingQuantity(${index}, this.value)"
                           style="width: 80px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px;">
                </td>
                <td class="text-center">
                    <button class="btn-icon-only" onclick="removePendingInboundItem(${index})" title="删除">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

/**
 * 更新待入库数量
 */
window.updatePendingQuantity = function (index, value) {
    const quantity = parseInt(value);
    if (quantity > 0 && pendingInboundList[index]) {
        pendingInboundList[index].quantity = quantity;
    }
};

/**
 * 删除待入库商品
 */
window.removePendingInboundItem = function (index) {
    pendingInboundList.splice(index, 1);
    renderPendingInboundList();
    showSuccess('已删除商品');
};

/**
 * 清空待入库清单
 */
window.clearPendingInbound = function () {
    if (pendingInboundList.length === 0) {
        return;
    }

    // 直接清空，不弹出确认框
    pendingInboundList = [];
    renderPendingInboundList();
};

/**
 * 确认入库（统一入库）
 */
window.submitInbound = async function () {
    if (pendingInboundList.length === 0) {
        showError('待入库清单为空');
        return;
    }

    // 获取仓库和入库类型
    const warehouseSelect = document.getElementById('inbound-warehouse');
    const typeSelect = document.getElementById('inbound-type');

    const warehouseCode = warehouseSelect ? warehouseSelect.value : '';
    const typeCode = typeSelect ? typeSelect.value : '';

    if (!warehouseCode) {
        showError('请选择入库仓库');
        return;
    }

    if (!typeCode) {
        showError('请选择入库类型');
        return;
    }

    try {
        console.log('[DEBUG] 开始批量入库...');

        // 从输入框读取实际入库数量
        const inputs = document.querySelectorAll('.quantity-input');
        const records = [];

        pendingInboundList.forEach((item, index) => {
            const quantity = parseInt(inputs[index]?.value || 0);
            if (quantity > 0) {
                records.push({
                    sku_id: item.sku_id,
                    warehouse_code: warehouseCode, // 使用选择的仓库
                    movement_type_code: typeCode,  // 使用选择的类型
                    quantity: quantity,
                    movement_date: new Date().toISOString().split('T')[0]
                });
            }
        });

        if (records.length === 0) {
            showError('请至少输入一个商品的入库数量');
            return;
        }

        console.log('[DEBUG] 准备入库', records.length, '条记录');

        // 批量插入
        const { error } = await supabase
            .from('stock_movements')
            .insert(records);

        if (error) throw error;

        showSuccess(`成功入库 ${records.length} 条记录`);

        // 清空清单
        pendingInboundList = [];
        renderPendingInboundList();

        // 刷新库存列表（如果在库存页面）
        if (typeof window.loadStockList === 'function') {
            window.loadStockList();
        }

    } catch (error) {
        console.error('入库失败:', error);
        showError('入库失败: ' + error.message);
    }
};
