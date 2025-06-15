const ui = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    presetSelect: document.getElementById('preset-select'),
    flipCheckbox: document.getElementById('flip-vertical-checkbox'),
    themeColorPicker: document.getElementById('theme-color-picker'),
    themeSwitcher: document.querySelector('.theme-switcher'),
    themeButtons: document.querySelectorAll('.theme-btn'),
    spinner: document.getElementById('spinner'),
    progressText: document.getElementById('progress-text'),
    resultsArea: document.getElementById('results-area'),
    summaryText: document.getElementById('summary-text'),
    statsArea: document.getElementById('stats-area'),
    errorLogArea: document.getElementById('error-log-area'),
    errorLog: document.getElementById('error-log'),
    downloadButton: document.getElementById('download-button'),
    previewArea: document.getElementById('preview-area'),
    previewGrid: document.getElementById('preview-grid'),
    previewHeader: document.querySelector('[data-i18n="results_previews"]'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalContent: document.getElementById('modal-content'),
    modalCanvas: document.getElementById('modal-canvas'),
    modalFilename: document.getElementById('modal-filename'),
    modalCloseButton: document.getElementById('modal-close-button'),
    modalDownloadButton: document.getElementById('modal-download-button'),
    modalCopyButton: document.getElementById('modal-copy-button'),
    modalPrevButton: document.getElementById('modal-prev'),
    modalNextButton: document.getElementById('modal-next')
};

const numWorkers = navigator.hardwareConcurrency || 4;
const SETTINGS_KEY = 'tgaConverterSettings_v3';
let workerPool = [], isPoolReady = false, startTime, currentLang;
let currentSuccesses = [], currentModalIndex = -1;

const locales = {
    ja: {
        appTitle: "PNG to TGA 変換ツール",
        header_selectFiles: "1. ファイルを選択",
        dropZone_text: "ここに複数のPNGファイルをドラッグ＆ドロップ<br>またはクリックしてファイルを選択",
        header_options: "2. 変換オプション",
        options_preset: "プリセット:",
        options_details: "詳細設定",
        options_flip: "画像を上下反転 (左下原点):",
        options_appearance: "外観モード:",
        options_theme: "テーマカラー:",
        header_results: "3. 実行と結果",
        results_previews: "プレビュー (クリックで拡大/名称変更)",
        results_errorLog: "エラーログ:",
        results_downloadBtn: "ZIPファイルをダウンロード",
        modal_downloadBtn: "この画像をダウンロード",
        modal_copyBtn: "コピー",
        status_copied: "コピーしました！",
        status_initializing: `Workerを初期化中... ({count}/${numWorkers})`,
        status_ready: `準備完了 (${numWorkers}コア利用可能)。ファイルを選択してください。`,
        status_starting: "処理を開始しています...",
        status_processing: "変換中: {current} / {total}",
        status_zipping: "ZIPファイルを生成中...",
        status_downloadReady: "ダウンロードが開始されました。",
        summary_complete: "完了: {success}個成功, {error}個失敗",
        stats_totalTime: "総処理時間",
        stats_workers: "使用Worker数",
        stats_throughput: "スループット",
        stats_avgTime: "平均処理時間",
        alert_noPng: "変換可能なPNGファイルがありません。",
        alert_workerNotReady: "Workerが準備中です。",
        dropZone_aria: "変換するファイルを選択"
    },
    en: {
        appTitle: "PNG to TGA Converter",
        header_selectFiles: "1. Select Files",
        dropZone_text: "Drag & drop PNG files here<br>or click to select",
        header_options: "2. Conversion Options",
        options_preset: "Preset:",
        options_details: "Advanced Settings",
        options_flip: "Flip Image Vertically (Bottom-Left Origin):",
        options_appearance: "Appearance:",
        options_theme: "Theme Color:",
        header_results: "3. Execution & Results",
        results_previews: "Previews (Click to enlarge/rename)",
        results_errorLog: "Error Log:",
        results_downloadBtn: "Download ZIP File",
        modal_downloadBtn: "Download this Image",
        modal_copyBtn: "Copy",
        status_copied: "Copied!",
        status_initializing: `Initializing Workers... ({count}/${numWorkers})`,
        status_ready: `Ready (${numWorkers} cores available). Please select files.`,
        status_starting: "Starting process...",
        status_processing: "Processing: {current} / {total}",
        status_zipping: "Generating ZIP file...",
        status_downloadReady: "Your download has started.",
        summary_complete: "Complete: {success} succeeded, {error} failed",
        stats_totalTime: "Total Time",
        stats_workers: "Workers Used",
        stats_throughput: "Throughput",
        stats_avgTime: "Avg. Time/File",
        alert_noPng: "No convertible PNG files found.",
        alert_workerNotReady: "Workers are not ready yet.",
        dropZone_aria: "Select files to convert"
    }
};

// --- UTILITY FUNCTIONS ---
function t(key, replacements = {}) {
    const langDict = locales[currentLang] || locales.en;
    let text = langDict[key] || locales.en[key] || key;
    for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(`{${placeholder}}`, value);
    }
    return text;
}

function applyLocale() {
    currentLang = navigator.language.startsWith('ja') ? 'ja' : 'en';
    document.documentElement.lang = currentLang;
    document.title = t('appTitle');
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const span = el.querySelector('span');
        if (span) {
            span.textContent = t(key);
        } else {
            const html = t(key);
            if (el.innerHTML !== html) el.innerHTML = html;
        }
    });
    ui.dropZone.setAttribute('aria-label', t('dropZone_aria'));
}

function setButtonLoading(button, isLoading) {
    button.classList.toggle('btn-loading', isLoading);
}

function showButtonSuccessState(button, originalTextKey) {
    const originalText = t(originalTextKey);
    const span = button.querySelector('span');
    button.classList.add('btn-copied');
    if(span) span.textContent = t('status_copied');
    
    setTimeout(() => {
        button.classList.remove('btn-copied');
        if(span) span.textContent = originalText;
    }, 1500);
}

// --- SETTINGS FUNCTIONS ---
const presets = {
    custom: { nameKey: 'preset_custom' },
    game: { nameKey: 'preset_game', options: { flip: true } },
    graphics: { nameKey: 'preset_graphics', options: { flip: false } }
};

function applyThemeColor(color) {
    if (color) {
        document.documentElement.style.setProperty('--primary-color', color);
    }
}

function applyTheme(theme) {
    const docEl = document.documentElement;
    docEl.classList.remove('dark-theme', 'light-theme');

    if (theme === 'dark') {
        docEl.classList.add('dark-theme');
    } else if (theme === 'light') {
        docEl.classList.add('light-theme');
    } else { // system
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            docEl.classList.add('dark-theme');
        } else {
            docEl.classList.add('light-theme');
        }
    }
    ui.themeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

function saveSettings() {
    const settings = {
        preset: ui.presetSelect.value,
        flip: ui.flipCheckbox.checked,
        color: ui.themeColorPicker.value,
        theme: document.querySelector('.theme-btn.active')?.dataset.theme || 'system'
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const s = localStorage.getItem(SETTINGS_KEY);
    const defaultColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();

    if (s) {
        try {
            const p = JSON.parse(s);
            // Preset and flip
            ui.presetSelect.value = p.preset || 'game';
            if (p.preset === 'custom') {
                ui.flipCheckbox.checked = p.flip || false;
            } else {
                applyPreset();
            }
            // Theme color
            const color = p.color || defaultColor;
            ui.themeColorPicker.value = color;
            applyThemeColor(color);
            // Theme mode
            applyTheme(p.theme || 'system');
        } catch (e) {
            applyPreset();
            ui.themeColorPicker.value = defaultColor;
            applyTheme('system');
        }
    } else {
        ui.presetSelect.value = 'game';
        applyPreset();
        ui.themeColorPicker.value = defaultColor;
        applyTheme('system');
    }
}

function populatePresets() {
    ui.presetSelect.innerHTML = '';
    for (const key in presets) {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = t(presets[key].nameKey);
        ui.presetSelect.appendChild(o);
    }
}

function applyPreset() {
    const p = presets[ui.presetSelect.value];
    if (p && p.options) {
        ui.flipCheckbox.checked = p.options.flip;
    }
}

// --- CORE CONVERSION LOGIC ---
function enableDropZone(isEnabled) {
    if (isEnabled) {
        ui.dropZone.classList.remove('disabled');
        ui.dropZone.onclick = () => ui.fileInput.click();
    } else {
        ui.dropZone.classList.add('disabled');
        ui.dropZone.onclick = null;
    }
}

async function initializeWorkerPool() {
    ui.progressText.textContent = t('status_initializing', { count: 0, total: numWorkers });
    let readyCount = 0;
    const promises = Array.from({ length: numWorkers }, () => {
        return new Promise(resolve => {
            const worker = new Worker('converter-worker.js');
            worker.onmessage = e => {
                if (e.data.type === 'ready') {
                    readyCount++;
                    ui.progressText.textContent = t('status_initializing', { count: readyCount, total: numWorkers });
                    resolve(worker);
                }
            };
            workerPool.push(worker);
        });
    });
    await Promise.all(promises);
    isPoolReady = true;
    enableDropZone(true);
    ui.progressText.textContent = t('status_ready');
}

async function handleFiles(files) {
    if (!isPoolReady) {
        alert(t('alert_workerNotReady'));
        return;
    }
    const pngFiles = Array.from(files).filter(f => f.type === 'image/png');
    if (pngFiles.length === 0) {
        alert(t('alert_noPng'));
        return;
    }
    startTime = performance.now();
    resetUI();
    enableDropZone(false);
    ui.spinner.style.display = 'block';
    ui.progressText.textContent = t('status_starting');
    const options = { alignToBottomLeft: ui.flipCheckbox.checked };
    const totalFiles = pngFiles.length;
    let processedCount = 0, allSuccessResults = [], allErrorResults = [];
    const filesPerWorker = Math.ceil(totalFiles / numWorkers);
    const workerPromises = [];
    for (let i = 0; i < numWorkers; i++) {
        const worker = workerPool[i];
        const chunk = pngFiles.slice(i * filesPerWorker, (i + 1) * filesPerWorker);
        if (chunk.length > 0) {
            const promise = new Promise(resolve => {
                worker.onmessage = e => {
                    const { type, ...data } = e.data;
                    if (type === 'file_processed') {
                        processedCount++;
                        ui.progressText.textContent = t('status_processing', { current: processedCount, total: totalFiles });
                    } else if (type === 'task_complete') {
                        allSuccessResults.push(...data.results);
                        allErrorResults.push(...data.errors);
                        resolve();
                    }
                };
                worker.postMessage({ files: chunk, options });
            });
            workerPromises.push(promise);
        }
    }
    await Promise.all(workerPromises);
    showFinalSummary(allSuccessResults, allErrorResults, totalFiles);
}

function parseAndRenderTga(tgaBuffer, targetCanvas) {
    const header = new DataView(tgaBuffer, 0, 18);
    if (header.getUint8(2) !== 2 || header.getUint8(16) !== 32) {
        console.error("Preview only supports 32-bit uncompressed TGA.");
        return null;
    }
    const width = header.getUint16(12, true);
    const height = header.getUint16(14, true);
    const imageDescriptor = header.getUint8(17);
    const isOriginTopLeft = (imageDescriptor & 0x20) === 0x20;
    const pixelDataOffset = 18 + header.getUint8(0);
    const bgra = new Uint8Array(tgaBuffer, pixelDataOffset);
    const canvas = targetCanvas || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const rgba = imageData.data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcY = isOriginTopLeft ? y : height - 1 - y;
            const srcIndex = (srcY * width + x) * 4;
            const destIndex = (y * width + x) * 4;
            rgba[destIndex]     = bgra[srcIndex + 2];
            rgba[destIndex + 1] = bgra[srcIndex + 1];
            rgba[destIndex + 2] = bgra[srcIndex];
            rgba[destIndex + 3] = bgra[srcIndex + 3];
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

// --- UI AND EVENT FUNCTIONS ---
async function copyCanvasToClipboard(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
            if (!blob) {
                return reject(new Error('Canvas to Blob conversion failed.'));
            }
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                resolve();
            } catch (err) {
                console.error('Failed to copy to clipboard:', err);
                reject(err);
            }
        }, 'image/png');
    });
}

function updateModalContent(index) {
    if (index < 0 || index >= currentSuccesses.length) return;
    currentModalIndex = index;
    const result = currentSuccesses[index];
    parseAndRenderTga(result.buffer, ui.modalCanvas);
    ui.modalFilename.textContent = result.filename;
    ui.modalPrevButton.classList.toggle('hidden', currentModalIndex === 0);
    ui.modalNextButton.classList.toggle('hidden', currentModalIndex === currentSuccesses.length - 1);
    
    // Re-setup download button listener
    const newDownloadButton = ui.modalDownloadButton.cloneNode(true);
    ui.modalDownloadButton.parentNode.replaceChild(newDownloadButton, ui.modalDownloadButton);
    ui.modalDownloadButton = newDownloadButton;
    const spanDownload = ui.modalDownloadButton.querySelector('span');
    if (spanDownload) spanDownload.textContent = t('modal_downloadBtn');
    ui.modalDownloadButton.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        setButtonLoading(btn, true);
        const blob = new Blob([result.buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setTimeout(() => setButtonLoading(btn, false), 100);
    });

    // Re-setup copy button listener
    const newCopyButton = ui.modalCopyButton.cloneNode(true);
    ui.modalCopyButton.parentNode.replaceChild(newCopyButton, ui.modalCopyButton);
    ui.modalCopyButton = newCopyButton;
    const spanCopy = ui.modalCopyButton.querySelector('span');
    if(spanCopy) spanCopy.textContent = t('modal_copyBtn');
    ui.modalCopyButton.addEventListener('click', async (e) => {
        try {
            await copyCanvasToClipboard(ui.modalCanvas);
            showButtonSuccessState(e.currentTarget, 'modal_copyBtn');
        } catch (err) {
            alert('Failed to copy image to clipboard.');
        }
    });
}

function openModal(index) {
    updateModalContent(index);
    ui.modalOverlay.style.display = 'flex';
}

function showFinalSummary(successes, errors, totalFiles) {
    currentSuccesses = successes;
    const totalTimeSeconds = ((performance.now() - startTime) / 1000);
    ui.spinner.style.display = 'none';
    ui.progressText.textContent = '';
    ui.resultsArea.style.display = 'block';
    ui.summaryText.textContent = t('summary_complete', { success: successes.length, error: errors.length });
    ui.summaryText.className = errors.length > 0 ? 'has-error' : 'all-success';
    const stats = {
        [t('stats_totalTime')]: { value: `${totalTimeSeconds.toFixed(2)} s`, icon: "fa-solid fa-stopwatch" },
        [t('stats_workers')]: { value: `${numWorkers} Cores`, icon: "fa-solid fa-microchip" },
        [t('stats_throughput')]: { value: `${(totalFiles / totalTimeSeconds).toFixed(2)} files/s`, icon: "fa-solid fa-gauge-high" },
        [t('stats_avgTime')]: { value: `${(totalTimeSeconds / totalFiles * 1000).toFixed(0)} ms/file`, icon: "fa-solid fa-clock-rotate-left" }
    };
    ui.statsArea.innerHTML = Object.entries(stats).map(([label, { value, icon }]) => `<div class="stat-item"><i class="${icon}"></i><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join('');
    if (errors.length > 0) {
        ui.errorLogArea.style.display = 'block';
        ui.errorLog.innerHTML = errors.map(err => `<li><i class="fas fa-exclamation-triangle"></i> ${err.filename}: ${err.reason}</li>`).join('');
    }
    if (successes.length > 0) {
        ui.previewArea.style.display = 'block';
        ui.previewHeader.style.display = 'block';
        successes.forEach((result, index) => {
            const canvas = parseAndRenderTga(result.buffer);
            if (canvas) {
                const item = document.createElement('div');
                item.className = 'preview-item';
                item.addEventListener('click', (e) => {
                    if (e.target.tagName !== 'INPUT' && !e.target.closest('button')) {
                        openModal(index);
                    }
                });
                
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'preview-download-btn';
                downloadBtn.title = `Download ${result.filename}`;
                downloadBtn.innerHTML = '<i class="fas fa-download"></i><i class="fas fa-spinner"></i>';
                downloadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget;
                    setButtonLoading(btn, true);
                    const blob = new Blob([result.buffer], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = result.filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    setTimeout(() => setButtonLoading(btn, false), 100);
                });
                item.appendChild(downloadBtn);

                const copyBtn = document.createElement('button');
                copyBtn.className = 'preview-copy-btn';
                copyBtn.title = 'Copy to clipboard';
                copyBtn.innerHTML = '<i class="fas fa-copy"></i><i class="fas fa-check"></i>';
                copyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await copyCanvasToClipboard(canvas);
                        showButtonSuccessState(e.currentTarget, '');
                    } catch (err) {
                        alert('Failed to copy image to clipboard.');
                    }
                });
                item.appendChild(copyBtn);
                item.appendChild(canvas);

                const labelContainer = document.createElement('div');
                labelContainer.className = 'preview-item-label';
                labelContainer.title = 'Click to rename';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'filename-text';
                nameSpan.textContent = result.filename;
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'filename-input';
                nameInput.style.display = 'none';
                nameInput.value = result.filename.replace(/\.tga$/, '');
                labelContainer.appendChild(nameSpan);
                labelContainer.appendChild(nameInput);
                const deactivateEditMode = () => {
                    let newBaseName = nameInput.value.trim().replace(/[/\\?%*:|"<>]/g, '-');
                    if (!newBaseName) {
                        nameInput.value = result.filename.replace(/\.tga$/, '');
                    } else {
                        const newFilename = newBaseName + '.tga';
                        result.filename = newFilename;
                        nameSpan.textContent = newFilename;
                        downloadBtn.title = `Download ${newFilename}`;
                    }
                    nameInput.style.display = 'none';
                    nameSpan.style.display = 'inline-block';
                };
                nameSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    nameSpan.style.display = 'none';
                    nameInput.style.display = 'inline-block';
                    nameInput.focus();
                    nameInput.select();
                });
                nameInput.addEventListener('blur', deactivateEditMode);
                nameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        deactivateEditMode();
                    } else if (e.key === 'Escape') {
                        nameInput.value = result.filename.replace(/\.tga$/, '');
                        deactivateEditMode();
                    }
                });
                item.appendChild(labelContainer);
                ui.previewGrid.appendChild(item);
            }
        });
        const btnText = ui.downloadButton.querySelector('span');
        if (btnText) btnText.textContent = t('results_downloadBtn');
        ui.downloadButton.style.display = 'block';
        ui.downloadButton.onclick = (e) => generateZip(successes, e.currentTarget);
    }
    enableDropZone(true);
}

async function generateZip(results, btn) {
    setButtonLoading(btn, true);
    ui.progressText.textContent = t('status_zipping');
    const zip = new JSZip();
    for (const result of results) {
        zip.file(result.filename, result.buffer);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `converted_tga_${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    ui.progressText.textContent = t('status_downloadReady');
    setButtonLoading(btn, false);
}

function resetUI() {
    ui.spinner.style.display = 'none';
    ui.progressText.textContent = '';
    ui.resultsArea.style.display = 'none';
    ui.errorLogArea.style.display = 'none';
    ui.errorLog.innerHTML = '';
    ui.downloadButton.style.display = 'none';
    ui.statsArea.innerHTML = '';
    ui.previewArea.style.display = 'none';
    ui.previewGrid.innerHTML = '';
    ui.previewHeader.style.display = 'none';
    currentSuccesses = [];
    currentModalIndex = -1;
}

function setupEventListeners() {
    ui.presetSelect.addEventListener('change', () => { applyPreset(); saveSettings(); });
    ui.flipCheckbox.addEventListener('change', () => { ui.presetSelect.value = 'custom'; saveSettings(); });
    ui.fileInput.addEventListener('change', e => handleFiles(e.target.files));
    ui.dropZone.addEventListener('keydown', e => { if (isPoolReady && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ui.fileInput.click(); } });
    ui.dropZone.addEventListener('dragover', e => { e.preventDefault(); if (!ui.dropZone.classList.contains('disabled')) ui.dropZone.classList.add('dragover'); });
    ui.dropZone.addEventListener('dragleave', e => { e.preventDefault(); ui.dropZone.classList.remove('dragover'); });
    ui.dropZone.addEventListener('drop', e => { e.preventDefault(); ui.dropZone.classList.remove('dragover'); if (!ui.dropZone.classList.contains('disabled')) handleFiles(e.dataTransfer.files); });
    
    ui.themeColorPicker.addEventListener('input', () => {
        applyThemeColor(ui.themeColorPicker.value);
        saveSettings();
    });
    
    ui.themeSwitcher.addEventListener('click', (e) => {
        const target = e.target.closest('.theme-btn');
        if (target) {
            const theme = target.dataset.theme;
            applyTheme(theme);
            saveSettings();
        }
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const currentTheme = document.querySelector('.theme-btn.active')?.dataset.theme;
        if (currentTheme === 'system') {
            applyTheme('system');
        }
    });

    const closeModal = () => ui.modalOverlay.style.display = 'none';
    ui.modalCloseButton.addEventListener('click', closeModal);
    ui.modalOverlay.addEventListener('click', e => { if (e.target === ui.modalOverlay) closeModal(); });
    ui.modalPrevButton.addEventListener('click', () => updateModalContent(currentModalIndex - 1));
    ui.modalNextButton.addEventListener('click', () => updateModalContent(currentModalIndex + 1));
    window.addEventListener('keydown', e => {
        if (ui.modalOverlay.style.display !== 'none') {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'ArrowLeft') { e.preventDefault(); updateModalContent(currentModalIndex - 1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); updateModalContent(currentModalIndex + 1); }
        }
    });
}

function initializeApp() {
    applyLocale();
    populatePresets();
    initializeWorkerPool();
    setupEventListeners();
    loadSettings();
}

initializeApp();