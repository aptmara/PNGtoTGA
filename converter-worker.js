let wasmModule;
let processPixelsWasm;

async function initializeWasm() {
    const wasmBase64 = "AGFzbQEAAAABBgFgAX4AAwIBAAcHBAVhdXRoAgZtZW1vcnkCAAVfZGF0YQEBCg0BBwVfZGF0YQMLCgkBbWVtb3J5AwoNAQEJAQMJBwsfBwVhdXRoAwZtZW1vcnkDBQRkYXRhAwAIKQMAAQqgAQMCAQAELAEgAQt/AUEAAiABIQIgBH8gACEDIABoAgsLdws=";
    const wasmBinary = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));
    const memory = new WebAssembly.Memory({ initial: 256 });
    const { instance } = await WebAssembly.instantiate(wasmBinary, { env: { memory, __memory_base: 0, __table_base: 0 } });
    processPixelsWasm = (pointer, numPixels) => instance.exports.process_pixels_bgra(pointer, numPixels);
    let malloc_ptr = instance.exports.__heap_base || 1024;
    wasmModule = {
        _malloc: size => { const ptr = malloc_ptr; malloc_ptr += size; return ptr; },
        _free: ptr => {},
        HEAPU8: new Uint8Array(memory.buffer)
    };
    self.postMessage({ type: 'ready' });
}

initializeWasm();

self.onmessage = async (event) => {
    const { files, options } = event.data;
    const successResults = [];
    const errorResults = [];
    const transferable = [];

    for (const file of files) {
        try {
            const tgaBlob = await convertFileToTgaBlob(file, options);
            const tgaFileName = file.name.replace(/\.png$/i, '.tga');
            successResults.push({ filename: tgaFileName, blob: tgaBlob });
            transferable.push(tgaBlob);
            self.postMessage({ type: 'file_processed', success: true, filename: file.name });
        } catch (error) {
            const reason = error.message || 'Unknown error';
            errorResults.push({ filename: file.name, reason: reason });
            self.postMessage({ type: 'file_processed', success: false, filename: file.name, reason: reason });
        }
    }

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
    const tgaData = createTgaWasm(imageData, options);
    return new Blob([tgaData], { type: 'application/octet-stream' });
}

function createTgaWasm(imageData, options) {
    const { data: pixels, width, height } = imageData;
    const bufferPtr = wasmModule._malloc(pixels.length);
    wasmModule.HEAPU8.set(pixels, bufferPtr);
    processPixelsWasm(bufferPtr, width * height);
    let processedPixels = new Uint8Array(wasmModule.HEAPU8.buffer, bufferPtr, pixels.length);

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
    wasmModule._free(bufferPtr);
    return tgaFile;
}