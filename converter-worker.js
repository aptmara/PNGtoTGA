/**
 * @fileoverview PNG画像をTGA形式に変換するWeb Worker。
 * メインスレッドからファイルを受け取り、変換処理を実行して結果を返す。
 */

// --- 定数定義 ---
const TGA_HEADER_LENGTH = 18;
const TGA_IMAGE_TYPE_UNCOMPRESSED_TRUE_COLOR = 2;
const BITS_PER_PIXEL = 32;
const ALPHA_BITS = 8; // アルファチャンネルが8ビットであることを示す

// Image Descriptor の原点設定 (bit 5: 垂直方向, bit 4: 水平方向)
// 0x00: 左下原点 (Bottom-Left) TGAの標準
// 0x20: 左上原点 (Top-Left)
const IMAGE_ORIGIN_BOTTOM_LEFT = 0x00;
const IMAGE_ORIGIN_TOP_LEFT = 0x20;

/**
 * ピクセルデータを処理し、RGBAからBGRAへの変換と、必要に応じて垂直反転を行う。
 * @param {Uint8ClampedArray} pixels - 元のピクセルデータ (RGBA順)。
 * @param {number} width - 画像の幅。
 * @param {number} height - 画像の高さ。
 * @param {boolean} flipVertically - trueの場合、画像を垂直方向に反転する。
 * @returns {Uint8Array} 処理後のピクセルデータ (BGRA順)。
 */
function processPixels(pixels, width, height, flipVertically) {
    const processedPixels = new Uint8Array(pixels.length);
    const bytesPerRow = width * 4;

    for (let y = 0; y < height; y++) {
        const sourceY = y;
        const destinationY = flipVertically ? height - 1 - y : y;
        
        const sourceOffset = sourceY * bytesPerRow;
        const destinationOffset = destinationY * bytesPerRow;

        // 1行分のピクセルをBGRAに変換しつつ、正しい位置に配置する
        for (let x = 0; x < bytesPerRow; x += 4) {
            const r = pixels[sourceOffset + x];
            const g = pixels[sourceOffset + x + 1];
            const b = pixels[sourceOffset + x + 2];
            const a = pixels[sourceOffset + x + 3];

            processedPixels[destinationOffset + x] = b;
            processedPixels[destinationOffset + x + 1] = g;
            processedPixels[destinationOffset + x + 2] = r;
            processedPixels[destinationOffset + x + 3] = a;
        }
    }
    return processedPixels;
}

/**
 * TGAファイルのヘッダーを生成する。
 * @param {number} width - 画像の幅。
 * @param {number} height - 画像の高さ。
 * @param {number} imageDescriptor - TGAのImage Descriptorバイト。
 * @returns {Uint8Array} TGAヘッダーデータ。
 */
function createTgaHeader(width, height, imageDescriptor) {
    const header = new Uint8Array(TGA_HEADER_LENGTH);
    const view = new DataView(header.buffer);

    view.setUint8(2, TGA_IMAGE_TYPE_UNCOMPRESSED_TRUE_COLOR); // 画像タイプ: 非圧縮トゥルーカラー
    view.setUint16(12, width, true);  // 画像の幅 (リトルエンディアン)
    view.setUint16(14, height, true); // 画像の高さ (リトルエンディアン)
    view.setUint8(16, BITS_PER_PIXEL); // ピクセル深度
    view.setUint8(17, imageDescriptor); // イメージ記述子

    return header;
}

/**
 * ImageDataからTGAファイルのデータ(Uint8Array)を生成する。
 * @param {ImageData} imageData - 変換元のImageDataオブジェクト。
 * @param {object} options - 変換オプション。
 * @param {boolean} options.alignToBottomLeft - TGA標準の左下原点に合わせるか。
 * @returns {Uint8Array} TGAファイル全体のデータ。
 */
function createTga(imageData, options) {
    const { data: pixels, width, height } = imageData;

    // ピクセルをBGRAに変換し、必要に応じて垂直反転
    const processedPixels = processPixels(pixels, width, height, options.alignToBottomLeft);
    
    // 画像の原点情報（左上か左下か）を決定
    const imageOrigin = options.alignToBottomLeft ? IMAGE_ORIGIN_BOTTOM_LEFT : IMAGE_ORIGIN_TOP_LEFT;
    
    // イメージ記述子を計算 (原点情報 + アルファチャンネル情報)
    const imageDescriptor = imageOrigin | ALPHA_BITS;

    // TGAヘッダーを生成
    const header = createTgaHeader(width, height, imageDescriptor);
    
    // ヘッダーとピクセルデータを結合
    const tgaFile = new Uint8Array(header.length + processedPixels.length);
    tgaFile.set(header, 0);
    tgaFile.set(processedPixels, header.length);
    
    return tgaFile;
}

/**
 * FileオブジェクトをTGA形式のBlobに変換する。
 * @param {File} file - 変換するPNGファイルなど。
 * @param {object} options - 変換オプション。
 * @returns {Promise<Blob>} TGA形式のBlobオブジェクト。
 */
async function convertFileToTgaBlob(file, options) {
    // OffscreenCanvasを使用して画像をデコードし、ピクセルデータを取得
    const imageBitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(imageBitmap, 0, 0);
    imageBitmap.close(); // メモリを解放

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // TGAデータを生成
    const tgaData = createTga(imageData, options);
    
    return new Blob([tgaData], { type: 'application/octet-stream' });
}

/**
 * Web Workerのメイン処理。メッセージを受け取り、ファイル変換タスクを実行する。
 */
self.onmessage = async (event) => {
    const { files, options } = event.data;
    const successResults = [];
    const errorResults = [];

    // 受け取った全てのファイルを順に処理
    for (const file of files) {
        try {
            const tgaBlob = await convertFileToTgaBlob(file, options);
            const tgaFileName = file.name.replace(/\.[^/.]+$/, '.tga'); // 拡張子を.tgaに置換
            const tgaArrayBuffer = await tgaBlob.arrayBuffer();

            successResults.push({ filename: tgaFileName, buffer: tgaArrayBuffer });
            
            // ファイルごとの処理完了を通知
            self.postMessage({ type: 'file_processed', success: true, filename: file.name });
        } catch (error) {
            const reason = error.message || 'Unknown error';
            errorResults.push({ filename: file.name, reason: reason });
            // ファイルごとのエラーを通知
            self.postMessage({ type: 'file_processed', success: false, filename: file.name, reason: reason });
        }
    }

    // 成功した結果のバッファをTransferable Objectsとしてメインスレッドに転送
    const transferableBuffers = successResults.map(result => result.buffer);

    self.postMessage({
        type: 'task_complete',
        results: successResults,
        errors: errorResults
    }, transferableBuffers); // 第2引数でバッファの所有権を移動させ、コピーを回避
};

// Workerが初期化され、メッセージ受信準備ができたことをメインスreadに通知
self.postMessage({ type: 'ready' });