// ==========================================
// 条码扫描器功能
// ==========================================

let currentScannerTarget = null;
let isScanning = false;

// 打开条码扫描器
window.openBarcodeScanner = function (inputId) {
    currentScannerTarget = inputId;
    const modal = document.getElementById('barcode-scanner-modal');
    const container = document.getElementById('scanner-container');
    const errorDiv = document.getElementById('scanner-error');

    if (!modal || !container) return;

    // 显示模态框
    modal.style.display = 'flex';
    container.style.display = 'block';
    errorDiv.style.display = 'none';

    // 初始化 QuaggaJS
    initQuagga();
};

// 关闭条码扫描器
window.closeBarcodeScanner = function () {
    const modal = document.getElementById('barcode-scanner-modal');
    if (modal) modal.style.display = 'none';

    // 停止 QuaggaJS
    if (isScanning && typeof Quagga !== 'undefined') {
        Quagga.stop();
        isScanning = false;
    }

    currentScannerTarget = null;
};

// 初始化 QuaggaJS 扫描器
function initQuagga() {
    if (typeof Quagga === 'undefined') {
        console.error('QuaggaJS not loaded');
        showScannerError();
        return;
    }

    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: document.querySelector('#scanner-viewport'),
            constraints: {
                width: 640,
                height: 480,
                facingMode: "environment" // 使用后置摄像头
            }
        },
        decoder: {
            readers: [
                "code_128_reader",
                "ean_reader",
                "ean_8_reader",
                "code_39_reader",
                "code_39_vin_reader",
                "codabar_reader",
                "upc_reader",
                "upc_e_reader"
            ]
        },
        locate: true,
        locator: {
            patchSize: "medium",
            halfSample: true
        }
    }, function (err) {
        if (err) {
            console.error('QuaggaJS init error:', err);
            showScannerError();
            return;
        }

        console.log("QuaggaJS initialized");
        Quagga.start();
        isScanning = true;
    });

    // 监听条码检测事件
    Quagga.onDetected(onBarcodeDetected);
}

// 处理条码检测结果
function onBarcodeDetected(result) {
    if (!result || !result.codeResult) return;

    const code = result.codeResult.code;
    console.log('Barcode detected:', code);

    // 填充到目标输入框
    if (currentScannerTarget) {
        const input = document.getElementById(currentScannerTarget);
        if (input) {
            input.value = code;
            // 触发 input 事件以便其他逻辑响应
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // 关闭扫描器
    closeBarcodeScanner();
}

// 显示扫描器错误
function showScannerError() {
    const container = document.getElementById('scanner-container');
    const errorDiv = document.getElementById('scanner-error');

    if (container) container.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'block';
}

// 绑定所有扫描按钮
window.bindScanButtons = function () {
    const scanButtons = document.querySelectorAll('.scan-btn');
    console.log('Binding scan buttons, found:', scanButtons.length);
    scanButtons.forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // 查找最近的输入框
            const inputGroup = this.closest('.input-group, .floating-label-group');
            if (inputGroup) {
                const input = inputGroup.querySelector('input[type="text"]');
                if (input && input.id) {
                    console.log('Opening scanner for input:', input.id);
                    openBarcodeScanner(input.id);
                }
            }
        });
    });
};
