// 清洗流程、分段布局与小说文件解析。

const NI_SHA256_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function niRotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}

function niSha256HexFallback(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;

    const bitLength = input.length * 8;
    const paddedView = new DataView(padded.buffer);
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

    const hash = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let i = 0; i < 16; i++) words[i] = paddedView.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = words[i - 15];
            const y = words[i - 2];
            const sigma0 = niRotateRight(x, 7) ^ niRotateRight(x, 18) ^ (x >>> 3);
            const sigma1 = niRotateRight(y, 17) ^ niRotateRight(y, 19) ^ (y >>> 10);
            words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hash;
        for (let i = 0; i < 64; i++) {
            const sum1 = niRotateRight(e, 6) ^ niRotateRight(e, 11) ^ niRotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + sum1 + choose + NI_SHA256_CONSTANTS[i] + words[i]) >>> 0;
            const sum0 = niRotateRight(a, 2) ^ niRotateRight(a, 13) ^ niRotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
}

export async function fingerprintArrayBuffer(buffer, subtle = globalThis.crypto?.subtle) {
    const bytes = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (typeof subtle?.digest === 'function') {
        try {
            const digest = await subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.warn('[NI] 浏览器 SHA-256 不可用，改用兼容实现:', error);
        }
    }
    return niSha256HexFallback(new Uint8Array(bytes));
}

export function canUseDerivedModules(state) {
    return !state?.cleanRunning
        && Array.isArray(state?.chunkStatus)
        && state.chunkStatus.some(status => status === 'done');
}

export function getCleanProgressStats(state) {
    const total = Array.isArray(state?.chunks) && state.chunks.length
        ? state.chunks.length
        : (Array.isArray(state?.chunkStatus) ? state.chunkStatus.length : 0);
    let done = 0;
    let error = 0;
    let running = 0;
    let pending = 0;
    for (let i = 0; i < total; i++) {
        const status = state?.chunkStatus?.[i] || 'pending';
        if (status === 'done') done++;
        else if (status === 'error') error++;
        else if (status === 'running') running++;
        else pending++;
    }
    return {
        total,
        done,
        error,
        running,
        pending,
        hasAnyProgress: done > 0 || error > 0 || running > 0,
        isPartial: total > 0 && (done > 0 || error > 0 || running > 0) && done < total,
        isComplete: total > 0 && done === total && error === 0 && running === 0,
    };
}

export function hasPartialCleanProgress(state) {
    return getCleanProgressStats(state).isPartial;
}

export function normalizeCleanArraysToChunks(state) {
    if (!state || typeof state !== 'object') return 0;
    if (!Array.isArray(state.chunks)) state.chunks = [];
    const total = state.chunks.length;
    const valid = new Set(['pending', 'done', 'error']);
    state.chunkStatus = state.chunks.map((_, i) => {
        const status = state.chunkStatus?.[i] || 'pending';
        return valid.has(status) ? status : 'pending';
    });
    state.chunkResults = state.chunks.map((_, i) => state.chunkResults?.[i] || '');
    state.chunkMeta = state.chunks.map((_, i) => state.chunkMeta?.[i] || null);
    return total;
}

export function splitNovelText(text, kb, charsPerByte = 0.5) {
    const safeText = String(text || '');
    const ratio = Number(charsPerByte) > 0 ? Number(charsPerByte) : 0.5;
    const targetChars = Math.max(1, Math.round(Number(kb) * 1024 * ratio));
    const chunks = [];
    let start = 0;

    while (start < safeText.length) {
        let end = start + targetChars;
        if (end >= safeText.length) {
            chunks.push(safeText.slice(start));
            break;
        }
        const lookAhead = safeText.indexOf('\n', end);
        if (lookAhead !== -1 && lookAhead - end < 500) end = lookAhead + 1;
        chunks.push(safeText.slice(start, end));
        start = end;
    }
    return chunks;
}

export function buildRechunkLayout({
    chunks: oldChunks = [],
    status: oldStatus = [],
    results: oldResults = [],
    meta: oldMeta = [],
    kb,
    charsPerByte = 0.5,
} = {}) {
    const chunks = [];
    const status = [];
    const results = [];
    const meta = [];
    const oldToNewChunkIdx = new Map();
    let pendingText = '';
    let preserved = 0;

    const flushPending = () => {
        if (!pendingText) return;
        splitNovelText(pendingText, kb, charsPerByte).forEach(text => {
            chunks.push(text);
            status.push('pending');
            results.push('');
            meta.push(null);
        });
        pendingText = '';
    };

    oldChunks.forEach((text, index) => {
        const canPreserve = oldStatus[index] === 'done'
            && String(oldResults[index] || '').trim()
            && oldMeta[index];
        if (!canPreserve) {
            pendingText += text || '';
            return;
        }
        flushPending();
        oldToNewChunkIdx.set(index, chunks.length);
        chunks.push(text);
        status.push('done');
        results.push(oldResults[index]);
        meta.push(oldMeta[index]);
        preserved++;
    });
    flushPending();

    return {
        chunks,
        status,
        results,
        meta,
        preserved,
        pending: status.filter(value => value !== 'done').length,
        oldToNewChunkIdx,
    };
}

function stripMarkdownFence(text) {
    return String(text || '').trim()
        .replace(/^```json\s*/, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '');
}

export function parseCleanResponse(raw, _chunkIndex = null, warn = (...args) => console.warn(...args)) {
    const source = String(raw || '');
    let meta = null;
    let compressed = source;
    const fail = (message, code) => {
        const error = new Error(message);
        error.code = code;
        warn('[NI] 清洗响应不合规:', error);
        return { compressed: compressed.trim(), meta: null, error };
    };
    if (!source.trim()) return fail('模型返回内容为空，没有可用的清洗结果。', 'NI_CLEAN_EMPTY');

    const metaMatch = source.match(/<ni_meta>([\s\S]*?)<\/ni_meta>/);
    if (metaMatch) {
        compressed = source.replace(/<ni_meta>[\s\S]*?<\/ni_meta>/, '').trim();
        try {
            meta = JSON.parse(stripMarkdownFence(metaMatch[1]));
        } catch (error) {
            return fail(`清洗结果的 ni_meta JSON 语法错误：${String(error.message).slice(0, 180)}。请重试；反复失败可减小每段大小或检查清洗提示词。`, 'NI_CLEAN_JSON');
        }
    } else {
        const fallbackMatch = source.match(/\{[\s\S]*"plots"[\s\S]*\}/);
        if (fallbackMatch) {
            try {
                meta = JSON.parse(stripMarkdownFence(fallbackMatch[0]));
                compressed = stripMarkdownFence(source.replace(fallbackMatch[0], ''));
                warn('[NI] 未找到 ni_meta 标签，但从正文抢救到裸 JSON，已使用。');
            } catch (error) {
                return fail(`清洗结果的 JSON 语法错误：${String(error.message).slice(0, 180)}。请重试；反复失败可减小每段大小或检查清洗提示词。`, 'NI_CLEAN_JSON');
            }
        } else {
            return fail(source.includes('<ni_meta>')
                ? '清洗结果的 ni_meta 未闭合，结构化 JSON 不完整。请检查是否输出中断，减小每段大小后重试。'
                : '清洗结果缺少 ni_meta 结构化数据，无法提取剧情与角色。请检查模型是否按清洗提示词输出后重试。', 'NI_CLEAN_META');
        }
    }

    const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!isRecord(meta)) return fail('清洗结果的 JSON 结构不合规：ni_meta 必须是对象。', 'NI_CLEAN_SCHEMA');
    for (const field of ['plots', 'characters']) {
        if (!Array.isArray(meta[field])) return fail(`清洗结果的 JSON 结构不合规：${field} 必须是数组，没有内容时也应返回 []。`, 'NI_CLEAN_SCHEMA');
    }
    if (meta.plots.some(plot => !isRecord(plot) || typeof plot.title !== 'string' || !plot.title.trim()
        || !['main', 'sub', 'pivot'].includes(plot.type))) {
        return fail('清洗结果的 JSON 结构不合规：plots 中每个节点都需要非空标题和有效类型（main / sub / pivot）。', 'NI_CLEAN_SCHEMA');
    }
    if (meta.characters.some(character => !isRecord(character) || typeof character.name !== 'string' || !character.name.trim())) {
        return fail('清洗结果的 JSON 结构不合规：characters 中每个角色都需要非空姓名。', 'NI_CLEAN_SCHEMA');
    }
    for (const field of ['character_aliases', 'aliases']) {
        if (meta[field] != null && (!Array.isArray(meta[field]) || meta[field].some(alias => !isRecord(alias)))) {
            return fail(`清洗结果的 JSON 结构不合规：${field} 必须是对象数组。`, 'NI_CLEAN_SCHEMA');
        }
    }
    if (!compressed.trim()) return fail('清洗结果只有 JSON 元数据，缺少压缩正文。请检查清洗提示词后重试。', 'NI_CLEAN_EMPTY');
    return { compressed, meta, error: null };
}

export function detectEncoding(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return 'utf-8';
    if (b[0] === 0xFF && b[1] === 0xFE) return 'utf-16le';
    if (b[0] === 0xFE && b[1] === 0xFF) return 'utf-16be';
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return 'utf-8';
    } catch (_) {
        return 'gb18030';
    }
}

export function niNovelFileExt(fileName = '') {
    const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? `.${match[1]}` : '';
}

export function niIsSupportedNovelFile(file) {
    return ['.txt', '.mobi'].includes(niNovelFileExt(file?.name || ''));
}

export function niReadAscii(u8, start, len) {
    let text = '';
    for (let i = 0; i < len && start + i < u8.length; i++) text += String.fromCharCode(u8[start + i]);
    return text;
}

export function niConcatBytes(parts, limit = 0) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const outLen = limit > 0 ? Math.min(limit, total) : total;
    const out = new Uint8Array(outLen);
    let pos = 0;
    for (const part of parts) {
        if (pos >= outLen) break;
        out.set(part.slice(0, outLen - pos), pos);
        pos += Math.min(part.length, outLen - pos);
    }
    return out;
}

export function niPalmDocDecompress(input, opts = {}) {
    const out = [];
    for (let i = 0; i < input.length;) {
        const c = input[i++];
        if (c === 0) {
            out.push(0);
        } else if (c <= 8) {
            for (let j = 0; j < c && i < input.length; j++) out.push(input[i++]);
        } else if (c <= 0x7f) {
            out.push(c);
        } else if (c <= 0xbf) {
            if (i >= input.length) break;
            const c2 = input[i++];
            const pair = ((c & 0x3f) << 8) | c2;
            const distance = pair >> 3;
            const length = (c2 & 0x07) + 3;
            if (distance <= 0 || distance > out.length) {
                if (!opts.tolerant) throw new Error('MOBI 解压失败：压缩引用无效');
                continue;
            }
            for (let j = 0; j < length; j++) out.push(out[out.length - distance]);
        } else {
            out.push(0x20, c ^ 0x80);
        }
    }
    return new Uint8Array(out);
}

export function niMobiTrailingEntrySize(u8, end) {
    let pos = end;
    let value = 0;
    let shift = 0;
    while (pos > 0 && shift < 28) {
        const byte = u8[--pos];
        value |= (byte & 0x7f) << shift;
        shift += 7;
        if (byte & 0x80) return Math.min(value, end);
    }
    return 0;
}

export function niStripMobiTrailingData(u8, extraFlags = 0) {
    let end = u8.length;
    let flags = extraFlags >> 1;
    while (flags && end > 0) {
        if (flags & 1) {
            const size = niMobiTrailingEntrySize(u8, end);
            if (!size || size > end) break;
            end -= size;
        }
        flags >>= 1;
    }
    if ((extraFlags & 1) && end > 0) {
        const overlap = u8[end - 1] & 0x03;
        if (overlap <= end) end -= overlap;
    }
    return end < u8.length ? u8.slice(0, end) : u8;
}

export function niMobiTextEncoding(code) {
    if (code === 65001) return 'utf-8';
    if (code === 1252) return 'windows-1252';
    if (code === 932) return 'shift_jis';
    if (code === 936) return 'gb18030';
    if (code === 949) return 'euc-kr';
    if (code === 950) return 'big5';
    if (code === 1200) return 'utf-16le';
    if (code === 54936) return 'gb18030';
    return 'utf-8';
}

export function niMobiCompressionName(code) {
    if (code === 1) return '无压缩';
    if (code === 2) return 'PalmDOC';
    if (code === 17480) return 'Huff/CDIC';
    return `未知类型 ${code}`;
}

export function niDecodeHtmlEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
}

export function niMobiHtmlToText(html) {
    const text = String(html || '')
        .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '\n')
        .replace(/<!--[\s\S]*?-->/g, '\n')
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote|section|article|tr)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, '');
    return niDecodeHtmlEntities(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function niExtractMobiText(buf) {
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    if (u8.length < 86) throw new Error('MOBI 文件过小或格式不完整');

    const recordCount = view.getUint16(76, false);
    if (!recordCount || 78 + recordCount * 8 > u8.length) throw new Error('MOBI 记录表损坏');

    const records = [];
    for (let i = 0; i < recordCount; i++) {
        const pos = 78 + i * 8;
        const start = view.getUint32(pos, false);
        const end = i + 1 < recordCount ? view.getUint32(pos + 8, false) : u8.length;
        if (start >= u8.length || end > u8.length || end < start) throw new Error('MOBI 记录偏移异常');
        records.push({ start, end });
    }

    const header = records[0];
    if (header.end - header.start < 32) throw new Error('MOBI 头部不完整');

    const compression = view.getUint16(header.start, false);
    const textLength = view.getUint32(header.start + 4, false);
    const textRecords = view.getUint16(header.start + 8, false);
    const encryption = view.getUint16(header.start + 12, false);
    if (encryption) throw new Error('这是加密/DRM MOBI，浏览器插件无法直接读取正文；请先用你有权限的工具导出为 TXT 后再上传。');
    if (compression === 17480) throw new Error('这是 Huff/CDIC 压缩 MOBI，当前浏览器端解析器暂不支持；请先转换为 TXT 后上传。');
    if (compression !== 1 && compression !== 2) throw new Error(`暂不支持此 MOBI 压缩类型：${niMobiCompressionName(compression)}。`);

    const mobiHeader = header.start + 16;
    if (niReadAscii(u8, mobiHeader, 4) !== 'MOBI') throw new Error('未找到 MOBI 头部');
    const mobiHeaderLen = view.getUint32(mobiHeader + 4, false);
    const encodingCode = view.getUint32(mobiHeader + 12, false);
    const encoding = niMobiTextEncoding(encodingCode);
    const extraFlags = mobiHeaderLen >= 244 && mobiHeader + 0xf4 <= header.end
        ? view.getUint16(mobiHeader + 0xf2, false)
        : 0;

    const parts = [];
    const lastTextRecord = Math.min(textRecords, records.length - 1);
    let tolerantUsed = false;
    for (let i = 1; i <= lastTextRecord; i++) {
        const record = records[i];
        const raw = niStripMobiTrailingData(u8.slice(record.start, record.end), extraFlags);
        if (compression === 2) {
            try {
                parts.push(niPalmDocDecompress(raw));
            } catch (error) {
                if (!tolerantUsed) console.warn('[NI] MOBI 严格解压失败，已切换容错提取。');
                tolerantUsed = true;
                parts.push(niPalmDocDecompress(raw, { tolerant: true }));
            }
        } else {
            parts.push(raw);
        }
    }

    const textBytes = niConcatBytes(parts, textLength);
    let html;
    try {
        html = new TextDecoder(encoding).decode(textBytes);
    } catch (_) {
        html = new TextDecoder('utf-8').decode(textBytes);
    }

    const text = niMobiHtmlToText(html);
    if (!text) throw new Error('MOBI 中没有提取到可用正文');
    return { text, sourceBytes: textBytes.length };
}

export function niExtractNovelText(buf, fileName) {
    const ext = niNovelFileExt(fileName);
    if (ext === '.mobi') return niExtractMobiText(buf);

    const encoding = detectEncoding(buf);
    const text = new TextDecoder(encoding).decode(buf);
    return { text, sourceBytes: new Uint8Array(buf).length };
}


// ============================================================
// Cleaning controller
// ============================================================

// 自动续跑的轮间退避：首轮 3 秒，按轮次线性递增，封顶 30 秒。
// Key 填错时整轮分段会瞬间全部失败，没有退避就会变成高速空转。
export const NI_CLEAN_AUTO_RESUME_BASE_DELAY_MS = 3000;
export const NI_CLEAN_AUTO_RESUME_MAX_DELAY_MS = 30000;

export function createCleaningController({
    state: S,
    getSettings,
    defaultSettings,
    cleanPrompt,
    q,
    sv,
    alert,
    confirmRestart = async () => false,
    confirm = null,
    toastr = globalThis.toastr,
    logger = console,
    FileReader: FileReaderClass = globalThis.FileReader,
    AbortController: AbortControllerClass = globalThis.AbortController,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timerId => clearTimeout(timerId),
    now = () => Date.now(),
    fingerprintArrayBuffer: niFingerprintArrayBuffer,
    resetNovelWorkspace: niResetNovelWorkspace,
    maybeAutoProtectWorkspace: niMaybeAutoProtectWorkspace = async () => false,
    serverLoadHeavy: niServerLoadHeavy,
    rechunkPreservingCompleted: niRechunkPreservingCompleted,
    remapVectorSourceChunkIndices: dbRemapSourceChunkIndices,
    resetChunkDerivedState: niResetChunkDerivedState,
    populateStyleChunkSelector: niStylePopulateChunkSel,
    saveSettings: niSaveSettings,
    ensureChunksLoaded: niEnsureChunksLoaded,
    hasLoadedChunks: niHasLoadedChunks,
    concurrencyLimit,
    mergeCharacters,
    mergeCharacterAliases,
    mergePlots,
    writeBackCleanSnapshot: niWriteBackCleanSnapshot = async () => false,
    restorePlotCheckpointMemory,
    restoreCharacterMemory,
    sortPlotsByStoryOrder: niSortPlotsByStoryOrder,
    rebuildStageMapFromPlotStageIdx,
    syncSubPlotStageAssignments: niSyncSubPlotStageAssignments,
    callCleanApi,
    prepareCleanRequest,
    callCleanTaskApi,
    // 按作用域中止清洗请求（只中止 clean 通道登记的在飞请求，不误杀其他模块）
    abortCleanRequestScopes = null,
    // 切换小说前把自动保存的待写数据落盘（由 index.js 注入）
    flushAutosave = async () => false,
    finishCleanRequest = () => {},
    capturePlotCheckpointMemory,
    captureCharacterMemory,
    renderPlots,
    renderCharacters,
    buildStages,
    clearNovelVectors: dbClearNovel,
    onNovelFileLoaded = () => {},
} = {}) {
    const console = logger;
    const setTimeout = setTimer;
    const clearTimeout = clearTimer;
    let cleanStartPending = false;
    let failureToast = null;
    let failureToastChunk = null;

    function niReportCleanFailure(i, error, attempt = 1, maxAttempts = 1) {
        const reason = String(error?.message || error || '未知错误');
        const retrying = attempt < maxAttempts;
        const title = `第 ${i + 1} 段清洗失败${maxAttempts > 1 ? `（第 ${attempt}/${maxAttempts} 次尝试）` : ''}`;
        const next = retrying ? `将自动重试，还剩 ${maxAttempts - attempt} 次。`
            : (maxAttempts > 1 && niCleanAutoResumeEnabled() ? '本轮已标记失败，自动续跑会再次尝试；可点击“暂停”后调整设置。' : '可使用“生成此段”或“续跑清洗”重试。');
        const el = q(`#ni-cs-${i}`);
        if (el) el.title = reason;
        const method = retrying ? 'warning' : 'error';
        if (toastr?.[method]) {
            if (failureToast) toastr.clear?.(failureToast);
            failureToast = toastr[method](`${reason}\n${next}`, title, {
                escapeHtml: true,
                closeButton: true,
                timeOut: retrying ? 10000 : 0,
                extendedTimeOut: retrying ? 2000 : 0,
                progressBar: retrying,
            });
            failureToastChunk = i;
        } else if (!retrying) {
            alert?.(`${title}\n${reason}\n${next}`);
        }
    }
    function niOnDrop(e) {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f && niIsSupportedNovelFile(f)) niApplyFile(f);
        else if (f) alert('仅支持 .txt / .mobi 小说文件。');
    }
    
    function niOnFile(inp) {
        const f = inp?.files?.[0];
        if (f && niIsSupportedNovelFile(f)) niApplyFile(f);
        else if (f) alert('仅支持 .txt / .mobi 小说文件。');
    }
    
    function niApplyFile(f) {
        // 向量化没有暂停/续跑入口，切工作区会让后台循环把向量写进错误的 novelKey，
        // 所以向量化期间禁止载入新文件（已建向量不受影响）。
        if (S._vecRunning) {
            alert('向量化正在进行，无法载入新小说文件。请等待向量化完成后再切换。');
            return;
        }
        const reader = new FileReaderClass();
        reader.onload = async ev => {
            try {
                const buf = ev.target.result;
                const fingerprint = await niFingerprintArrayBuffer(buf);
                const extracted = niExtractNovelText(buf, f.name);
                const cfg = getSettings() || {};
                const kb = getCfgKb();
                const previousFingerprint = S.fileFingerprint || cfg._fileFingerprint || '';
                const previousKb = Number(S.chunkKbUsed || cfg._chunkKbUsed) || 0;
                const sameContent = !!previousFingerprint && previousFingerprint === fingerprint;
                const sameChunkConfig = sameContent && previousKb === kb;
                // 清洗运行中重传同一文件会重绑分段数组（重新分段），在跑的工人仍按旧下标读写，
                // 结果与元数据会落错分段，并顺手清掉 cleanRunning/暂停标志。此处直接拒绝。
                if (sameContent && (S.cleanRunning || niIsCleanDetached())) {
                    sv('#ni-chunk-kb', S.chunkKbUsed || previousKb || getCfgKb());
                    alert('清洗运行中不能重新载入同一文件（会打断当前清洗），请先暂停清洗。');
                    return;
                }
                const existingKey = S.novelKey || cfg._novelKey || '';
                const existingHeavyFileKey = S.heavyFileKey || cfg._heavyFileKey || '';
                const oldChunks = [...(S.chunks || [])];
                const oldStatus = [...(S.chunkStatus || [])];
                const oldResults = [...(S.chunkResults || [])];
                const oldMeta = [...(S.chunkMeta || [])];
                let appliedKb = kb;
    
                if (!sameContent) {
                    // 多小说工作区隔离：换文件会重置当前工作区。清洗在跑时把它切到后台
                    // 会话继续运行（与工作区解绑）；工作区有内容且没有指向它的快照时自动
                    // 备份，已有快照且存在后台会话时把最新进度同步进去。
                    // wasAlreadyDetached：只有本次刚切走的会话才把这次 protect 的快照登记为
                    // 写回目标；早已在后台运行的会话保留它自己的写回目标（niSetCleanSessionHome
                    // 本身也只登记一次，这里是双保险）。
                    const wasAlreadyDetached = niIsCleanDetached();
                    // 先把自动保存的防抖/重跑数据落盘，再切换工作区（切换后内存被重置）
                    await flushAutosave?.();
                    const detached = niDetachCleanForSwitch();
                    const protectInfo = await niMaybeAutoProtectWorkspace({ reason: '新小说自动备份', syncExisting: detached });
                    if (detached && !wasAlreadyDetached && protectInfo) niSetCleanSessionHome(protectInfo);
                    // 用户可能在切换前刚好点了暂停：重置会清掉 stopClean，这里先记下来
                    const stopRequested = S.stopClean;
                    niResetNovelWorkspace();
                    // 重置会把 S.cleanRunning/stopClean 清掉；后台会话仍在跑，恢复标志，
                    // 否则前台可以另起清洗、用户刚点的暂停会被吞掉
                    if (detached) {
                        S.cleanRunning = true;
                        S.stopClean = !!stopRequested;
                    }
                    const safeName = f.name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40) || 'novel';
                    S.novelKey = `${safeName}_${fingerprint.slice(0, 12)}_${now().toString(36)}`;
                } else {
                    S.novelKey = existingKey || `novel_${fingerprint.slice(0, 12)}_${now().toString(36)}`;
                    S.heavyFileKey = existingHeavyFileKey;
                }
    
                S.rawText = extracted.text;
                S.rawFileSize = f.size;
                S.fileFingerprint = fingerprint;
    
                // 动态系数：实际字符数 / 文件字节数，兼容任意编码
                S._charsPerByte = S.rawText.length / Math.max(1, extracted.sourceBytes || f.size);
    
                if (sameChunkConfig) {
                    S.chunks = splitNovelText(S.rawText, kb, S._charsPerByte || 0.5);
                    S.chunkStatus = S.chunks.map((_, i) => S.chunkStatus[i] || 'pending');
                    S.chunkResults = S.chunks.map((_, i) => S.chunkResults[i] || '');
                    S.chunkMeta = S.chunks.map((_, i) => S.chunkMeta[i] || null);
                } else if (sameContent) {
                    S.chunks = oldChunks.length ? oldChunks : splitNovelText(S.rawText, previousKb || kb, S._charsPerByte || 0.5);
                    S.chunkStatus = S.chunks.map((_, i) => oldStatus[i] || 'pending');
                    S.chunkResults = S.chunks.map((_, i) => oldResults[i] || '');
                    S.chunkMeta = S.chunks.map((_, i) => oldMeta[i] || null);
    
                    let missingCompletedData = S.chunkStatus.some((status, i) => status === 'done'
                        && (!String(S.chunkResults[i] || '').trim() || !S.chunkMeta[i]));
                    if (missingCompletedData) {
                        try {
                            await niServerLoadHeavy(S.novelKey, S.heavyFileKey, { core: true, chunks: true });
                        } catch (e) {
                            console.warn('[NI] 重新分段前恢复完成分段失败:', e);
                        }
                        missingCompletedData = S.chunkStatus.some((status, i) => status === 'done'
                            && (!String(S.chunkResults[i] || '').trim() || !S.chunkMeta[i]));
                    }
                    if (missingCompletedData) {
                        appliedKb = previousKb || kb;
                        sv('#ni-chunk-kb', appliedKb);
                        alert('无法完整恢复已完成分段，已保留原分段大小，避免丢失清洗进度。');
                    } else {
                        const rechunked = niRechunkPreservingCompleted(kb);
                        await dbRemapSourceChunkIndices(rechunked.oldToNewChunkIdx).catch(e => {
                            console.warn('[NI] 重新分段后更新向量正文顺序失败:', e);
                        });
                        if (rechunked.preserved > 0) {
                            toastr?.success(`已保留 ${rechunked.preserved} 个完成分段，其余正文按 ${kb} KB 重新分段`);
                        }
                    }
                } else {
                    S.chunks = splitNovelText(S.rawText, kb, S._charsPerByte || 0.5);
                    niResetChunkDerivedState();
                }
                S.chunkKbUsed = appliedKb;
                S.fileLoaded = true;
                onNovelFileLoaded(f.name);
    
                // UI
                q('#ni-uz')?.classList.add('loaded');
                q('#ni-u-label').textContent = f.name;
                q('#ni-u-hint').textContent = `${Math.round(f.size / 1024)} KB · 共 ${S.chunks.length} 段（${appliedKb} KB/段）`;
                const ok = q('#ni-u-ok');
                if (ok) ok.style.display = 'flex';
                q('#ni-u-fname').textContent = `${f.name} 已上传`;
                const ci = q('#ni-chunk-info');
                if (ci) ci.style.display = 'block';
                q('#ni-st-chunks').textContent = S.chunks.length;
                q('#ni-st-size').textContent = `${Math.round(f.size / 1024)} KB`;
    
                renderChunkList();
                niStylePopulateChunkSel();
                if (!sameContent) {
                    // 新小说必须立即刷新所有派生界面，不能继续展示上一本小说的卡片。
                    renderPlots?.();
                    renderCharacters?.();
                    buildStages?.();
                    const styleResult = q('#ni-style-result');
                    if (styleResult) styleResult.value = '';
                    const styleResultWrap = q('#ni-style-result-wrap');
                    if (styleResultWrap) styleResultWrap.style.display = 'none';
                }
                niSyncCleanButtonState();
                niSaveSettings();
            } catch (e) {
                console.error('[NI] 文件解析失败:', e);
                alert(`文件解析失败：${e.message || e}`);
            }
        };
        reader.onerror = () => alert('读取文件失败，请重新选择文件。');
        reader.readAsArrayBuffer(f);
    }
    
    function getCfgKb() {
        return Math.max(10, parseInt(q('#ni-chunk-kb')?.value) || 100);
    }
    
    function niOnKbChange() {
        if (!S.fileLoaded) return;
        clearTimeout(S.kbTimer);
        S.kbTimer = setTimeout(async () => {
            const kb = getCfgKb();
            if (kb === S.chunkKbUsed) return;
            if (S.cleanRunning) {
                sv('#ni-chunk-kb', S.chunkKbUsed || defaultSettings.chunkKb);
                alert('清洗运行中不能调整分段大小，请先暂停。');
                return;
            }
            const hasCompleted = S.chunkStatus.some(status => status === 'done');
            const missingCompletedText = S.chunkStatus.some((status, i) => status === 'done' && !String(S.chunkResults[i] || '').trim());
            if (hasCompleted && missingCompletedText) {
                const loaded = await niEnsureChunksLoaded();
                const stillMissing = S.chunkStatus.some((status, i) => status === 'done' && !String(S.chunkResults[i] || '').trim());
                if (!loaded || stillMissing) {
                    sv('#ni-chunk-kb', S.chunkKbUsed || defaultSettings.chunkKb);
                    alert('无法加载已完成分段的压缩结果，已取消重新分段，避免丢失进度。');
                    return;
                }
            }
            const rechunked = niRechunkPreservingCompleted(kb);
            await dbRemapSourceChunkIndices(rechunked.oldToNewChunkIdx).catch(e => {
                console.warn('[NI] 重新分段后更新向量正文顺序失败:', e);
            });
            S.chunkKbUsed = kb;
            q('#ni-u-hint').textContent = `${Math.round(S.rawFileSize / 1024)} KB · 共 ${S.chunks.length} 段（${kb} KB/段）`;
            q('#ni-st-chunks').textContent = S.chunks.length;
            renderChunkList();
            niStylePopulateChunkSel();
            niSyncCleanButtonState();
            niSaveSettings();
            if (rechunked.preserved > 0) {
                toastr?.success(`已保留 ${rechunked.preserved} 个完成分段，其余正文按 ${kb} KB 重新分段`);
            }
        }, 400);
    }
    
    function renderChunkList() {
        const list = q('#ni-chunk-list');
        if (!list) return;
        list.innerHTML = S.chunks.map((c, i) => {
            const charsPerByte = S._charsPerByte || 0.5;
            const kb = Math.round(c.length / (charsPerByte * 1024));
            const st = S.chunkStatus[i] || 'pending';
            const { cls, txt } = chunkStatStyle(st);
            return `<div class="ni-chunk-row">
              <span class="ni-chunk-idx">${i + 1}</span>
              <span class="ni-chunk-info">第 ${i + 1} 段 · ${kb} KB</span>
              <span class="ni-chunk-stat ${cls}" id="ni-cs-${i}">${txt}</span>
              <button class="ni-chunk-preview-btn" data-chunk-idx="${i}" title="预览此段清洗请求">查看请求</button>
              <button class="ni-chunk-run-btn" data-chunk-idx="${i}" title="单独清洗此段">生成此段</button>
            </div>`;
        }).join('');
    }
    
    function chunkStatStyle(st) {
        return {
            pending: { cls: 'ni-cs-w', txt: '待处理' },
            running: { cls: 'ni-cs-r', txt: '处理中…' },
            done:    { cls: 'ni-cs-d', txt: '已完成' },
            error:   { cls: 'ni-cs-e', txt: '失败' },
        }[st] || { cls: 'ni-cs-w', txt: '待处理' };
    }
    
    function setChunkStat(i, st) {
        CS.chunkStatus[i] = st;
        if (st === 'done' && failureToast && failureToastChunk === i) {
            toastr?.clear?.(failureToast);
            failureToast = null;
            failureToastChunk = null;
        }
        // 后台会话：分段列表 DOM 属于前台小说，不更新——但如果工作区显示的正是
        // 本会话这本小说（切换没完成、或加载过它的快照），照常更新，避免
        // "计数器在走、列表却冻住"的错觉
        if (CS !== S) {
            const sess = niGetCleanSessionInfo();
            if (!sess || sess.novelKey !== S.novelKey) return;
        }
        const el = q(`#ni-cs-${i}`);
        if (!el) return;
        const { cls, txt } = chunkStatStyle(st);
        el.className = `ni-chunk-stat ${cls}`;
        el.textContent = txt;
        if (st !== 'error') el.title = '';
    }
    
    function niCleanConcurrencyLimit() {
        const cfg = getSettings?.() || {};
        // 清洗专用 API 设了自己的并发时，清洗工作线程也随之收紧，
        // 避免开一堆线程却在信号量上空等。开关关掉时专用数字一并失效。
        const own = cfg.cleanApi2Enabled === true ? parseInt(cfg.cleanApi2Concurrency, 10) : 0;
        if (Number.isFinite(own) && own > 0) return own;
        return concurrencyLimit(cfg.apiConcurrency, defaultSettings.apiConcurrency);
    }
    
    function niBuildCleanTask(i) {
        let previousContext = '';
        let previousLabel = '';
        if (i > 0) {
            if (CS.chunkStatus[i - 1] === 'done' && CS.chunkResults[i - 1]) {
                previousContext = CS.chunkResults[i - 1].slice(-800);
                previousLabel = '前段概括';
            } else if (CS.chunks[i - 1]) {
                previousContext = CS.chunks[i - 1].slice(-800);
                previousLabel = '前段原文末尾';
            }
        }
        return {
            chunkIndex: i, novelKey: CS.novelKey || '',
            instructions: getSettings()?.customPrompt || cleanPrompt,
            previousContext, previousLabel, sourceText: CS.chunks[i],
        };
    }

    // 兼容旧调用方；新清洗入口直接接收有明确资料字段的 task。
    function niBuildCleanMessages(i) {
        const { instructions, previousContext, previousLabel, sourceText } = niBuildCleanTask(i);
        return [
            { role: 'system', content: instructions },
            {
                role: 'user',
                content: previousContext
                    ? `【${previousLabel}（仅供衔接参考，不要重复压缩）】\n${previousContext}\n\n【本段原文（请压缩并输出 ni_meta）】\n${sourceText}`
                    : `【本段原文（请压缩并输出 ni_meta）】\n${sourceText}`,
            },
        ];
    }
    
    function niRebuildStructuredDataFromChunks(plotOrderMemory = null, characterMemory = null) {
        CS.characters = [];
        CS.plots = { main: [], sub: [], pivot: [] };
        for (let i = 0; i < CS.chunkStatus.length; i++) {
            const meta = CS.chunkStatus[i] === 'done' ? CS.chunkMeta[i] : null;
            if (!meta) continue;
            mergeCharacters(CS, meta.characters || [], i);
            mergeCharacterAliases(CS, meta.character_aliases || meta.aliases || [], i);
            mergePlots(CS, meta.plots || [], i);
        }
        if (plotOrderMemory) restorePlotCheckpointMemory(CS, plotOrderMemory);
        if (characterMemory) restoreCharacterMemory(CS, characterMemory);
        ['main', 'sub', 'pivot'].forEach(type => niSortPlotsByStoryOrder(CS.plots[type]));
        rebuildStageMapFromPlotStageIdx(CS);
        niSyncSubPlotStageAssignments(CS);
    }
    
    async function niProcessCleanChunk(i, titleNote) {
        if (S.stopClean || CS.chunkStatus[i] === 'done') return { paused: S.stopClean };
        setChunkStat(i, 'running');
        const messages = niBuildCleanMessages(i);
        const task = niBuildCleanTask(i);
        let prepared = null;
        const maxRetry = 3;
    
        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            if (S.stopClean) {
                setChunkStat(i, 'pending');
                return { paused: true };
            }
            if (attempt > 1) {
                if (titleNote) titleNote.textContent = `第 ${i + 1} 段重试 ${attempt - 1}…`;
                await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                if (S.stopClean) {
                    setChunkStat(i, 'pending');
                    return { paused: true };
                }
            }
            // 退避期间点下的「跳过」：本段直接判为跳过，不再发起下一次请求
            if (S._cleanSkipNext) {
                S._cleanSkipNext = false;
                setChunkStat(i, 'error');
                return { skipped: true, error: true };
            }
    
            const controller = new AbortControllerClass();
            S._cleanAbortControllers.set(i, controller);
            try {
                if (prepareCleanRequest && !prepared) prepared = await prepareCleanRequest(task);
                const raw = prepared
                    ? await callCleanTaskApi(prepared, { signal: controller.signal, attempt, apiRole: 'clean' })
                    : await callCleanApi(messages, { signal: controller.signal, apiRole: 'clean' });
                const { compressed, meta, error } = parseCleanResponse(raw, i, console.warn.bind(console));
                if (prepared) finishCleanRequest(prepared, { attempt, error });
                if (error) throw error;
                CS.chunkResults[i] = compressed;
                CS.chunkMeta[i] = meta;
                setChunkStat(i, 'done');
                return { done: true };
            } catch (err) {
                if (prepared) finishCleanRequest(prepared, { attempt, error: err });
                if (S.stopClean) {
                    setChunkStat(i, 'pending');
                    return { paused: true };
                }
                if (S._cleanSkippedChunks.has(i)) {
                    S._cleanSkippedChunks.delete(i);
                    setChunkStat(i, 'error');
                    return { skipped: true, error: true };
                }
                console.warn(`[NI] 第 ${i + 1} 段第 ${attempt} 次失败:`, err);
                if (attempt === maxRetry) {
                    console.error(`[NI] 第 ${i + 1} 段已重试 ${maxRetry} 次，标记失败`);
                    setChunkStat(i, 'error');
                    niReportCleanFailure(i, err, attempt, maxRetry);
                    return { error: true };
                }
                niReportCleanFailure(i, err, attempt, maxRetry);
            } finally {
                if (S._cleanAbortControllers.get(i) === controller) S._cleanAbortControllers.delete(i);
            }
        }
        return { error: true };
    }
    
    async function niStartClean(options = {}) {
        if (!S.fileLoaded || S.cleanRunning || cleanStartPending) return;
        const restart = options.restart === true;
        cleanStartPending = true;
        try {
            // 后台会话存活时禁止另起新会话：否则两个会话并发写同一本小说的分段
            // 数据，必然互相污染。想重新/续跑，先暂停后台会话（写回落盘）或等它完成
            if (niIsCleanDetached()) {
                const sess = niGetCleanSessionInfo();
                const msg = `后台仍在清洗小说（已完成 ${sess?.done ?? '?'}/${sess?.total ?? '?'} 段）。`
                    + '请先暂停后台会话（清洗卡片下方的暂停按钮）或等它完成，再启动清洗。';
                if (toastr?.warning) toastr.warning(msg, '清洗'); else alert?.(msg);
                niSyncCleanButtonState();
                return;
            }
            if (restart) {
                const chunksBeforeConfirm = S.chunks;
                const confirmed = await confirmRestart(getCleanProgressStats(S));
                if (!confirmed || !S.fileLoaded || S.cleanRunning || S.chunks !== chunksBeforeConfirm) return;
                await niResetCleanRuntimeForRestart();
            } else {
                normalizeCleanArraysToChunks(S);
                const beforeStats = getCleanProgressStats(S);
                if (beforeStats.done > 0 && !niHasLoadedChunks()) {
                    const ok = await niEnsureChunksLoaded();
                    if (!ok || !niHasLoadedChunks()) {
                        // 已完成段的压缩正文在服务端缺失（历史快照损坏、写回失败时期
                        // 遗留等）。降级续跑：保留"已完成"标记，缺失正文处由
                        // niBuildCleanTask 自动改用前段原文末尾做衔接参考——只影响
                        // 参考质量，不影响结构与元数据。confirm 依赖缺失时保持旧行为。
                        const degraded = typeof confirm === 'function'
                            && (await confirm({ done: beforeStats.done }));
                        if (!degraded) {
                            alert('无法加载已完成段的压缩正文。请确认服务端数据文件存在，或左键重新清洗。');
                            niSyncCleanButtonState();
                            return;
                        }
                        logger?.warn?.(`[NI] 已完成 ${beforeStats.done} 段的压缩正文缺失，按降级模式续跑（衔接参考可能有缺口）。`);
                    }
                    normalizeCleanArraysToChunks(S);
                }
            }
            niBeginCleanSession();
            S.cleanRunning = true;
            if (failureToast) toastr?.clear?.(failureToast);
            failureToast = null;
            failureToastChunk = null;
        } finally {
            cleanStartPending = false;
        }

        const startedAt = now();
        // 自动续跑轮次上限：失败/被跳过的分段每轮都会被放回队列，不设上限时
        // 无人值守会整夜空烧 API 配额；到顶后停止并把剩余分段留给手动处理。
        const AUTO_RESUME_MAX_ROUNDS = 20;
        let round = 0;
        let pass = null;
        let everDetached = false;
        try {
            while (true) {
                // 只有首轮能带 restart：续跑必须保留已完成分段。
                pass = await niRunCleanPass({ restart: restart && round === 0, round });
                everDetached = everDetached || niIsCleanDetached();
                if (pass.paused) break;                                      // 用户点了暂停
                if (pass.total > 0 && pass.doneCount >= pass.total) break;   // 全部完成
                if (!niCleanAutoResumeEnabled()) break;                      // 开关未开，维持旧行为
                round++;
                if (round > AUTO_RESUME_MAX_ROUNDS) {
                    console.warn(`[NI] 自动续跑已达 ${AUTO_RESUME_MAX_ROUNDS} 轮上限，停止续跑（剩余失败分段需手动处理）`);
                    toastr?.warning?.(`自动续跑已达 ${AUTO_RESUME_MAX_ROUNDS} 轮上限，仍有分段未完成，已停止自动续跑。可在分段列表里手动重试或跳过。`);
                    break;
                }
                if (!await niCleanAutoResumeWait(niCleanAutoResumeDelay(round), round)) break;
            }
        } finally {
            // 先写回（含超时保护）再恢复空闲按钮：写回挂起时界面保持运行态，
            // 且绝不会无限冻结
            await niFinalizeCleanSession({ paused: !!(pass && pass.paused) });
            niFinishCleanSession();
        }

        // 开了自动续跑说明用户多半不在屏幕前，全部补齐后弹窗叫人；中途暂停不打扰。
        // 后台会话期间用户多半在另一本小说里游玩，完成提示已由 finalize 的 toast 承担。
        if (!everDetached && niCleanAutoResumeEnabled() && pass && !pass.paused && pass.total > 0 && pass.doneCount >= pass.total) {
            niShowCleanDoneModal({ total: pass.total, rounds: round, elapsedMs: now() - startedAt });
        }
    }

    function niCleanAutoResumeEnabled() {
        return getSettings()?.cleanAutoResume === true;
    }

    function niCleanAutoResumeDelay(round) {
        return Math.min(
            NI_CLEAN_AUTO_RESUME_MAX_DELAY_MS,
            NI_CLEAN_AUTO_RESUME_BASE_DELAY_MS * Math.max(1, round),
        );
    }

    // 轮间退避期间每 250ms 醒一次查暂停，保证「暂停」按钮在等待中依然即时生效。
    async function niCleanAutoResumeWait(ms, round) {
        const titleNote = q('#ni-cp-title-note');
        const deadline = now() + Math.max(0, ms);
        while (!S.stopClean) {
            const remain = deadline - now();
            if (remain <= 0) break;
            if (titleNote) titleNote.textContent = `第 ${round} 轮续跑将在 ${Math.ceil(remain / 1000)} 秒后开始…`;
            await new Promise(resolve => setTimeout(resolve, Math.min(250, remain)));
        }
        return !S.stopClean;
    }

    // 会话收尾：整个（可能多轮的）清洗结束后才恢复按钮。续跑等待期间必须保持
    // 运行态，否则暂停按钮会被提前隐藏，用户就没有中断出口了。
    function niFinishCleanSession() {
        const btn = q('#ni-btn-clean');
        const skipBtn  = q('#ni-btn-skip');
        const pauseBtn = q('#ni-btn-pause');
        if (btn) btn.style.display = '';
        if (skipBtn)  skipBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'none';
        S.cleanRunning = false;
        if (S.cleanDone && failureToast) {
            toastr?.clear?.(failureToast);
            failureToast = null;
            failureToastChunk = null;
        }
        niSyncCleanButtonState();
    }

    function niFormatCleanDuration(ms) {
        const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        if (hours > 0) return `${hours} 小时 ${minutes} 分 ${seconds} 秒`;
        if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
        return `${seconds} 秒`;
    }

    function niShowCleanDoneModal({ total, rounds, elapsedMs }) {
        const lines = [`全部 ${total} 段清洗压缩完成。`];
        if (rounds > 0) lines.push(`其中 ${rounds} 轮由自动续跑补齐。`);
        lines.push(`共耗时 ${niFormatCleanDuration(elapsedMs)}。`);
        const text = lines.join('\n');
        const modal = q('#ni-clean-done-modal');
        const content = q('#ni-clean-done-content');
        if (modal && content) {
            content.textContent = text;
            modal.style.display = 'flex';
        } else {
            alert(text);
        }
    }

    async function niRunCleanPass({ restart = false, round = 0 } = {}) {
        S.cleanRunning = true;
        S.stopClean = false;
        S.skipCurrentChunk = false;
        S._cleanSkipNext = false;
        S._cleanAbortControllers = new Map();
        S._cleanSkippedChunks = new Set();
    
        const btn = q('#ni-btn-clean');
        // 清洗中：隐藏主按钮，显示跳过/暂停
        if (btn) btn.style.display = 'none';
        q('#ni-btn-retry').style.display = 'none';
        const skipBtn  = q('#ni-btn-skip');
        const pauseBtn = q('#ni-btn-pause');
        if (skipBtn)  skipBtn.style.display = 'inline-flex';
        if (pauseBtn) { pauseBtn.style.display = 'inline-flex'; pauseBtn.disabled = false; }
    
        // 标题行进度条
        const titleProg = q('#ni-cp-title-prog');
        const titleBar  = q('#ni-cp-title-bar');
        const titleNote = q('#ni-cp-title-note');
        const cpCard    = q('#ni-cp-card');
        if (titleProg) titleProg.style.display = 'flex';
        if (cpCard) cpCard.classList.add('ni-has-prog');
    
        const roundLabel = round > 0 ? `第 ${round} 轮续跑 · ` : '';
        // 后台会话时进度文案带前缀，表明清洗的是另一本小说。
        // 必须每次实时判断：本轮跑到一半才切换时，前缀仍要出现
        const bgLabel = () => niIsCleanDetached() ? '后台清洗中 · ' : '';
        // 上一轮标记 error 的分段要放回队列，否则进度提示会一直把它们算作永久失败。
        if (round > 0) {
            CS.chunkStatus = CS.chunkStatus.map(status => status === 'error' ? 'pending' : status);
            if (CS === S) renderChunkList();
        }

        // 并发请求只写各自分段结果，结束后按 chunkIndex 统一重建结构化数据。
        const isResume = !restart && CS.chunkStatus.some(s => s === 'done');
        const plotOrderMemory = isResume ? capturePlotCheckpointMemory(CS) : null;
        const characterMemory = isResume ? captureCharacterMemory(CS) : null;
        if (!isResume) {
            CS.chunkMeta = [];
        }
        const pendingIndices = CS.chunks.map((_, i) => i).filter(i => CS.chunkStatus[i] !== 'done');
        const workerCount = Math.min(niCleanConcurrencyLimit(), Math.max(1, pendingIndices.length));
        let next = 0;
        const countDoneError = () => {
            let done = 0, err = 0;
            for (const status of CS.chunkStatus) {
                if (status === 'done') done++;
                else if (status === 'error') err++;
            }
            return { done, err };
        };
        const { done: initialDone } = countDoneError();
        let completed = initialDone;
        const formatProgress = () => {
            const { done, err } = countDoneError();
            const errSuffix = err > 0 ? ` · ${err} 失败` : '';
            return `${bgLabel()}${roundLabel}并发 ${workerCount} · 已完成 ${done}/${CS.chunks.length} 段${errSuffix}`;
        };
        if (titleNote) titleNote.textContent = formatProgress();

        await Promise.all(Array.from({ length: workerCount }, async () => {
            while (!S.stopClean) {
                const queueIndex = next++;
                if (queueIndex >= pendingIndices.length) break;
                const chunkIdx = pendingIndices[queueIndex];
                // 段间空档点下的「跳过」：直接跳过这一段，不发起请求
                if (S._cleanSkipNext) {
                    S._cleanSkipNext = false;
                    setChunkStat(chunkIdx, 'error');
                    completed++;
                    if (titleNote && !S.stopClean) titleNote.textContent = formatProgress();
                    continue;
                }
                await niProcessCleanChunk(chunkIdx, titleNote);
                completed++;
                if (titleNote && !S.stopClean) titleNote.textContent = formatProgress();
                if (titleBar) titleBar.style.width = `${Math.round((countDoneError().done / CS.chunks.length) * 92)}%`;
            }
        }));

        niRebuildStructuredDataFromChunks(plotOrderMemory, characterMemory);
        const hasError = CS.chunkStatus.some(status => status === 'error');

        const doneCount = CS.chunkStatus.filter(s => s === 'done').length;
        const errCount  = CS.chunkStatus.filter(s => s === 'error').length;
        const paused = !!S.stopClean;
        if (paused) {
            if (titleBar) titleBar.classList.remove('g');
            if (titleNote) {
                titleNote.textContent = `${bgLabel()}已暂停 · ${doneCount}/${CS.chunks.length} 段完成`;
                titleNote.classList.remove('g');
            }
        } else {
            if (titleBar) { titleBar.style.width = '100%'; titleBar.classList.add('g'); }
        }
        if (titleNote && !paused) {
            titleNote.textContent = hasError
                ? `${bgLabel()}${roundLabel}${doneCount} 段完成，${errCount} 段失败`
                : `${bgLabel()}全部 ${CS.chunks.length} 段完成`;
            titleNote.classList.toggle('g', !hasError);
        }

        CS.cleanDone = CS.chunkStatus.length > 0 && doneCount === CS.chunkStatus.length;
        S._cleanAbortControllers?.clear();
        S._cleanSkippedChunks?.clear();
        S._cleanSkipNext = false;

        // 每轮清洗停止后都形成可用检查点；旧节点/阶段保持，新完成分段追加到时间线。
        ['main', 'sub', 'pivot'].forEach(type => niSortPlotsByStoryOrder(CS.plots[type]));
        if (CS === S) {
            renderPlots();
            renderCharacters();
            buildStages();
        }
        setBtn('#ni-btn-vec', false);
        // 不再自动调用 AI 生成概括，用户可在角色/阶段页手动点击"AI 生成概括"

        niSaveSettings();
        // 后台会话：本轮结果属于另一本小说，写回它的快照而不是当前工作区设置
        if (niIsCleanDetached()) {
            await niWriteBackCleanSession(round > 0 ? `第 ${round} 轮续跑后` : '本轮清洗后');
        }
        return { paused, doneCount, errCount, hasError, total: CS.chunkStatus.length };
    }

    // 续跑未完成分段
    async function niRetryFailed() {
        await niHandleCleanButtonClick(false);
    }
    
    // ============================================================
    // 时间解析：将 time 字段转为可排序的数值
    // 支持格式："乾元十三年五月中旬" / "2012年3月" / "次日" / "某夜" 等
    // 无法解析的返回 null
    // ============================================================
    
    // 跳过当前正在处理的段
    function niSkipChunk() {
        if (!S.cleanRunning) return;
        const active = [...(S._cleanAbortControllers?.keys?.() || [])].sort((a, b) => a - b);
        const chunkIdx = active[0];
        if (chunkIdx != null) {
            // 有在飞请求：标记该段跳过并中止它
            S._cleanSkippedChunks?.add(chunkIdx);
            S._cleanAbortControllers.get(chunkIdx)?.abort();
        } else {
            // 空档：可能在段间，也可能该段正处于重试退避（控制器已随请求结束移除）。
            // 只置跳过标记，由分段处理函数/工作线程消费，落到正确的段上；
            // 绝不 abort 全局 _currentAbortController——那是所有小说 API 共用的槽位，
            // 会误杀偏差分析、人设更新等无关请求。
            S._cleanSkipNext = true;
        }
        const titleNote = q('#ni-cp-title-note');
        if (titleNote) titleNote.textContent = chunkIdx != null ? `正在跳过第 ${chunkIdx + 1} 段…` : '正在跳过下一段…';
    }
    
    // 单独清洗指定段（同样走会话：运行期间切换工作区可把它一并切到后台）
    async function niRunSingleChunk(i) {
        if (S.cleanRunning) { alert('清洗正在进行中，请等待完成或暂停后再试'); return; }
        // 后台会话存活时 cleanRunning 可能已被工作区加载冲掉（见文件内注释）：
        // 此时若另起单段清洗会覆盖会话句柄，旧会话进度不再写回、暂停按钮失效。
        if (niIsCleanDetached()) {
            alert('后台清洗会话仍在运行，请先暂停或等它完成后再做单段清洗。');
            return;
        }
        if (!S.fileLoaded || !S.chunks[i]) return;

        niBeginCleanSession();
        S.cleanRunning = true;
        S.stopClean = false;
        setChunkStat(i, 'running');

        const task = niBuildCleanTask(i);
        const messages = niBuildCleanMessages(i);
        const controller = new AbortControllerClass();
        S._cleanAbortControllers ??= new Map();
        S._cleanSkippedChunks ??= new Set();
        S._cleanAbortControllers.set(i, controller);
        let prepared = null;

        try {
            if (prepareCleanRequest) prepared = await prepareCleanRequest(task);
            const raw = prepared
                ? await callCleanTaskApi(prepared, { signal: controller.signal, attempt: 1, apiRole: 'clean' })
                : await callCleanApi(messages, { signal: controller.signal, apiRole: 'clean' });
            const { compressed, meta, error } = parseCleanResponse(raw, i, console.warn.bind(console));
            if (prepared) finishCleanRequest(prepared, { error });
            if (error) throw error;
            const plotOrderMemory = capturePlotCheckpointMemory(CS);
            const characterMemory = captureCharacterMemory(CS);
            CS.chunkResults[i] = compressed;
            CS.chunkMeta[i] = meta;  // 同步更新 chunkMeta

            // 从 plots/characters 中移除该段旧数据，再 merge 新数据
            ['main', 'sub', 'pivot'].forEach(type => {
                CS.plots[type] = (CS.plots[type] || []).filter(p => p._chunkIdx !== i);
            });
            CS.characters = CS.characters.filter(c => c._firstChunkIdx !== i);
            CS.characters.forEach(c => {
                if (Array.isArray(c.aliases)) c.aliases = c.aliases.filter(a => a._chunkIdx !== i);
            });

            mergeCharacters(CS, meta.characters || [], i);
            mergeCharacterAliases(CS, meta.character_aliases || meta.aliases || [], i);
            mergePlots(CS, meta.plots || [], i);
            restorePlotCheckpointMemory(CS, plotOrderMemory);
            restoreCharacterMemory(CS, characterMemory);

            // merge 后按 _chunkIdx 重新排序，确保节点插入正确位置
            ['main', 'sub', 'pivot'].forEach(type => {
                niSortPlotsByStoryOrder(CS.plots[type]);
            });

            setChunkStat(i, 'done');
            CS.cleanDone = CS.chunkStatus.length > 0 && CS.chunkStatus.every(status => status === 'done');
            if (CS === S) {
                renderPlots();
                renderCharacters();
                buildStages();
            }
            niSaveSettings();
        } catch(err) {
            if (prepared) finishCleanRequest(prepared, { error: err });
            console.error(`[NI] 第 ${i + 1} 段单独清洗失败:`, err);
            setChunkStat(i, S.stopClean ? 'pending' : 'error');
            if (!S.stopClean) niReportCleanFailure(i, err);
        } finally {
            if (S._cleanAbortControllers.get(i) === controller) S._cleanAbortControllers.delete(i);
            S._cleanSkippedChunks.delete(i);
            CS.cleanDone = CS.chunkStatus.length > 0 && CS.chunkStatus.every(status => status === 'done');
            const wasDetached = niIsCleanDetached();
            niFinishCleanSession();
            await niFinalizeCleanSession({ paused: wasDetached });
        }
    }
    
    // 暂停清洗
    function niPauseClean() {
        // 后台会话存活时 cleanRunning 可能已被工作区加载冲掉，但会话工人还在跑
        if (!S.cleanRunning && !niIsCleanDetached()) return;
        S.stopClean = true;
        S._cleanAbortControllers?.forEach(controller => controller.abort());
        // 只中止清洗自己登记的请求：原先直接 abort 全局单槽 _currentAbortController，
        // 该槽已被并行请求（偏差分析/人设更新）覆盖时会误杀无关调用。
        abortCleanRequestScopes?.();
        const btn = q('#ni-btn-pause');
        if (btn) btn.disabled = true;
        const titleNote = q('#ni-cp-title-note');
        if (titleNote) titleNote.textContent = '正在中止当前段，即将暂停…';
    }

    // ============================================================
    // 后台清洗会话（多小说工作区隔离·真并行）
    // 清洗开始时建立会话：CS 别名指向工作区 S，行为与旧版完全一致。
    // 切换工作区时 niDetachCleanForSwitch() 把会话切到私有数据副本（CS=会话），
    // 此后循环读写的分段数组、角色/剧情合并全部落在会话上，与工作区完全解绑，
    // 清洗在后台继续跑；每轮结束和会话结束时把进度写回该小说在小说库里的快照。
    // 控制信号（stopClean/跳过/暂停）留在共享的 S 上，前台暂停按钮对后台会话照常有效。
    // ============================================================
    let cleanSession = null;
    let CS = S;

    function niBeginCleanSession() {
        cleanSession = {
            detached: false,
            homeSnapshotIdx: -1,
            homeSnapshotKey: '',
            novelKey: S.novelKey,
            heavyFileKey: S.heavyFileKey,
            fileFingerprint: S.fileFingerprint,
            chunkKbUsed: S.chunkKbUsed,
            _charsPerByte: S._charsPerByte,
            chunks: S.chunks,
            chunkStatus: S.chunkStatus,
            chunkResults: S.chunkResults,
            chunkMeta: S.chunkMeta,
            characters: S.characters,
            plots: S.plots,
            worldCategories: S.worldCategories,
            styleGuide: S.styleGuide,
            stageMap: S.stageMap,
            stageMapN: S.stageMapN,
            chunkStageMap: S.chunkStageMap,
            stageStates: S.stageStates,
            stageSummaries: S.stageSummaries,
            stageTitles: S.stageTitles,
            cleanDone: S.cleanDone,
            vecDone: S.vecDone,
        };
        CS = S;
    }

    function niIsCleanDetached() {
        return !!(cleanSession && cleanSession.detached);
    }

    // 切换工作区前调用（幂等）：把活动清洗会话切到私有数据副本，之后循环在后台
    // 继续跑，与工作区 S 完全解绑。返回 true 表示存在（本次或之前切出的）后台会话。
    function niDetachCleanForSwitch() {
        if (!cleanSession || !S.cleanRunning) return false;
        if (cleanSession.detached) return true;
        cleanSession.detached = true;
        // 会话建立后、detach 前，工作区可能已重绑过某些数组（每轮开局非续跑时的
        // CS.chunkMeta = [] 就是重绑定），必须按当前引用重新捕获，否则本轮已写入的
        // 元数据会落在旧数组里被漏掉。结构化数据换会话私有数组，元素本体不克隆
        // （节点 ID 补齐等写入是期望行为；重建时会整体重绑，不再共享）。
        cleanSession.chunks = CS.chunks;
        cleanSession.chunkStatus = CS.chunkStatus;
        cleanSession.chunkResults = CS.chunkResults;
        cleanSession.chunkMeta = CS.chunkMeta;
        cleanSession.characters = [...(CS.characters || [])];
        cleanSession.plots = {
            main: [...(CS.plots?.main || [])],
            sub: [...(CS.plots?.sub || [])],
            pivot: [...(CS.plots?.pivot || [])],
        };
        cleanSession.worldCategories = CS.worldCategories;
        cleanSession.styleGuide = CS.styleGuide;
        cleanSession.stageMap = CS.stageMap;
        cleanSession.stageMapN = CS.stageMapN;
        cleanSession.chunkStageMap = CS.chunkStageMap;
        cleanSession.stageStates = CS.stageStates;
        cleanSession.stageSummaries = CS.stageSummaries;
        cleanSession.stageTitles = CS.stageTitles;
        cleanSession.cleanDone = CS.cleanDone;
        cleanSession.vecDone = CS.vecDone;
        CS = cleanSession;
        return true;
    }

    // 存储层在保护快照后登记写回目标（后台清洗的进度写回这本小说的快照）
    function niSetCleanSessionHome({ idx = -1, key = '' } = {}) {
        if (!cleanSession) return;
        // 写回目标只登记一次：会话与"把它切走的那次切换"所保护的小说一一对应。
        // 之后加载/上传其他小说时 protect 的是别的快照，绝不能让它们覆盖这里。
        if (cleanSession.homeSnapshotIdx >= 0 || cleanSession.homeSnapshotKey) return;
        cleanSession.homeSnapshotIdx = idx;
        cleanSession.homeSnapshotKey = key;
    }

    // 写回解析失败时按文件指纹认领快照用：返回会话识别信息（无会话返回 null）
    function niGetCleanSessionInfo() {
        if (!cleanSession) return null;
        return {
            detached: cleanSession.detached,
            novelKey: cleanSession.novelKey,
            fileFingerprint: cleanSession.fileFingerprint,
            chunkKbUsed: cleanSession.chunkKbUsed,
            hasHome: cleanSession.homeSnapshotIdx >= 0 || !!cleanSession.homeSnapshotKey,
            homeSnapshotIdx: cleanSession.homeSnapshotIdx,
            homeSnapshotKey: cleanSession.homeSnapshotKey,
            done: (cleanSession.chunkStatus || []).filter(s => s === 'done').length,
            total: (cleanSession.chunks || []).length,
        };
    }

    // 指纹认领用：无条件登记写回目标（越过"只登记一次"守卫）。
    // 仅允许 niWriteBackCleanSnapshot 在解析失败、且指纹核实通过后调用；
    // 切换路径仍走 niSetCleanSessionHome。
    function niForceCleanSessionHome({ idx = -1, key = '' } = {}) {
        if (!cleanSession) return;
        cleanSession.homeSnapshotIdx = idx;
        cleanSession.homeSnapshotKey = key;
    }

    // 写回防挂死：服务端上传/IndexedDB 任一步骤挂起都会把清洗收尾整体冻结
    // （界面卡在运行态、暂停失效、进度看似丢失）。超时按失败处理并落日志。
    const NI_WRITEBACK_TIMEOUT_MS = 180000;
    function niWithTimeout(promise, ms, label = '操作') {
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒）`)), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    async function niWriteBackCleanSession(reason = '') {
        const sess = cleanSession;
        if (!sess || !sess.detached) return false;
        if (sess.homeSnapshotIdx < 0 && !sess.homeSnapshotKey) return false;
        const ok = await niWithTimeout(
            niWriteBackCleanSnapshot({
                snapIdx: sess.homeSnapshotIdx,
                key: sess.homeSnapshotKey,
                data: sess,
            }),
            NI_WRITEBACK_TIMEOUT_MS,
            '写回快照',
        ).catch(e => {
            console.error(`[NI] 后台清洗进度写回快照（${reason || '本轮'}）异常:`, e);
            return false;
        });
        console.info(`[NI] 后台清洗进度写回快照${reason ? `（${reason}）` : ''}:`, ok ? '成功' : '失败');
        return ok;
    }

    async function niFinalizeCleanSession({ paused = false } = {}) {
        const sess = cleanSession;
        cleanSession = null;
        CS = S;
        if (!sess?.detached) return;
        const titleNote = q('#ni-cp-title-note');
        if (titleNote) titleNote.textContent = '正在写回快照…';
        const ok = await niWithTimeout(
            niWriteBackCleanSnapshot({
                snapIdx: sess.homeSnapshotIdx,
                key: sess.homeSnapshotKey,
                data: sess,
            }),
            NI_WRITEBACK_TIMEOUT_MS,
            '写回快照',
        ).catch(e => {
            console.error('[NI] 后台清洗收尾写回异常:', e);
            return false;
        });
        if (toastr?.[ok ? 'success' : 'warning']) {
            toastr[ok ? 'success' : 'warning'](
                ok
                    ? (paused
                        ? '后台清洗已暂停，进度已写回小说库快照；切回该小说后可点「续跑清洗」继续。'
                        : '后台清洗已结束，进度已写回小说库快照；加载该小说即可向量化/游玩。')
                    : '后台清洗已结束，但进度写回快照失败（详见控制台），切回该小说后可「续跑清洗」补齐。',
                '后台清洗',
            );
        }
    }
    
    function setBtn(sel, disabled, html) {
        const el = q(sel);
        if (!el) return;
        el.disabled = disabled;
        if (html !== undefined) el.innerHTML = html;
    }
    
    function niSyncCleanProgressHint(stats = getCleanProgressStats(S)) {
        if (S.cleanRunning) return;
        // 后台会话仍存活（如加载快照后运行标记被冲掉的状态）：标题不能渲染成
        // "空闲"，否则用户会以为清洗已结束而重复启动
        if (niIsCleanDetached()) {
            const sess = niGetCleanSessionInfo() || {};
            const titleProg = q('#ni-cp-title-prog');
            const titleBar  = q('#ni-cp-title-bar');
            const titleNote = q('#ni-cp-title-note');
            const cpCard    = q('#ni-cp-card');
            if (!titleProg || !titleBar || !titleNote) return;
            titleProg.style.display = 'flex';
            cpCard?.classList.add('ni-has-prog');
            titleNote.classList.remove('g');
            titleNote.textContent = `后台清洗中 · 已完成 ${sess.done ?? '?'}/${sess.total ?? '?'} 段（下方可暂停）`;
            return;
        }
        const titleProg = q('#ni-cp-title-prog');
        const titleBar  = q('#ni-cp-title-bar');
        const titleNote = q('#ni-cp-title-note');
        const cpCard    = q('#ni-cp-card');
        if (!titleProg || !titleBar || !titleNote) return;
    
        titleNote.classList.remove('g');
        titleBar.classList.remove('g');
        if (stats.isPartial) {
            const failedText = stats.error ? `，${stats.error} 段失败` : '';
            titleProg.style.display = 'flex';
            cpCard?.classList.add('ni-has-prog');
            titleNote.textContent = `已完成 ${stats.done}/${stats.total} 段${failedText}，左边重新，右边续跑`;
            titleBar.style.width = `${Math.round((stats.done / stats.total) * 100)}%`;
        } else if (stats.isComplete) {
            titleProg.style.display = 'flex';
            cpCard?.classList.add('ni-has-prog');
            titleNote.textContent = `已完成 ${stats.total}/${stats.total} 段`;
            titleNote.classList.add('g');
            titleBar.style.width = '100%';
            titleBar.classList.add('g');
        } else {
            titleProg.style.display = 'none';
            cpCard?.classList.remove('ni-has-prog');
            titleNote.textContent = '';
            titleBar.style.width = '0%';
        }
    }
    
    function niSyncCleanButtonState() {
        const btn = q('#ni-btn-clean');
        const resumeBtn = q('#ni-btn-retry');
        if (!btn) return;
        // 后台会话存活：按"运行中"呈现——重新/续跑禁用，暂停/跳过可用，
        // 避免"看不到暂停按钮、又无法续跑"的死局
        if (niIsCleanDetached()) {
            const sess = niGetCleanSessionInfo() || {};
            setBtn('#ni-btn-clean', true, '<i class="ti ti-refresh"></i>重新清洗');
            btn.title = `后台清洗中（已完成 ${sess.done ?? '?'}/${sess.total ?? '?'} 段），暂停后才能重新清洗`;
            btn.dataset.niPartialClean = '0';
            if (resumeBtn) resumeBtn.style.display = 'none';
            const skipBtn = q('#ni-btn-skip');
            if (skipBtn) skipBtn.style.display = 'inline-flex';
            const pauseBtn = q('#ni-btn-pause');
            if (pauseBtn) { pauseBtn.style.display = 'inline-flex'; pauseBtn.disabled = !!S.stopClean; }
            niSyncCleanProgressHint();
            return;
        }
        const stats = getCleanProgressStats(S);
        const disabled = !S.fileLoaded || S.cleanRunning || stats.total === 0;
    
        if (stats.isPartial) {
            setBtn('#ni-btn-clean', disabled, '<i class="ti ti-refresh"></i>重新清洗');
            btn.title = `已完成 ${stats.done}/${stats.total} 段。左侧按钮重新清洗；右侧按钮续跑清洗。`;
            btn.dataset.niPartialClean = '1';
            if (resumeBtn) {
                resumeBtn.style.display = S.cleanRunning ? 'none' : 'inline-flex';
                resumeBtn.title = `从当前进度继续清洗，已完成段会自动跳过。`;
                setBtn('#ni-btn-retry', disabled, '<i class="ti ti-player-play"></i>续跑清洗');
            }
        } else if (stats.isComplete) {
            setBtn('#ni-btn-clean', disabled, '<i class="ti ti-check"></i>清洗完成');
            btn.title = `已完成 ${stats.total}/${stats.total} 段。`;
            btn.dataset.niPartialClean = '0';
            if (resumeBtn) resumeBtn.style.display = 'none';
        } else {
            setBtn('#ni-btn-clean', disabled, '<i class="ti ti-player-play"></i>开始全自动清洗');
            btn.title = '开始清洗当前小说';
            btn.dataset.niPartialClean = '0';
            if (resumeBtn) resumeBtn.style.display = 'none';
        }
        niSyncCleanProgressHint(stats);
    }
    
    async function niResetCleanRuntimeForRestart() {
        normalizeCleanArraysToChunks(S);
        niResetChunkDerivedState();
        if (S.novelKey) {
            try { await dbClearNovel(S.novelKey); }
            catch (e) { console.warn('[NI] 重新清洗前清理旧向量失败:', e); }
        }
        renderChunkList();
        renderPlots();
        renderCharacters();
        buildStages();
        setBtn('#ni-btn-vec', true, '<i class="ti ti-database"></i>开始向量化');
    }
    
    async function niHandleCleanButtonClick(restartOnPartial = true) {
        if (hasPartialCleanProgress(S) && restartOnPartial) {
            await niStartClean({ restart: true });
            return;
        }
        await niStartClean({ restart: false });
    }
    
    // ============================================================
    // 初始化入口
    // ============================================================
    
    // ============================================================
    // 拉取模型列表

    return {
        niOnDrop, niOnFile, niApplyFile, getCfgKb, niOnKbChange,
        renderChunkList, chunkStatStyle, setChunkStat,
        niCleanConcurrencyLimit, niBuildCleanTask, niBuildCleanMessages, niRebuildStructuredDataFromChunks,
        niProcessCleanChunk, niStartClean, niRunCleanPass, niRetryFailed, niSkipChunk, niRunSingleChunk, niPauseClean,
        niDetachCleanForSwitch, niSetCleanSessionHome, niIsCleanDetached,
        niGetCleanSessionInfo, niForceCleanSessionHome,
        niCleanAutoResumeEnabled, niCleanAutoResumeDelay, niFinishCleanSession, niShowCleanDoneModal,
        setBtn, niSyncCleanProgressHint, niSyncCleanButtonState,
        niResetCleanRuntimeForRestart, niHandleCleanButtonClick,
    };
}
