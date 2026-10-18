export function niNovelNameFromFileName(fileName = '') {
    return String(fileName || '')
        .trim()
        .replace(/\.[^.]+$/u, '')
        .trim() || '未命名小说';
}

export function niFindCurrentNovelIndex(library = [], novelKey = '') {
    if (!novelKey) return -1;
    return (Array.isArray(library) ? library : []).findIndex(snap => snap?.data?._novelKey === novelKey);
}

export function createAutosaveController({
    state,
    getSettings,
    saveSettingsDebounced,
    saveNovelSnapshot,
    updateNovelSnapshot,
    renderNovelLibrary = () => {},
    delay = 1200,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = timerId => clearTimeout(timerId),
    logger = console,
} = {}) {
    let timer = null;
    let saving = false;
    let savingPromise = null;
    let rerunRequested = false;
    let rerunNovelKey = '';

    function isEnabled() {
        return getSettings()?.autoSaveEnabled === true;
    }

    function setSourceFileName(fileName = '') {
        const cfg = getSettings();
        if (!cfg) return;
        cfg._autoSaveSourceName = niNovelNameFromFileName(fileName);
        saveSettingsDebounced();
    }

    async function saveNow() {
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
        if (!isEnabled()) {
            rerunRequested = false;
            return false;
        }
        if (saving) {
            rerunRequested = true;
            rerunNovelKey = String(state?.novelKey || '');
            return false;
        }

        saving = true;
        const run = (async () => {
            const cfg = getSettings() || {};
            const idx = niFindCurrentNovelIndex(cfg.novelLibrary, state?.novelKey);
            if (idx < 0 && !state?.fileLoaded) return false;
            try {
                let saved;
                if (idx >= 0) {
                    saved = await updateNovelSnapshot(idx, {
                        confirmUpdate: false,
                        notify: false,
                        throwOnError: true,
                        scheduleAutosave: false,
                    });
                } else {
                    saved = await saveNovelSnapshot(cfg._autoSaveSourceName || '未命名小说', {
                        notifyErrors: false,
                        throwOnError: true,
                        scheduleAutosave: false,
                    });
                }
                if (saved === false) return false;
                renderNovelLibrary();
                return true;
            } catch (e) {
                logger.warn('[NI] 自动保存失败:', e);
                return false;
            }
        })();
        savingPromise = run;
        try {
            return await run;
        } finally {
            saving = false;
            if (savingPromise === run) savingPromise = null;
            if (rerunRequested) {
                const expectedNovelKey = rerunNovelKey;
                rerunRequested = false;
                rerunNovelKey = '';
                if (isEnabled() && String(state?.novelKey || '') === expectedNovelKey) void saveNow();
            }
        }
    }

    /**
     * 切换小说前把待保存数据落盘：清掉防抖计时器、等待进行中的保存完成、再补一次保存。
     * 不做这一步的话，切换会把当前工作区换掉，防抖/重跑里的编辑就随内存一起丢了。
     * 自动保存关闭时返回 false，不改变既有行为。
     */
    async function flush() {
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
        if (savingPromise) {
            try { await savingPromise; } catch (_) { /* 保存失败由 saveNow 记录 */ }
        }
        if (!isEnabled()) return false;
        return saveNow();
    }

    function schedule({ immediate = false } = {}) {
        if (!isEnabled()) return;
        if (saving) {
            rerunRequested = true;
            rerunNovelKey = String(state?.novelKey || '');
            return;
        }
        if (timer) clearTimer(timer);
        if (immediate) {
            void saveNow();
            return;
        }
        const scheduledNovelKey = String(state?.novelKey || '');
        timer = setTimer(() => {
            timer = null;
            if (String(state?.novelKey || '') !== scheduledNovelKey) {
                // 切换小说时本应先 flush();走到这里说明有切换路径没等保存落盘。
                // 不能在这里保存（state 已是新小说），至少留下可诊断的日志。
                logger.warn('[NI] 自动保存：防抖等待期间已切换小说，本次待保存编辑随工作区切换丢失');
                return;
            }
            void saveNow();
        }, delay);
    }

    function setEnabled(enabled) {
        const cfg = getSettings();
        if (!cfg) return;
        cfg.autoSaveEnabled = !!enabled;
        saveSettingsDebounced();
        if (enabled) schedule({ immediate: true });
        else {
            rerunRequested = false;
            rerunNovelKey = '';
            if (timer) {
                clearTimer(timer);
                timer = null;
            }
        }
    }

    return { isEnabled, setEnabled, setSourceFileName, schedule, saveNow, flush };
}
