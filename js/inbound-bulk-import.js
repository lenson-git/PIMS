/* global XLSX, supabase, showSuccess, showError, openModal, closeModal, logger */
/**
 * 入库批量导入模块
 * Version: 20251208-002-optimize-scan
 * 直接选择文件后验证并显示在待入库清单中
 * 新增: 批量导入统计、扫描置顶、确认弹窗
 * 修复: 手动扫描时置顶和数量更新
 * 优化: 手动扫描时只更新数量不重新渲染图片
 */

// 备用函数：如果全局没有定义，则使用本地实现
// 注意：animations.js 会覆盖这些定义，这里仅作为最后的防线
if (typeof window.openModal === 'undefined') {
    window.openModal = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    };
}
if (typeof window.closeModal === 'undefined') {
    window.closeModal = (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    };
}

// 全局状态：待入库商品列表
let pendingInboundList = [];

// 批量导入模式标识和统计
let isBulkImportMode = false;
let bulkImportStats = {
    skuCount: 0,        // SKU数量
    purchaseQty: 0,     // 采购数量
    scannedQty: 0       // 已扫描数量
};

if (window.logger) window.logger.info('Inbound Bulk Import Script Loaded');

/**
 * 处理文件选择
 */
window.handleInboundImportFile = async function (event) {
    logger.debug('handleInboundImportFile 开始');

    const file = event.target.files[0];
    if (!file) return;

    logger.debug('文件名:', file.name);

    // 找到触发按钮并显示处理状态
    const importBtn = document.querySelector('button[onclick*="inbound-import-file"]');
    const originalBtnText = importBtn ? importBtn.innerHTML : '';
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
                <path d="M12 2 A10 10 0 0 1 22 12" stroke-dasharray="31.4" stroke-dashoffset="0">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                </path>
            </svg>
            处理中...
        `;
    }

    try {
        // 解析 Excel
        logger.debug('开始解析 Excel...');
        const data = await parseInboundExcel(file);
        logger.debug('Excel 解析完成，数据行数:', data.length);

        // 验证 SKU
        logger.debug('开始验证 SKU...');
        const validation = await validateInboundSKUs(data);
        logger.debug('验证完成');

        if (validation.missingSkus.length > 0) {
            // 显示错误提示
            showMissingSKUsError(validation.missingSkus);
        } else {
            // 添加到待入库清单
            addToPendingInbound(data, validation.skuDetails);
            showSuccess(`成功导入 ${data.length} 个商品`);
        }

    } catch (error) {
        logger.error('文件处理失败:', error);
        showError('文件处理失败: ' + error.message);
    } finally {
        // 恢复按钮状态
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.innerHTML = originalBtnText;
        }
        // 清空文件输入
        event.target.value = '';
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

                if (window.logger) window.logger.debug('工作表列表:', workbook.SheetNames);

                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);

                if (window.logger) window.logger.debug('使用工作表 "' + workbook.SheetNames[0] + '" 的列名:', Object.keys(jsonData[0] || {}));

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
    if (window.logger) window.logger.debug('查询 SKU:', skuIds);

    const { data: existingSKUs, error } = await supabase
        .from('v_skus')
        .select('id, external_barcode, product_info, pic, purchase_price_rmb')
        .in('external_barcode', skuIds);

    if (error) throw error;

    if (window.logger) window.logger.debug('查询到', existingSKUs.length, '个 SKU');

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

    // 启用批量导入模式
    isBulkImportMode = true;

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
                    quantity: row.quantity,
                    scannedQty: 0  // 初始化已扫描数量
                });
            }
        }
    });

    // 计算统计信息
    updateBulkImportStats();

    // 渲染清单
    renderPendingInboundList();
}

/**
 * 更新批量导入统计信息
 */
function updateBulkImportStats() {
    if (!isBulkImportMode) return;

    bulkImportStats.skuCount = pendingInboundList.length;
    bulkImportStats.purchaseQty = pendingInboundList.reduce((sum, item) => sum + item.quantity, 0);
    bulkImportStats.scannedQty = pendingInboundList.reduce((sum, item) => sum + (item.scannedQty || 0), 0);

    // 更新UI显示
    renderBulkImportStats();
}

/**
 * 渲染批量导入统计信息
 */
function renderBulkImportStats() {
    const panelTitle = document.querySelector('#inbound-view .inbound-list-panel .panel-title');
    if (!panelTitle) return;

    // 移除旧的统计信息
    const oldStats = panelTitle.querySelector('.bulk-stats');
    if (oldStats) oldStats.remove();

    // 如果是批量导入模式,添加统计信息
    if (isBulkImportMode && pendingInboundList.length > 0) {
        const statsSpan = document.createElement('span');
        statsSpan.className = 'bulk-stats';
        statsSpan.style.cssText = 'color: #6b7280; font-size: 14px; font-weight: normal; margin-left: 12px;';
        statsSpan.textContent = `(SKU:${bulkImportStats.skuCount}个 / 采购数量:${bulkImportStats.purchaseQty}个 / 已扫描:${bulkImportStats.scannedQty}个)`;
        panelTitle.appendChild(statsSpan);
    }
}

// 盒子图标 SVG 常量
const BOX_ICON_SVG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"%3E%3Crect width="80" height="80" fill="%23f3f4f6"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="40"%3E📦%3C/text%3E%3C/svg%3E';

/**
 * 设置入库页面的默认值
 * 在 preloadInbound() 完成后调用
 */
window.setInboundDefaults = function () {
    const warehouseSelect = document.getElementById('inbound-warehouse');
    const typeSelect = document.getElementById('inbound-type');

    // 设置默认仓库
    if (warehouseSelect && warehouseSelect.options.length > 1) {
        const options = Array.from(warehouseSelect.options);
        // 查找包含"主"字的仓库,或者 value/text 包含 "main"(不区分大小写)
        const mainWarehouse = options.find(opt => {
            const text = (opt.text || '').toLowerCase();
            const value = (opt.value || '').toLowerCase();
            return text.includes('主') ||
                value.includes('主') ||
                text.includes('main') ||
                value.includes('main');
        });

        if (mainWarehouse) {
            warehouseSelect.value = mainWarehouse.value;
            // 触发 change 事件以更新 UI (浮动标签)
            warehouseSelect.dispatchEvent(new Event('change'));
            if (window.logger) window.logger.info('[批量入库] 默认仓库已设置:', mainWarehouse.text);
        } else {
            console.warn('[批量入库] 未找到"主仓"');
        }
    }

    // 设置默认入库类型
    if (typeSelect && typeSelect.options.length > 1) {
        const options = Array.from(typeSelect.options);
        // 查找包含"采购"字的类型,或者 value/text 包含 "purchase"(不区分大小写)
        const purchaseType = options.find(opt => {
            const text = (opt.text || '').toLowerCase();
            const value = (opt.value || '').toLowerCase();
            return text.includes('采购') ||
                value.includes('采购') ||
                text.includes('purchase') ||
                value.includes('purchase');
        });

        if (purchaseType) {
            typeSelect.value = purchaseType.value;
            typeSelect.dispatchEvent(new Event('change'));
            if (window.logger) window.logger.info('[批量入库] 默认入库类型已设置:', purchaseType.text);
        } else {
            console.warn('[批量入库] 未找到"采购入库"类型');
        }
    }
};

/**
 * 渲染待入库清单
 */
async function renderPendingInboundList() {
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

    // 并行处理所有图片 URL
    const rows = await Promise.all(pendingInboundList.map(async (item, index) => {
        let imgHtml = '';

        try {
            if (item.pic && typeof item.pic === 'string') {
                const cleanPic = item.pic.trim();
                if (window.logger) window.logger.info(`【批量入库】处理图片 ${index + 1}:`, cleanPic);

                if (cleanPic !== '' && cleanPic.toLowerCase() !== 'null' && cleanPic.toLowerCase() !== 'undefined') {
                    // 尝试转换为缩略图（无超时限制）
                    let thumb = null;

                    if (typeof window.createTransformedUrlFromPublicUrl === 'function') {
                        try {
                            thumb = await window.createTransformedUrlFromPublicUrl(cleanPic, 100, 100);
                            if (window.logger) window.logger.info(`【批量入库】缩略图转换结果 ${index + 1}:`, thumb ? '成功' : '失败');

                            // 如果缩略图失败，尝试签名 URL
                            if (!thumb && typeof window.createSignedUrlFromPublicUrl === 'function') {
                                thumb = await window.createSignedUrlFromPublicUrl(cleanPic);
                                if (window.logger) window.logger.info(`【批量入库】签名 URL 结果 ${index + 1}:`, thumb ? '成功' : '失败');
                            }
                        } catch (e) {
                            console.error(`[批量入库] 图片转换失败 ${index + 1}: `, cleanPic, e);
                        }
                    }

                    if (thumb) {
                        // 转换成功:显示骨架屏 + 缩略图
                        imgHtml = `
                            <div class="skeleton-image"></div>
                            <img src="${thumb}" alt="产品图片" loading="lazy"
                                onerror="this.parentElement.innerHTML='<div class=\\'image-placeholder\\'>📦</div>'"
                                style="width: 100%; height: 100%; object-fit: cover;">
                        `;
                    } else {
                        // 转换失败：显示盒子
                        console.warn(`[批量入库] 显示盒子图标 ${index + 1}`);
                        imgHtml = '<div class="image-placeholder">📦</div>';
                    }
                } else {
                    // 无效图片：显示盒子
                    console.warn(`[批量入库] 无效图片 URL ${index + 1}:`, item.pic);
                    imgHtml = '<div class="image-placeholder">📦</div>';
                }
            } else {
                // 没有图片：显示盒子
                console.warn(`[批量入库] 没有图片 ${index + 1}`);
                imgHtml = '<div class="image-placeholder">📦</div>';
            }
        } catch (err) {
            console.error(`[批量入库] 处理图片异常 ${index + 1}:`, err);
            imgHtml = '<div class="image-placeholder">📦</div>';
        }

        return `
                    <tr data-index="${index}">
                        <td>${index + 1}</td>
                        <td>
                            <div class="img-thumbnail-small" onclick="event.stopPropagation(); ${item.pic ? `showLightbox('${item.pic.trim()}')` : ''}" style="cursor: ${item.pic ? 'zoom-in' : 'default'}">
                                <div class="image-container" data-img-id="bulk-${index}">
                                    ${imgHtml}
                                </div>
                            </div>
                        </td>
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
                            <button class="btn-icon-action text-error" onclick="removePendingInboundItem(${index})" title="删除">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </td>
                    </tr>
                    `;
    }));

    tbody.innerHTML = rows.join('');

    // 激活图片渐变加载效果
    // 使用 requestAnimationFrame 确保 DOM 已渲染
    requestAnimationFrame(() => {
        if (typeof window.setupImageLoading === 'function') {
            if (window.logger) window.logger.info('[批量入库] 调用 setupImageLoading');
            window.setupImageLoading();
        } else {
            console.warn('[批量入库] setupImageLoading 函数未找到');
        }
    });

    // 渲染统计信息
    renderBulkImportStats();
}

/**
 * 更新待入库数量
 */
window.updatePendingQuantity = function (index, value) {
    const quantity = parseInt(value);
    if (quantity > 0 && pendingInboundList[index]) {
        const item = pendingInboundList[index];
        const oldScannedQty = item.scannedQty || 0;

        // 更新已扫描数量
        item.scannedQty = quantity;

        // 如果是批量导入模式且数量发生变化,将该SKU移到顶部
        if (isBulkImportMode && quantity !== oldScannedQty && index !== 0) {
            // 从当前位置移除
            const [movedItem] = pendingInboundList.splice(index, 1);
            // 插入到顶部
            pendingInboundList.unshift(movedItem);

            // 重新渲染列表
            renderPendingInboundList();
        } else {
            // 只更新统计信息
            updateBulkImportStats();
        }
    }
};

/**
 * 删除待入库商品
 */
window.removePendingInboundItem = function (index) {
    // 找到对应的行
    const tbody = document.getElementById('inbound-list-body');
    if (!tbody) {
        // 如果找不到表格,使用原有逻辑
        pendingInboundList.splice(index, 1);
        renderPendingInboundList();
        showSuccess('已删除商品');
        return;
    }

    const row = tbody.querySelector(`tr[data-index="${index}"]`);
    if (!row) {
        // 如果找不到行,使用原有逻辑
        pendingInboundList.splice(index, 1);
        renderPendingInboundList();
        showSuccess('已删除商品');
        return;
    }

    // 使用删除动画
    if (typeof window.removeRow === 'function') {
        window.removeRow(row, () => {
            // 动画完成后，先从 DOM 中移除元素
            row.remove();

            // 从数据中删除
            pendingInboundList.splice(index, 1);

            // 更新剩余行的序号和 data-index
            const rows = tbody.querySelectorAll('tr');
            rows.forEach((r, i) => {
                const seqCell = r.querySelector('td:first-child');
                if (seqCell) seqCell.textContent = i + 1;
                r.setAttribute('data-index', i);

                // 更新删除按钮的 onclick
                const deleteBtn = r.querySelector('button[onclick*="removePendingInboundItem"]');
                if (deleteBtn) {
                    deleteBtn.setAttribute('onclick', `removePendingInboundItem(${i})`);
                }

                // 更新数量输入框的 onchange
                const qtyInput = r.querySelector('input.quantity-input');
                if (qtyInput) {
                    qtyInput.setAttribute('onchange', `updatePendingQuantity(${i}, this.value)`);
                }
            });

            showSuccess('已删除商品');
        });
    } else {
        // 如果动画函数不存在,使用原有逻辑
        pendingInboundList.splice(index, 1);
        renderPendingInboundList();
        showSuccess('已删除商品');
    }
};

/**
 * 清空待入库清单
 */
window.clearPendingInbound = function () {
    if (pendingInboundList.length === 0) {
        return;
    }

    // 直接清空,不弹出确认框
    pendingInboundList = [];

    // 重置批量导入模式和统计
    isBulkImportMode = false;
    bulkImportStats = {
        skuCount: 0,
        purchaseQty: 0,
        scannedQty: 0
    };

    renderPendingInboundList();
};

/**
 * 确认入库(统一入库)
 */
window.submitInbound = async function () {
    if (pendingInboundList.length === 0) {
        showError('待入库清单为空');
        return;
    }

    // 如果是批量导入模式,先显示确认弹窗
    if (isBulkImportMode) {
        showInboundConfirmModal();
        return;
    }

    // 非批量导入模式,直接执行入库
    await executeInbound();
};

/**
 * 显示入库确认弹窗
 */
function showInboundConfirmModal() {
    // 计算差异
    const differences = [];
    pendingInboundList.forEach(item => {
        const scannedQty = item.scannedQty || 0;
        const diff = scannedQty - item.quantity;
        if (diff !== 0) {
            differences.push({
                barcode: item.external_barcode,
                productInfo: item.product_info,
                purchaseQty: item.quantity,
                scannedQty: scannedQty,
                diff: diff
            });
        }
    });

    const totalDiff = Math.abs(bulkImportStats.scannedQty - bulkImportStats.purchaseQty);
    const hasDifference = differences.length > 0;

    // 构建弹窗内容
    let modalContent = `
        <div style="padding: 20px;">
            <h3 style="margin: 0 0 16px 0; font-size: 18px;">入库确认</h3>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div style="font-size: 14px; line-height: 1.8;">
                    <div><strong>本次入库SKU:</strong> ${bulkImportStats.skuCount}个</div>
                    <div><strong>采购数量:</strong> ${bulkImportStats.purchaseQty}个</div>
                    <div><strong>已扫描:</strong> ${bulkImportStats.scannedQty}个</div>
                    <div style="color: ${hasDifference ? '#ef4444' : '#10b981'};"><strong>差异:</strong> ${totalDiff}个</div>
                </div>
            </div>
    `;

    if (hasDifference) {
        modalContent += `
            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 12px 0; font-size: 16px; color: #ef4444;">差异明细</h4>
                <div style="max-height: 300px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                                <th style="padding: 8px; text-align: left;">SKU(条码)</th>
                                <th style="padding: 8px; text-align: center;">采购数量</th>
                                <th style="padding: 8px; text-align: center;">入库数量</th>
                                <th style="padding: 8px; text-align: center;">差异</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        differences.forEach(item => {
            const diffColor = item.diff > 0 ? '#10b981' : '#ef4444';
            const diffText = item.diff > 0 ? `+${item.diff}` : item.diff;
            modalContent += `
                <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 8px;">
                        <div style="font-weight: 500;">${item.barcode}</div>
                        <div style="color: #6b7280; font-size: 12px;">${item.productInfo || '-'}</div>
                    </td>
                    <td style="padding: 8px; text-align: center;">${item.purchaseQty}</td>
                    <td style="padding: 8px; text-align: center;">${item.scannedQty}</td>
                    <td style="padding: 8px; text-align: center; color: ${diffColor}; font-weight: 500;">${diffText}</td>
                </tr>
            `;
        });

        modalContent += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    modalContent += `
            <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px;">
                <button class="btn btn-outline" onclick="closeInboundConfirmModal()">取消</button>
                <button class="btn btn-black" onclick="confirmAndExecuteInbound()">确认入库</button>
            </div>
        </div>
    `;

    // 创建或更新模态框
    let modal = document.getElementById('inbound-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'inbound-confirm-modal';
        modal.className = 'modal-overlay';
        modal.style.display = 'none';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="modal" style="max-width: 700px;">${modalContent}</div>`;
    modal.style.display = 'flex';
}

/**
 * 关闭入库确认弹窗
 */
window.closeInboundConfirmModal = function () {
    const modal = document.getElementById('inbound-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
};

/**
 * 确认并执行入库
 */
window.confirmAndExecuteInbound = async function () {
    closeInboundConfirmModal();
    await executeInbound();
};

/**
 * 执行入库操作
 */
async function executeInbound() {
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
        // 找到提交按钮并显示处理状态
        const submitBtn = document.querySelector('#inbound-view .panel-header .btn');
        const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '提交中...';
        }

        logger.debug('开始批量入库...');

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
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
            return;
        }

        logger.debug('准备入库', records.length, '条记录');

        // 批量插入
        const { error } = await supabase
            .from('stock_movements')
            .insert(records);

        if (error) throw error;

        showSuccess(`成功入库 ${records.length} 条记录`);

        // 清空清单
        pendingInboundList = [];

        // 重置批量导入模式和统计
        isBulkImportMode = false;
        bulkImportStats = {
            skuCount: 0,
            purchaseQty: 0,
            scannedQty: 0
        };

        renderPendingInboundList();

        // 刷新库存列表(如果在库存页面)
        if (typeof window.loadStockList === 'function') {
            window.loadStockList();
        }

        // 恢复按钮状态
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }

    } catch (error) {
        logger.error('入库失败:', error);
        showError('入库失败: ' + error.message);

        // 恢复按钮状态
        const submitBtn = document.querySelector('#inbound-view .panel-header .btn');
        const originalBtnText = submitBtn ? submitBtn.getAttribute('data-original-text') : '确认入库';
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText || '确认入库';
        }
    }
};

/**
 * 手动扫描时添加SKU到入库列表
 * @param {Object} sku - SKU对象
 * @param {number} quantity - 数量(默认为1)
 */
window.addSKUToInboundList = async function (sku, quantity = 1) {
    if (!sku || !sku.id) {
        showError('无效的SKU数据');
        return;
    }

    try {
        // 查找是否已存在
        const existingIndex = pendingInboundList.findIndex(item => item.sku_id === sku.id);

        if (existingIndex >= 0) {
            // 已存在,增加数量
            const item = pendingInboundList[existingIndex];
            item.scannedQty = (item.scannedQty || 0) + quantity;

            // 如果不是批量导入模式,也需要增加采购数量(因为手动扫描时两者相等)
            if (!isBulkImportMode) {
                item.quantity = (item.quantity || 0) + quantity;
            }

            // 移至顶部(无论是否批量导入模式)
            if (existingIndex !== 0) {
                const [movedItem] = pendingInboundList.splice(existingIndex, 1);
                pendingInboundList.unshift(movedItem);

                // 只重新渲染列表(移动行位置)
                await renderPendingInboundList();
            } else {
                // 已经在顶部,只更新数量显示
                const tbody = document.getElementById('inbound-list-body');
                if (tbody) {
                    const row = tbody.querySelector('tr[data-index="0"]');
                    if (row) {
                        // 更新采购数量显示
                        const purchaseQtyCell = row.cells[3];
                        if (purchaseQtyCell) {
                            purchaseQtyCell.textContent = item.quantity;
                        }

                        // 更新入库数量输入框
                        const qtyInput = row.querySelector('.quantity-input');
                        if (qtyInput) {
                            qtyInput.value = item.scannedQty || 0;
                        }
                    }
                }

                // 更新统计信息
                if (isBulkImportMode) {
                    updateBulkImportStats();
                }
            }
        } else {
            // 不存在,添加新商品到顶部
            const newItem = {
                sku_id: sku.id,
                external_barcode: sku.external_barcode,
                product_info: sku.product_info,
                pic: sku.pic,
                purchase_price_rmb: sku.purchase_price_rmb,
                quantity: quantity,  // 采购数量(手动扫描时等于扫描数量)
                scannedQty: quantity // 已扫描数量
            };

            // 添加到顶部
            pendingInboundList.unshift(newItem);

            // 重新渲染列表(因为是新商品,需要渲染)
            await renderPendingInboundList();
        }

        // 更新统计信息
        if (isBulkImportMode) {
            updateBulkImportStats();
        }

        return true;
    } catch (error) {
        logger.error('添加SKU到入库列表失败:', error);
        showError('添加失败: ' + error.message);
        return false;
    }
};
