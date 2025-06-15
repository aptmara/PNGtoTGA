// ピクセル形式をBGRAに変換するJavaScript関数
function processPixelsBGRA_JS(pixels) {
    const newPixels = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i += 4) {
        newPixels[i]     = pixels[i + 2]; // Blue
        newPixels[i + 1] = pixels[i + 1]; // Green
        newPixels[i + 2] = pixels[i];     // Red
        newPixels[i + 3] = pixels[i + 3]; // Alpha
    }
    return newPixels;
}

// Web Workerのメイン処理
self.onmessage = async (event) => {
    const { files, options } = event.data;
    const successResults = [];
    const errorResults = [];
    const transferable = [];

    for (const file of files) {
        try {
            const tgaBlob = await convertFileToTgaBlob(file, options);
            const tgaFileName = file.name.replace(/\.png$/i, '.tga');
            
            // ★修正点: Blobから転送可能なArrayBufferに変換
            const tgaArrayBuffer = await tgaBlob.arrayBuffer();

            // 結果にはArrayBufferを格納し、転送リストにもArrayBufferを追加
            successResults.push({ filename: tgaFileName, buffer: tgaArrayBuffer });
            transferable.push(tgaArrayBuffer);
            
            self.postMessage({ type: 'file_processed', success: true, filename: file.name });
        } catch (error) {
            const reason = error.message || 'Unknown error';
            errorResults.push({ filename: file.name, reason: reason });
            self.postMessage({ type: 'file_processed', success: false, filename: file.name, reason: reason });
        }
    }

    // 転送リスト(transferable)にはArrayBufferが入っている
    self.postMessage({
        type: 'task_complete',
        results: successResults,
        errors: errorResults
    }, transferable);
};

async function convertFileToTgaBlob(file, options) {
    const imageBitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    imageBitmap.close();
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const tgaData = createTga(imageData, options);
    // TGAデータをBlobとして返す
    return new Blob([tgaData], { type: 'application/octet-stream' });
}

function createTga(imageData, options) {
    const { data: pixels, width, height } = imageData;
    
    let processedPixels = processPixelsBGRA_JS(pixels);

    if (options.flip) {
        const flippedPixels = new Uint8Array(pixels.length);
        const bytesPerRow = width * 4;
        for (let y = 0; y < height; y++) {
            const destinationY = height - 1 - y;
            const sourceOffset = y * bytesPerRow;
            const destinationOffset = destinationY * bytesPerRow;
            const rowData = processedPixels.subarray(sourceOffset, sourceOffset + bytesPerRow);
            flippedPixels.set(rowData, destinationOffset);
        }
        processedPixels = flippedPixels;
    }

    const imageDescriptor = options.flip ? 8 : 40; 
    const header = new Uint8Array([
        0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        width & 0xFF, (width >> 8) & 0xFF,
        height & 0xFF, (height >> 8) & 0xFF,
        32, imageDescriptor
    ]);

    const tgaFile = new Uint8Array(header.length + processedPixels.length);
    tgaFile.set(header, 0);
    tgaFile.set(processedPixels, header.length);
    return tgaFile;
}

// Workerがロードされたことを通知
self.postMessage({ type: 'ready' });