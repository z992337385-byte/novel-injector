// 小说清洗的请求组装与会话内诊断。提示词来源统一遵循全局设置。
export const NI_CLEAN_DIAGNOSTIC_LIMIT = 10;
export const NI_CLEAN_RESPONSE_PREVIEW_LIMIT = 24000;

export function niBuildCleanDataMessage(task) {
    const reference = task.previousContext
        ? `【${task.previousLabel || '前段参考'}（仅供衔接参考，不要重复压缩）】\n${task.previousContext}\n\n` : '';
    return { role: 'user', content: `${reference}【本段原文】\n${task.sourceText}` };
}

export function createCleanRequestTools({
    getSettings, defaultSettings = {}, boundaryPrompt = '', executionPrompt = '',
    buildTavernCleanMessages, applyGlobalPromptsToMessages, sendPreparedRequest,
    now = () => Date.now(), diagnosticLimit = NI_CLEAN_DIAGNOSTIC_LIMIT,
} = {}) {
    const transportSettings = new WeakMap();
    const records = [];
    const listeners = new Set();
    let serial = 0;
    const notify = () => {
        for (const listener of listeners) {
            try { listener(); } catch (error) { console.warn('[NI] 清洗诊断显示失败:', error); }
        }
    };
    const redact = (value, cfg) => {
        let text = String(value ?? '');
        if (cfg?.cleanKey) text = text.split(String(cfg.cleanKey)).join('[已隐藏 Key]');
        return text.replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
            .replace(/\bsk-[\w-]{8,}/g, '[已隐藏 Key]');
    };

    async function prepareCleanRequest(task) {
        if (!task || typeof task.sourceText !== 'string' || !task.sourceText.length) {
            throw new Error('本段原文尚未加载，请先上传对应小说，再预览或清洗。');
        }
        const settings = { ...defaultSettings, ...getSettings?.() };
        const rule = { role: 'system', content: [String(task.instructions || '').trim(), boundaryPrompt].filter(Boolean).join('\n\n') };
        const history = [niBuildCleanDataMessage(task), { role: 'user', content: executionPrompt }];
        let result = {
            messages: [rule, ...history], origins: ['清洗规则与资料边界', '小说资料', '清洗执行指令'], notes: [],
        };
        let promptLabel = settings.globalPromptSource === 'none' ? '不使用全局提示词' : '内置全局提示词';
        if (settings.globalPromptSource === 'tavern') {
            result = await buildTavernCleanMessages(rule, history, settings);
            promptLabel = `酒馆预设：${result.presetName || '前台当前预设'}`;
        } else {
            const messages = applyGlobalPromptsToMessages(result.messages, settings, { mergeSystemHead: false });
            result = { messages, origins: messages.map(message => {
                const match = result.messages.findIndex(original => original.role === message.role && original.content === message.content);
                return match >= 0 ? result.origins[match] : '内置全局提示词';
            }), notes: [] };
        }
        // 清洗专用 API 覆盖：开启且端点/Key 齐全时，清洗请求（且仅清洗请求）
        // 走这套独立凭据；游玩时的偏差分析/人设/归档仍用主配置。
        const api2Url = settings.cleanApi2Enabled ? String(settings.cleanApi2Url || '').trim() : '';
        const api2Key = settings.cleanApi2Enabled ? String(settings.cleanApi2Key || '').trim() : '';
        const api2Active = !!api2Url && !!api2Key;
        const cfg = {
            cleanModel: (api2Active && String(settings.cleanApi2Model || '').trim())
                ? String(settings.cleanApi2Model).trim()
                : settings.cleanModel ?? defaultSettings.cleanModel,
            cleanUrl: api2Active ? api2Url : settings.cleanUrl ?? defaultSettings.cleanUrl,
            cleanKey: api2Active ? api2Key : settings.cleanKey ?? defaultSettings.cleanKey,
            cleanStream: settings.cleanStream ?? defaultSettings.cleanStream ?? false,
            apiTimeoutMin: settings.apiTimeoutMin ?? defaultSettings.apiTimeoutMin ?? 15,
            // 标记清洗凭据是否已隔离到专用 API：调用方据此决定是否走独立限速/并发通道，
            // 未隔离时刻意与主通道共用计量，避免同一凭据被双倍限速/并发。
            _cleanLaneIsolated: api2Active,
        };
        const prepared = Object.freeze({
            chunkIndex: task.chunkIndex, novelKey: task.novelKey || '', promptLabel,
            sourceCharacters: task.sourceText.length,
            referenceCharacters: String(task.previousContext || '').length,
            model: cfg.cleanModel, stream: cfg.cleanStream, maxTokens: 32000, temperature: 0.3,
            messages: Object.freeze(result.messages.map(message => Object.freeze({ role: message.role, content: message.content }))),
            origins: Object.freeze([...result.origins]), notes: Object.freeze([...result.notes]),
        });
        transportSettings.set(prepared, cfg);
        return prepared;
    }

    function setResponse(record, value, cfg) {
        const text = redact(value, cfg);
        record.response = text.slice(0, NI_CLEAN_RESPONSE_PREVIEW_LIMIT);
        record.responseTruncated = text.length > NI_CLEAN_RESPONSE_PREVIEW_LIMIT;
    }

    async function callCleanTaskApi(prepared, { signal = null, attempt = 1, apiRole = null } = {}) {
        const cfg = transportSettings.get(prepared);
        if (!cfg) throw new Error('清洗请求尚未组装，请重新开始此段。');
        const record = {
            id: String(++serial), request: prepared, attempt, status: 'queued',
            startedAt: now(), sentAt: null, finishedAt: null, response: '',
            errorCode: '', errorMessage: '', responseTruncated: false,
        };
        records.unshift(record);
        records.splice(Math.max(1, diagnosticLimit));
        notify();
        try {
            const raw = await sendPreparedRequest(prepared.messages, {
                signal, prepared: true, requestSettings: cfg, apiRole,
                onRequestSent: () => { record.status = 'running'; record.sentAt = now(); notify(); },
            });
            setResponse(record, raw, cfg);
            record.status = 'received';
            record.finishedAt = now();
            notify();
            return raw;
        } catch (error) {
            record.status = error?.code === 'NI_API_ABORTED' || signal?.aborted ? 'cancelled' : 'error';
            record.errorCode = String(error?.code || '');
            record.errorMessage = redact(error?.message || error, cfg);
            setResponse(record, error?.responseText, cfg);
            record.finishedAt = now();
            notify();
            throw error;
        }
    }

    function finishCleanRequest(prepared, { attempt = 1, error = null } = {}) {
        const record = records.find(item => item.request === prepared && item.attempt === attempt);
        if (!record) return;
        if (!error) record.status = 'done';
        else if (record.status !== 'cancelled') {
            record.status = 'error';
            record.errorCode = String(error.code || '');
            record.errorMessage = redact(error.message || error, transportSettings.get(prepared));
        }
        record.finishedAt = now();
        notify();
    }

    return {
        prepareCleanRequest, callCleanTaskApi, finishCleanRequest,
        getDiagnostics: novelKey => records.filter(record => novelKey === undefined || record.request.novelKey === novelKey)
            .map(record => ({ ...record })),
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    };
}

export function createCleanRequestView({ q, escapeHtml, requests, getTask, getNovelKey } = {}) {
    let preview = null;
    let previewError = null;
    let previewSerial = 0;
    let initialized = false;
    const labels = {
        preview: '预览，尚未发送', queued: '排队中', running: '请求中', received: '已接收，校验中',
        done: '完成', error: '失败', cancelled: '已取消',
    };

    function invalidatePreview() {
        previewSerial++;
        preview = null;
        previewError = null;
        render();
    }

    function render() {
        const select = q('#ni-clean-diagnostic-record');
        const panel = q('#ni-clean-diagnostics');
        if (!select || !panel) return;
        const novelKey = getNovelKey?.() || '';
        if (preview?.request.novelKey !== novelKey) preview = null;
        if (previewError?.novelKey !== novelKey) previewError = null;
        const records = requests.getDiagnostics(novelKey);
        const current = select.value;
        const available = preview ? [preview, ...records] : records;
        select.innerHTML = available.length ? available.map(record => `<option value="${escapeHtml(record.id)}">`
            + `第 ${record.request.chunkIndex + 1} 段 · ${record.id === 'preview' ? '预览' : `第 ${record.attempt} 次 · ${labels[record.status]}`}`
            + '</option>').join('') : '<option value="">暂无请求记录</option>';
        select.value = available.some(record => record.id === current) ? current : (available[0]?.id || '');
        if (!panel.open) return;
        const record = available.find(item => item.id === select.value);
        const status = q('#ni-clean-diagnostic-status');
        const content = q('#ni-clean-diagnostic-content');
        if (!status || !content) return;
        if (previewError) {
            status.textContent = previewError.message;
            content.innerHTML = '';
            return;
        }
        if (!record) {
            status.textContent = '输入分段号可预览请求。实际发送及失败响应仅保留在本次页面会话中，最多 10 条。';
            content.innerHTML = '';
            return;
        }
        const request = record.request;
        status.textContent = `${labels[record.status]} · ${request.promptLabel} · ${request.model || '未设置模型'}`
            + ` · 原文 ${request.sourceCharacters} 字符 · 前段参考 ${request.referenceCharacters} 字符`
            + ` · ${request.messages.length} 条消息 · 输出上限 ${request.maxTokens} Token`
            + (record.id === 'preview' ? '。实际发送内容以请求记录为准。' : '');
        const notes = request.notes.map(note => `<p class="ni-clean-diagnostic-note">${escapeHtml(note)}</p>`).join('');
        const error = record.errorMessage ? `<p class="ni-clean-diagnostic-error">${escapeHtml(record.errorCode)}：${escapeHtml(record.errorMessage)}</p>` : '';
        const messages = request.messages.map((message, index) => `<details class="ni-clean-message">`
            + `<summary>${index + 1} · ${message.role} · ${escapeHtml(request.origins[index] || '提示词')} · ${message.content.length} 字符</summary>`
            + `<pre>${escapeHtml(message.content)}</pre></details>`).join('');
        const response = record.response ? `<details class="ni-clean-message"${record.status === 'error' ? ' open' : ''}>`
            + `<summary>${record.status === 'error' ? '失败响应' : '模型响应'}${record.responseTruncated ? '（仅展示前 24000 字符）' : ''}</summary>`
            + `<pre>${escapeHtml(record.response)}</pre></details>` : '';
        // 状态流转（queued→running→received）会频繁触发 render：重建前记录各 details 的
        // 展开状态，重建后按位置还原，否则用户在长请求期间几乎无法翻阅内容。
        const openStates = [...content.querySelectorAll('details')].map(detail => detail.open);
        content.innerHTML = notes + error + messages + response;
        [...content.querySelectorAll('details')].forEach((detail, index) => {
            if (openStates[index]) detail.open = true;
        });
    }

    async function showPreview(chunkIndex = null) {
        const panel = q('#ni-clean-diagnostics');
        const input = q('#ni-clean-diagnostic-chunk');
        if (!panel || !input) return;
        const serial = ++previewSerial;
        const novelKey = getNovelKey?.() || '';
        previewError = null;
        if (chunkIndex !== null) input.value = String(chunkIndex + 1);
        panel.open = true;
        try {
            const index = Number(input.value) - 1;
            if (!Number.isInteger(index) || index < 0) throw new Error('请输入有效分段号。');
            const request = await requests.prepareCleanRequest(getTask(index));
            if (serial !== previewSerial || novelKey !== (getNovelKey?.() || '')) return;
            preview = { id: 'preview', request, status: 'preview', response: '', errorMessage: '' };
            render();
            const select = q('#ni-clean-diagnostic-record');
            if (select) select.value = 'preview';
            render();
        } catch (error) {
            if (serial !== previewSerial || novelKey !== (getNovelKey?.() || '')) return;
            preview = null;
            previewError = { novelKey, message: String(error?.message || error) };
            render();
        }
    }

    function initialize() {
        if (initialized || !q('#ni-clean-diagnostics')) return;
        initialized = true;
        q('#ni-clean-diagnostics').addEventListener('toggle', render);
        q('#ni-clean-diagnostic-record')?.addEventListener('change', () => {
            previewError = null;
            render();
        });
        q('#ni-clean-preview')?.addEventListener('click', () => showPreview());
        requests.subscribe(render);
        render();
    }
    return { initialize, invalidatePreview, render, showPreview };
}
