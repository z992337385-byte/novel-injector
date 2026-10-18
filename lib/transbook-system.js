// 穿书模式状态、节点边界与阶段锁定。

import { niNormalizeFutureInjectOptions } from './injection-system.js';

export const NI_TRANSBOOK_TYPE_LABELS = Object.freeze({
    main: '主线',
    sub: '支线',
    pivot: '关键转折',
});

export function niNormalizeTransbookFrontierStage(value) {
    return Math.max(1, parseInt(value, 10) || 1);
}

export function niAdvanceTransbookFrontier(frontierStageIdx, stageIdx) {
    const current = niNormalizeTransbookFrontierStage(frontierStageIdx);
    const next = parseInt(stageIdx, 10);
    if (!Number.isFinite(next) || next <= 0) return current;
    return Math.max(current, next);
}

export function niNormalizeTransbookSavedState(saved) {
    return {
        nodeDone: saved?.nodeDone ? { ...saved.nodeDone } : {},
        curIdx: saved?.curIdx ?? 0,
        curNodeId: saved?.curNodeId || '',
        frontierStageIdx: niNormalizeTransbookFrontierStage(saved?.frontierStageIdx),
        paused: !!saved?.paused,
    };
}

export function niResolveTransbookNodeStageIdx(plot, resolveStageIdx = null) {
    const normalize = value => {
        const stageIdx = parseInt(value, 10);
        return Number.isFinite(stageIdx) && stageIdx > 0 ? stageIdx : null;
    };
    const direct = normalize(plot?.stageIdx) ?? normalize(plot?._plotRef?.stageIdx);
    if (direct != null) return direct;
    if (typeof resolveStageIdx !== 'function') return 0;
    return normalize(resolveStageIdx(plot)) ?? 0;
}

export function niNormalizeTransbookNode(plot, nodeDone = {}, {
    typeLabels = NI_TRANSBOOK_TYPE_LABELS,
    resolveNodeId = (_plot, type, sourceIndex) => `${type}_${sourceIndex}`,
    resolveStageIdx = null,
} = {}) {
    const type = plot?._type || plot?.type || 'main';
    const sourceIndex = plot?._sourceIdx ?? plot?._originalIdx ?? 0;
    const legacyId = `${type}_${sourceIndex}`;
    const id = resolveNodeId(plot?._plotRef || plot, type, plot?._sourceIdx ?? 0);
    const done = nodeDone?.[id] !== undefined ? !!nodeDone[id] : !!nodeDone?.[legacyId];
    return {
        id,
        legacyId,
        type,
        typeLabel: typeLabels[type] || type,
        title: plot?.title || '（未命名）',
        body: plot?.body || '',
        time: plot?.time || '',
        location: plot?.location || '',
        sub_notes: plot?.sub_notes || [],
        branch_links: plot?.branch_links || [],
        stageIdx: niResolveTransbookNodeStageIdx(plot, resolveStageIdx),
        done,
        locked: false,
        _origIdx: sourceIndex,
        _chunkIdx: plot?._chunkIdx ?? 0,
        _chunkOrder: plot?._chunkOrder ?? 0,
        _manualOrder: plot?._manualOrder,
    };
}

export function niGetTransbookStageCompletion(nodes) {
    const stageHasUndone = {};
    for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node?.done) stageHasUndone[node?.stageIdx] = true;
    }
    return stageHasUndone;
}

export function niIsTransbookStageLocked(stageIdx, stageHasUndone, frontierStageIdx) {
    if (!Number.isFinite(Number(stageIdx))) return false;
    const frontier = niNormalizeTransbookFrontierStage(frontierStageIdx);
    if (stageIdx <= frontier) return false;
    for (let index = frontier; index < stageIdx; index++) {
        if (stageHasUndone?.[index]) return true;
    }
    return false;
}

export function niApplyTransbookStageLocks(nodes, frontierStageIdx) {
    const list = (Array.isArray(nodes) ? nodes : []).map(node => ({ ...node, locked: false }));
    const stageHasUndone = niGetTransbookStageCompletion(list);
    for (const node of list) {
        node.locked = niIsTransbookStageLocked(node.stageIdx, stageHasUndone, frontierStageIdx);
    }
    return list;
}

export function niBuildTransbookNodes(plots, nodeDone = {}, {
    typeLabels = NI_TRANSBOOK_TYPE_LABELS,
    resolveNodeId,
    resolveStageIdx = null,
    comparePlotOrder = () => 0,
    frontierStageIdx = 1,
} = {}) {
    const nodes = (Array.isArray(plots) ? plots : [])
        .map(plot => niNormalizeTransbookNode(plot, nodeDone, { typeLabels, resolveNodeId, resolveStageIdx }))
        .sort((a, b) => a.stageIdx !== b.stageIdx ? a.stageIdx - b.stageIdx : comparePlotOrder(a, b));
    return niApplyTransbookStageLocks(nodes, frontierStageIdx);
}

export function niBuildTransbookStages(nodes, stageCount, stageStates = {}, stageTitles = {}) {
    const nodesByStage = new Map();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        const stageIdx = parseInt(node?.stageIdx, 10);
        if (!Number.isFinite(stageIdx) || stageIdx <= 0) continue;
        if (!nodesByStage.has(stageIdx)) nodesByStage.set(stageIdx, []);
        nodesByStage.get(stageIdx).push(node);
    }

    const stages = [];
    const count = Math.max(0, parseInt(stageCount, 10) || 0);
    for (let stageIdx = 1; stageIdx <= count; stageIdx++) {
        if (stageStates?.[stageIdx] === false) continue;
        stages.push({
            stageIdx,
            title: stageTitles?.[stageIdx] || `第 ${stageIdx} 阶段`,
            nodes: nodesByStage.get(stageIdx) || [],
        });
    }
    return stages;
}

export const NI_TRANSBOOK_STAGE_PAGE_SIZE = 20;
export const NI_TRANSBOOK_PAGE_SIZE_MAX = 200;

export function niResolveTransbookStagePagination(stages, {
    page = 1,
    pageSize = NI_TRANSBOOK_STAGE_PAGE_SIZE,
    activeStageIdx = null,
    alignActive = false,
} = {}) {
    const list = Array.isArray(stages) ? stages : [];
    const normalizedPageSize = Math.max(1, Math.min(NI_TRANSBOOK_PAGE_SIZE_MAX, parseInt(pageSize, 10) || NI_TRANSBOOK_STAGE_PAGE_SIZE));
    const pageCount = Math.max(1, Math.ceil(list.length / normalizedPageSize));
    let nextPage = Math.max(1, parseInt(page, 10) || 1);
    if (alignActive && activeStageIdx != null) {
        const activeIndex = list.findIndex(stage => Number(stage?.stageIdx) === Number(activeStageIdx));
        if (activeIndex >= 0) nextPage = Math.floor(activeIndex / normalizedPageSize) + 1;
    }
    nextPage = Math.min(nextPage, pageCount);
    const startIndex = (nextPage - 1) * normalizedPageSize;
    const endIndex = Math.min(list.length, startIndex + normalizedPageSize);
    return {
        page: nextPage,
        pageCount,
        pageSize: normalizedPageSize,
        total: list.length,
        startIndex,
        endIndex,
        items: list.slice(startIndex, endIndex),
    };
}

export function niReconcileTransbookCurrentNode(nodes, {
    curIdx = 0,
    curNodeId = '',
    frontierStageIdx = 1,
} = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) {
        return { curIdx: 0, curNodeId: '', frontierStageIdx: niNormalizeTransbookFrontierStage(frontierStageIdx) };
    }

    let index = -1;
    if (curNodeId) {
        index = list.findIndex(node => node.id === curNodeId || node.legacyId === curNodeId);
    }
    if (index < 0 && Number.isFinite(Number(curIdx))) {
        index = Math.max(0, Math.min(list.length - 1, Number(curIdx)));
    }
    const nextIndex = index >= 0 ? index : 0;
    return {
        curIdx: nextIndex,
        curNodeId: list[nextIndex]?.id || '',
        frontierStageIdx: niAdvanceTransbookFrontier(frontierStageIdx, list[nextIndex]?.stageIdx),
    };
}

export function niSetTransbookCurrentIndex(nodes, index, frontierStageIdx = 1) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) {
        return { curIdx: 0, curNodeId: '', frontierStageIdx: niNormalizeTransbookFrontierStage(frontierStageIdx) };
    }
    const nextIndex = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    return {
        curIdx: nextIndex,
        curNodeId: list[nextIndex]?.id || '',
        frontierStageIdx: niAdvanceTransbookFrontier(frontierStageIdx, list[nextIndex]?.stageIdx),
    };
}

export function niGetTransbookPriorStageNodeIndexes(nodes, index) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) return [];
    const nextIndex = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    const stageIdx = list[nextIndex]?.stageIdx;
    const indexes = [];
    for (let i = 0; i < nextIndex; i++) {
        if (list[i]?.stageIdx === stageIdx && !list[i]?.done) indexes.push(i);
    }
    return indexes;
}

export function niGetTransbookStageView(nodes, currentIndex) {
    const list = Array.isArray(nodes) ? nodes : [];
    const currentNode = list[currentIndex] || list[0];
    if (!currentNode) return { nodes: [], curIdx: 0, stageIdx: null };
    const stageNodes = list
        .map((node, index) => ({ ...node, _globalIdx: index }))
        .filter(node => node.stageIdx === currentNode.stageIdx);
    const localIndex = Math.max(0, stageNodes.findIndex(node => node.id === currentNode.id));
    return { nodes: stageNodes, curIdx: localIndex, stageIdx: currentNode.stageIdx };
}

export function niGetTransbookProgress(nodes, currentNodeId = '') {
    const list = Array.isArray(nodes) ? nodes : [];
    const activeNode = list.find(node => node.id === currentNodeId || node.legacyId === currentNodeId) || null;
    const doneNodes = list.filter(node => node.done);
    const todoNodes = list.filter(node => !node.done && node.id !== activeNode?.id);
    return {
        total: list.length,
        done: doneNodes.length,
        undone: list.length - doneNodes.length,
        allDone: list.length > 0 && doneNodes.length === list.length,
        activeNode,
        doneNodes,
        todoNodes,
    };
}

export function niFindNextTransbookNode(nodes, currentNode, { sameStage = true } = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const currentIndex = list.findIndex(node => node.id === currentNode?.id);
    return list.find((node, index) =>
        index > currentIndex &&
        (!sameStage || node.stageIdx === currentNode?.stageIdx) &&
        !node.done
    ) || null;
}

export function niFindFirstActionableTransbookNode(nodes) {
    return (Array.isArray(nodes) ? nodes : []).find(node => !node.done && !node.locked) || null;
}

/**
 * 解析真正参与后台注入的节点。
 * tbCurIdx / tbCurNodeId 只作为「当前阶段」的锚点，节点位置由归档进度推导：
 * 取锚点所在阶段里第一个未归档、未锁定的节点。整个阶段都已归档时停在该阶段
 * 最后一个节点（即刚演完的那段），不自动跨阶段——跨阶段仍由用户在阶段面板显式切换。
 */
export function niResolveTransbookInjectionNode(nodes, {
    curIdx = 0,
    curNodeId = '',
} = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) return null;

    let anchorIdx = -1;
    if (curNodeId) {
        anchorIdx = list.findIndex(node => node.id === curNodeId || node.legacyId === curNodeId);
    }
    if (anchorIdx < 0 && Number.isFinite(Number(curIdx))) {
        anchorIdx = Math.max(0, Math.min(list.length - 1, Number(curIdx)));
    }
    if (anchorIdx < 0) anchorIdx = 0;

    const stageIdx = list[anchorIdx]?.stageIdx;
    const stageNodes = list.filter(node => node?.stageIdx === stageIdx);
    const pending = stageNodes.find(node => !node.done && !node.locked);
    return pending || stageNodes[stageNodes.length - 1] || list[anchorIdx] || null;
}

export function createTransbookController(deps = {}) {
    const S = deps.state || {};
    const DEFAULT_SETTINGS = deps.defaultSettings || {};
    const extension_settings = deps.extensionSettings || {};
    const EXT_NAME = deps.extensionName || '';
    const document = deps.document || globalThis.document;
    const window = deps.globalWindow || globalThis.window || {};
    const console = deps.logger || globalThis.console || { log() {}, warn() {}, error() {} };
    const $ = deps.dollar ?? globalThis.$;
    const getContext = deps.getContext || (() => null);
    // 自动归档是长耗时请求，用它校验「发起判定时的聊天」与「落地时的聊天」是否同一个
    const getCurrentChatId = deps.getCurrentChatId || (() => '');
    const getAllPlotsInStoryOrder = deps.getAllPlotsInStoryOrder || (() => []);
    const niEnsurePlotNodeId = deps.ensurePlotNodeId || ((_plot, type, sourceIdx) => String(type) + '_' + sourceIdx);
    const niResolveStageIdx = deps.resolveStageIdx;
    const niComparePlotOrder = deps.comparePlotOrder || (() => 0);
    const saveSettingsDebounced = deps.saveSettingsDebounced || (() => {});
    const callCleanApi = deps.callCleanApi;
    const niApplyStatusbarTheme = deps.applyStatusbarTheme || (() => {});
    const niApplyUserSubstitution = deps.applyUserSubstitution || (value => String(value ?? ''));
    const niGetUserSubConfig = deps.getUserSubConfig || (() => ({}));
    const niIsUserSubReplaceSelectedChar = deps.isUserSubReplaceSelectedChar || (() => false);
    const niIsUserSubSelectedChar = deps.isUserSubSelectedChar || (() => false);
    const niIsUserSubPlayMode = deps.isUserSubPlayMode || (() => false);
    const niGetCharAiShowEnabled = deps.getCharAiShowEnabled || (() => false);
    const niGetCharAiProfile = deps.getCharAiProfile || (() => null);
    const niTogglePanel = deps.togglePanel || (() => {});
    const niPopSetVisible = deps.popSetVisible;
    const niPopSyncVisibility = deps.popSyncVisibility;
    const niSetTransBookMode = deps.setTransBookMode || (() => {});
    const niSyncTransBookToggleUI = deps.syncTransBookToggleUI || (() => {});
    const niNormalizePageSize = deps.normalizePageSize || ((value, fallback = NI_TRANSBOOK_STAGE_PAGE_SIZE) => {
        const parsed = parseInt(value, 10);
        return Math.max(1, Math.min(200, Number.isFinite(parsed) ? parsed : fallback));
    });
    const niBuildListPaginationHtml = deps.buildListPaginationHtml || (({ pagination = {}, idPrefix = 'ni-tb-page', wrapperClass = '', sizeInputClass = '', pageInputClass = '', pageButtonClass = '' } = {}) => {
        const total = Math.max(0, parseInt(pagination.total, 10) || 0);
        const page = Math.max(1, parseInt(pagination.page, 10) || 1);
        const pageSize = niNormalizePageSize(pagination.pageSize, NI_TRANSBOOK_STAGE_PAGE_SIZE);
        const pageCount = Math.max(1, parseInt(pagination.pageCount, 10) || 1);
        if (total <= 5 && pageCount <= 1) return '';
        return `<div class="ni-list-pagination ${wrapperClass}">
          <label class="ni-pagination-size">每 <input type="number" id="${idPrefix}-size" class="${sizeInputClass}" value="${pageSize}" min="1" max="200" step="1"> 一页</label>
          <div class="ni-pagination-current">
            <label>目前第 <input type="number" id="${idPrefix}-current" class="${pageInputClass}" value="${page}" min="1" max="${pageCount}" step="1" title="共 ${pageCount} 页"> 页</label>
            <button type="button" id="${idPrefix}-prev" class="ni-page-btn ni-page-prev ${pageButtonClass}" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>←</button>
            <button type="button" id="${idPrefix}-next" class="ni-page-btn ni-page-next ${pageButtonClass}" data-page="${page + 1}"${page >= pageCount ? ' disabled' : ''}>→</button>
          </div>
        </div>`;
    });
    const setTimeout = deps.setTimeout || globalThis.setTimeout;
    const requestAnimationFrame = deps.requestAnimationFrame || globalThis.requestAnimationFrame || (callback => callback());
    const Event = deps.Event || globalThis.Event;
    const TB_DEFAULT_ADVANCE_PROMPT = deps.defaultAdvancePrompt || '';
    const TB_DEFAULT_INFER_PROMPT = deps.defaultInferPrompt || '';
    const TB_DEFAULT_AUTO_ARCHIVE_PROMPT = deps.defaultAutoArchivePrompt || '';
    const TB_DEFAULT_OPENING_PROMPT = deps.defaultOpeningPrompt || '';
    const TB_DEFAULT_ONGOING_PROMPT = deps.defaultOngoingPrompt || '';
    const TB_DEFAULT_IMMERSION_PROMPT = deps.defaultImmersionPrompt || '';
    const TB_LEGACY_ADVANCE_PROMPT = deps.legacyAdvancePrompt || '';
    const TB_LEGACY_OPENING_PROMPT = deps.legacyOpeningPrompt || '';
    const TB_LEGACY_ONGOING_PROMPT = deps.legacyOngoingPrompt || '';
    const getDeviationContext = deps.getDeviationContext || (() => '');

    S.tbNodeDone   = {};   // {[nodeId]: boolean}  — 节点完成状态（从 chat[0] 读写）
    S.tbPaused     = false; // 暂停剧情节点/压缩原文直注及开场/推进/持续提示词（保存到当前聊天首条消息 ni_tb.paused）
    S.tbCurIdx     = 0;    // 已确认的剧情节点下标：持久化，并用于后台注入/API
    S.tbCurNodeId  = '';   // 已确认节点稳定 id，避免刷新后因列表重排导致索引漂移
    S.tbViewIdx    = null; // RP 中预览的节点下标：只控制界面、不参与注入；随聊天文件持久化，刷新后恢复
    S.tbViewNodeId = '';   // 预览节点稳定 id（保存到当前聊天首条消息 ni_tb.viewNodeId）
    S.tbViewPinned = false; // 从存档恢复 view 后置真：在真正的新消息到来前，阻止自动回正到当前节点
    S.tbFrontierStageIdx = 1; // 用户已经手动推进到的最远阶段，用于跳过旧阶段剩余节点的锁定
    S.tbInferring  = false; // 推演中
    S.tbSectionOpen = { done: false, active: true, todo: false };
    const TB_NODE_BATCH_SIZE = 40;
    let _tbStagePage = 1;
    let _tbNodePanelStageIdx = null;
    const _tbNodePanelLimits = { done: TB_NODE_BATCH_SIZE, todo: TB_NODE_BATCH_SIZE };

    function niTbGetStagePageSize() {
        const cfg = extension_settings[EXT_NAME] || {};
        return niNormalizePageSize(cfg.transBookStagePageSize, DEFAULT_SETTINGS.transBookStagePageSize || NI_TRANSBOOK_STAGE_PAGE_SIZE);
    }

    function niTbSetStagePageSize(value) {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.transBookStagePageSize = niNormalizePageSize(value, cfg.transBookStagePageSize || DEFAULT_SETTINGS.transBookStagePageSize || NI_TRANSBOOK_STAGE_PAGE_SIZE);
        _tbStagePage = 1;
        saveSettingsDebounced();
        niTbRebuildStageList(niCreateTbSnapshot());
        return cfg.transBookStagePageSize;
    }
    
    function niTbSyncPauseUI() {
        const paused = !!S.tbPaused;
    
        const barBtn  = document.getElementById('ni-tb-btn-pause');
        const barIcon = document.getElementById('ni-tb-pause-icon');
        const barText = document.getElementById('ni-tb-pause-text');
        barBtn?.classList.toggle('paused', paused);
        if (barIcon) barIcon.className = paused ? 'ti ti-player-play' : 'ti ti-player-pause';
        if (barText) barText.textContent = paused ? '继续' : '暂停';
    
        const popBtn = document.getElementById('ni-pop-btn-pause');
        const popTxt = document.getElementById('ni-pop-pause-txt');
        popBtn?.classList.toggle('paused', paused);
        if (popTxt) popTxt.textContent = paused ? '恢复' : '暂停';
    }
    window.niTbSyncPauseUI = niTbSyncPauseUI;
    
    function niTbSetPaused(paused) {
        S.tbPaused = !!paused;
        niTbSyncPauseUI();
        niTbSaveState().catch(e => console.warn('[NI-TB] 保存暂停状态失败:', e));
    }
    window.niTbSetPaused = niTbSetPaused;
    
    function niTbTogglePaused() {
        niTbSetPaused(!S.tbPaused);
    }
    window.niTbTogglePaused = niTbTogglePaused;
    
    // ── 数据字段追加到 DEFAULT_SETTINGS ─────────────────────────
    
    DEFAULT_SETTINGS.transBookMode    = false;
    DEFAULT_SETTINGS.tbAdvancePrompt  = TB_DEFAULT_ADVANCE_PROMPT;
    DEFAULT_SETTINGS.tbInferPrompt    = TB_DEFAULT_INFER_PROMPT;
    DEFAULT_SETTINGS.tbOpeningPrompt  = TB_DEFAULT_OPENING_PROMPT;
    DEFAULT_SETTINGS.tbOngoingPrompt  = TB_DEFAULT_ONGOING_PROMPT;
    DEFAULT_SETTINGS.tbLightRecallMode = false;
    DEFAULT_SETTINGS.tbAutoArchive = false;
    DEFAULT_SETTINGS.tbAutoArchiveWindow = 10;
    DEFAULT_SETTINGS.tbAutoArchiveCooldownSec = 30;
    DEFAULT_SETTINGS.tbAutoStageAdvance = true;
    DEFAULT_SETTINGS.tbImmersionMode  = false;
    DEFAULT_SETTINGS.tbImmersionPrompt = TB_DEFAULT_IMMERSION_PROMPT;
    // 未来剧情提前注入：持续提示词后追加后续待演节点与后续阶段走向
    DEFAULT_SETTINGS.tbFutureInjectEnabled = true;
    DEFAULT_SETTINGS.tbFutureNodeCount = 3;
    DEFAULT_SETTINGS.tbFutureStageCount = 1;
    DEFAULT_SETTINGS.tbFutureNodeClip = 150;
    
    function niUpgradeLegacyTbDefaultPrompts(cfg = extension_settings[EXT_NAME] || {}) {
        if (!cfg || typeof cfg !== 'object') return false;
        let changed = false;
        const norm = value => String(value ?? '').replace(/\r\n/g, '\n');
        const isOlderAdvanceDefault = value => {
            const text = norm(value);
            return text.startsWith('[穿书模式·当前叙事阶段]')
                && text.includes('▌叙事目标（持续追踪）')
                && text.includes('目标：{B_BODY}')
                && text.includes('完成信号：[由用户手动确认，AI不得自行宣布完成]')
                && text.includes('每次回复前，隐式评估：目标达成了吗？还缺什么？')
                && text.includes('不是必须重演的脚本场景')
                && text.trim().endsWith('[/穿书模式·当前叙事阶段]')
                && !text.includes('剧情节点不是任务目标');
        };
        const isOlderOngoingDefault = value => {
            const text = norm(value);
            return text === norm(`[穿书模式·进行中]
    当前阶段「{B_TITLE}」持续中，核心走向：{B_BODY}
    跟随用户行动自然推进，用户无操作时仅推进当下场景，不强行跳转节点。
    阶段完成由用户确认。
    [/穿书模式·进行中]`);
        };
        // 上一版“自由优先”默认：存档内容与该版默认逐行一致（忽略缩进差异）时，
        // 同步升级到当前默认（主线约束版）。用户自己改过的文本不会被匹配、不受影响。
        const squash = value => String(value ?? '').replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).join('\n');
        const isFreeFirstOngoingDefault = value => squash(value) === squash(`[穿书模式·进行中]
当前阶段「{B_TITLE}」持续中，原著剧情节点：{B_BODY}
剧情节点只是原著参考，用来说明原著里发生过什么、有哪些人物关系和事件背景；它不是任务目标，也不是必须完成的清单。
当前聊天已经发生的内容优先。跟随用户行动自然推进，用户无操作时仅推进当下场景，不强行跳转节点。
不得用未铺垫的新变量压低、替换或无效化 <user> 已建立的身份、关系、资源、承诺与主动权。
[/穿书模式·进行中]`);
        const upgrade = (key, legacyValue, nextValue) => {
            if (norm(cfg[key]) !== norm(legacyValue)) return;
            cfg[key] = nextValue;
            changed = true;
        };
        upgrade('tbAdvancePrompt', TB_LEGACY_ADVANCE_PROMPT, TB_DEFAULT_ADVANCE_PROMPT);
        upgrade('tbOpeningPrompt', TB_LEGACY_OPENING_PROMPT, TB_DEFAULT_OPENING_PROMPT);
        upgrade('tbOngoingPrompt', TB_LEGACY_ONGOING_PROMPT, TB_DEFAULT_ONGOING_PROMPT);
        if (isOlderAdvanceDefault(cfg.tbAdvancePrompt)) {
            cfg.tbAdvancePrompt = TB_DEFAULT_ADVANCE_PROMPT;
            changed = true;
        }
        if (isOlderAdvanceDefault(cfg.tbOpeningPrompt)) {
            cfg.tbOpeningPrompt = TB_DEFAULT_OPENING_PROMPT;
            changed = true;
        }
        if (isOlderOngoingDefault(cfg.tbOngoingPrompt)) {
            cfg.tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
            changed = true;
        }
        if (isFreeFirstOngoingDefault(cfg.tbOngoingPrompt)) {
            cfg.tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
            changed = true;
        }
        return changed;
    }
    
    function niTbGetImmersionAppend(cfg) {
        if (!cfg?.tbImmersionMode) return '';
        const prompt = (cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT).trim();
        return prompt ? `\n${prompt}` : '';
    }
    
    function niTbFrontierStage() {
        return niNormalizeTransbookFrontierStage(S.tbFrontierStageIdx);
    }
    
    function niTbAdvanceFrontier(stageIdx) {
        S.tbFrontierStageIdx = niAdvanceTransbookFrontier(S.tbFrontierStageIdx, stageIdx);
        return S.tbFrontierStageIdx;
    }
    
    // ── 数据桥接 ─────────────────────────────────────────────────
    
    /**
     * 返回已启用阶段的节点，合并 main+sub+pivot，按 stageIdx 升序，同阶段内按故事/人工顺序。
     * 每个节点：{ id, type, typeLabel, title, body, time, location, stageIdx, done, locked }
     */
    function niGetTbNodes() {
        const enabledPlots = getAllPlotsInStoryOrder(S)
            .map(plot => {
                const stageIdx = niResolveTransbookNodeStageIdx(plot, niResolveStageIdx);
                if (stageIdx <= 0 || S.stageStates?.[stageIdx] === false) return null;
                return stageIdx === plot?.stageIdx ? plot : { ...plot, stageIdx };
            })
            .filter(Boolean);
        return niBuildTransbookNodes(enabledPlots, S.tbNodeDone, {
            resolveNodeId: (plot, type, sourceIdx) => niEnsurePlotNodeId(plot, type, sourceIdx),
            resolveStageIdx: niResolveStageIdx,
            comparePlotOrder: niComparePlotOrder,
            frontierStageIdx: niTbFrontierStage(),
        });
    }
    
    /**
     * 返回已启用阶段列表 [{stageIdx, title, nodes[]}]
     */
    function niGetTbStages(nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        return niBuildTransbookStages(list, S.stageMapN, S.stageStates, S.stageTitles);
    }

    function niCreateTbSnapshot(nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const stages = niGetTbStages(list);
        const firstNodeIndexByStage = {};
        let doneCount = 0;
        list.forEach((node, index) => {
            const stageIdx = Number(node?.stageIdx);
            if (Number.isFinite(stageIdx) && firstNodeIndexByStage[stageIdx] === undefined) {
                firstNodeIndexByStage[stageIdx] = index;
            }
            if (node?.done) doneCount++;
        });
        return {
            nodes: list,
            stages,
            firstNodeIndexByStage,
            doneCount,
        };
    }
    
    function niTbReconcileCurrentNode(nodes = niGetTbNodes()) {
        const reconciled = niReconcileTransbookCurrentNode(nodes, {
            curIdx: S.tbCurIdx,
            curNodeId: S.tbCurNodeId,
            frontierStageIdx: S.tbFrontierStageIdx,
        });
        S.tbCurIdx = reconciled.curIdx;
        S.tbCurNodeId = reconciled.curNodeId;
        S.tbFrontierStageIdx = reconciled.frontierStageIdx;
        niTbReconcileViewNode(nodes);
    }

    /**
     * 后台注入/API 使用的节点。UI 侧的预览下标（tbViewIdx）一律不参与，
     * 阶段锚点内的实际位置由归档进度推导，勾选归档后自动前移。
     */
    function niTbGetInjectionNode(nodes = niGetTbNodes()) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return null;
        niTbReconcileCurrentNode(list);
        return niResolveTransbookInjectionNode(list, {
            curIdx: S.tbCurIdx,
            curNodeId: S.tbCurNodeId,
        });
    }
    window.niTbGetInjectionNode = niTbGetInjectionNode;

    function niTbReconcileViewNode(nodes = niGetTbNodes()) {
        const list = Array.isArray(nodes) ? nodes : [];
        // 空列表时保持现值不清空：节点数据未就绪的窗口期里清空
        // 会毁掉刚从存档恢复、尚未消费的 viewIdx/viewNodeId
        if (!list.length) return;
        let viewIdx = list.findIndex(node =>
            node?.id === S.tbViewNodeId || node?.legacyId === S.tbViewNodeId
        );
        if (viewIdx < 0 && S.tbViewIdx !== null && S.tbViewIdx !== '' && Number.isFinite(Number(S.tbViewIdx))) {
            viewIdx = Math.max(0, Math.min(list.length - 1, Number(S.tbViewIdx)));
        }
        if (viewIdx < 0) viewIdx = Math.max(0, Math.min(list.length - 1, Number(S.tbCurIdx) || 0));
        S.tbViewIdx = viewIdx;
        S.tbViewNodeId = list[viewIdx]?.id || '';
    }
    
    function niTbSetCurrentIdx(idx, nodes = niGetTbNodes(), { persist = false, archivePrior = false } = {}) {
        if (archivePrior) {
            niGetTransbookPriorStageNodeIndexes(nodes, idx).forEach(priorIdx => {
                const node = nodes[priorIdx];
                if (!node) return;
                S.tbNodeDone[node.id] = true;
                if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
                node.done = true;
            });
        }
        const next = niSetTransbookCurrentIndex(nodes, idx, S.tbFrontierStageIdx);
        S.tbCurIdx = next.curIdx;
        S.tbCurNodeId = next.curNodeId;
        S.tbFrontierStageIdx = next.frontierStageIdx;
        S.tbViewIdx = next.curIdx;
        S.tbViewNodeId = next.curNodeId;
        S.tbViewPinned = false;
        if (persist) niTbSaveState(nodes).catch(e => console.warn('[NI-TB] 保存当前节点失败:', e));
        return S.tbCurIdx;
    }
    window.niTbSetCurrentIdx = niTbSetCurrentIdx;

    function niTbSetViewIdx(idx, nodes = niGetTbNodes(), { render = false, persist = false } = {}) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return 0;
        const nextIdx = Math.max(0, Math.min(list.length - 1, Number(idx) || 0));
        S.tbViewIdx = nextIdx;
        S.tbViewNodeId = list[nextIdx]?.id || '';
        if (persist) niTbSaveState(list).catch(e => console.warn('[NI-TB] 保存预览节点失败:', e));
        if (render) {
            const snapshot = niCreateTbSnapshot(list);
            niTbBuildTrack(list);
            niTbSyncMeta(list);
            niTbRefreshNodePanel(list);
            niTbRebuildStageList(snapshot, { alignActive: true });
        }
        return S.tbViewIdx;
    }
    window.niTbSetViewIdx = niTbSetViewIdx;

    function niTbResetViewToCurrent(nodes = niGetTbNodes()) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return S.tbViewIdx;
        niTbReconcileCurrentNode(list);
        // 刷新/切聊天恢复的 view 处于钉住状态：新消息到来（解钉）前不自动回正
        if (S.tbViewPinned) return S.tbViewIdx;
        const curNode = list[S.tbCurIdx];
        if (!curNode || curNode.done) return S.tbViewIdx;
        S.tbViewIdx = S.tbCurIdx;
        S.tbViewNodeId = S.tbCurNodeId || curNode.id || '';
        return S.tbViewIdx;
    }
    window.niTbResetViewToCurrent = niTbResetViewToCurrent;

    function niTbUnpinView() {
        S.tbViewPinned = false;
    }
    window.niTbUnpinView = niTbUnpinView;
    
    function niTbStageView(nodes, curIdx) {
        return niGetTransbookStageView(nodes, curIdx);
    }
    window.niTbStageView = niTbStageView;
    
    // ── 持久化 ────────────────────────────────────────────────────
    
    async function niTbSaveState(nodes = null) {
        try {
            const ctx = getContext();
            if (!ctx?.chat?.[0]) return;
            const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
            if (list.length) niTbReconcileCurrentNode(list);
            ctx.chat[0].ni_tb = ctx.chat[0].ni_tb || {};
            ctx.chat[0].ni_tb.nodeDone = { ...S.tbNodeDone };
            ctx.chat[0].ni_tb.curIdx   = S.tbCurIdx;
            ctx.chat[0].ni_tb.curNodeId = S.tbCurNodeId || list[S.tbCurIdx]?.id || '';
            ctx.chat[0].ni_tb.viewIdx   = S.tbViewIdx ?? S.tbCurIdx;
            ctx.chat[0].ni_tb.viewNodeId = S.tbViewNodeId || list[S.tbViewIdx]?.id || ctx.chat[0].ni_tb.curNodeId;
            ctx.chat[0].ni_tb.frontierStageIdx = niTbFrontierStage();
            ctx.chat[0].ni_tb.paused   = !!S.tbPaused;
            await ctx.saveChat();
        } catch (e) {
            console.warn('[NI-TB] saveState 失败:', e);
        }
    }
    
    function niTbLoadState() {
        try {
            const ctx = getContext();
            const saved = ctx?.chat?.[0]?.ni_tb;
            S.tbNodeDone = saved?.nodeDone ? { ...saved.nodeDone } : {};
            S.tbCurIdx   = saved?.curIdx   ?? 0;
            S.tbCurNodeId = saved?.curNodeId || '';
            S.tbFrontierStageIdx = Math.max(1, parseInt(saved?.frontierStageIdx, 10) || 1);
            S.tbPaused   = !!saved?.paused;
            // 恢复退出前预览的节点（含已归档节点），并钉住防止加载期的自动回正
            if (saved?.viewNodeId || Number.isFinite(Number(saved?.viewIdx))) {
                S.tbViewIdx = Number.isFinite(Number(saved?.viewIdx)) ? Number(saved.viewIdx) : S.tbCurIdx;
                S.tbViewNodeId = saved?.viewNodeId || '';
                S.tbViewPinned = true;
            } else {
                S.tbViewIdx = S.tbCurIdx;
                S.tbViewNodeId = S.tbCurNodeId;
                S.tbViewPinned = false;
            }
        } catch (e) {
            S.tbNodeDone = {};
            S.tbCurIdx   = 0;
            S.tbCurNodeId = '';
            S.tbFrontierStageIdx = 1;
            S.tbPaused   = false;
            S.tbViewIdx = S.tbCurIdx;
            S.tbViewNodeId = S.tbCurNodeId;
            S.tbViewPinned = false;
        }
    }
    
    // ── 状态栏 HTML 构建 ──────────────────────────────────────────
    
    function niGetTbStoryBarHtml(snapshot = null) {
        const cfg = extension_settings[EXT_NAME] || {};
        const runtime = snapshot?.nodes ? snapshot : niCreateTbSnapshot();
        const { nodes, doneCount } = runtime;
        if (!nodes.length) return '';
    
        // 用稳定节点 id 恢复当前节点，再钳制 curIdx
        niTbReconcileCurrentNode(nodes);
        const curNode = nodes[S.tbCurIdx] || nodes[0];
        const viewNode = nodes[S.tbViewIdx] || curNode;
        const stageView = niTbStageView(nodes, S.tbViewIdx);
        const statusLabel = doneCount === nodes.length ? '全部完成' : '进行中';
        const themeFollowClass = cfg.themeStatusbarFollow ? ' ni-tb-theme-follow' : '';
    
        return `<div class="ni-tb-shell${themeFollowClass}" id="ni-storybar">
      <div class="ni-tb-bar" id="ni-tb-bar">
        <div class="ni-tb-pin"></div>
        <div class="ni-tb-status">${statusLabel}</div>
        <div class="ni-tb-curtitle" id="ni-tb-curtitle">${niEsc(viewNode.title)}</div>
        <div class="ni-tb-meta" id="ni-tb-meta">节点 ${stageView.curIdx + 1} / ${stageView.nodes.length}</div>
        <i class="ti ti-chevron-down ni-tb-chevron" id="ni-tb-chevron"></i>
      </div>
      <div class="ni-tb-body" id="ni-tb-body-wrap">
        <div class="ni-tb-selrow">
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-stage-btn" title="切换阶段">
            <i class="ti ti-layout-list"></i>
          </div>
          <div class="ni-tb-sel-sep">/</div>
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-node-btn" title="切换节点">
            <i class="ti ti-flag-2"></i>
          </div>
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-btn-reset" title="重置全部节点进度（回档重玩）">
            <i class="ti ti-rotate"></i>
          </div>
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-btn-archive" title="立即判定节点归档（调用清洗模型核对当前剧情进度，自动归档开关关闭时也可使用）">
            <i class="ti ti-archive" id="ni-tb-archive-icon"></i>
          </div>
          <div class="ni-tb-sel-spacer"></div>
          <div class="ni-tb-btn-free" id="ni-tb-btn-free">
            <i class="ti ti-chart-line" id="ni-tb-free-icon"></i>
            <span id="ni-tb-free-label">推演</span>
          </div>
          <div class="ni-tb-btn-pause${S.tbPaused ? ' paused' : ''}" id="ni-tb-btn-pause">
            <i class="${S.tbPaused ? 'ti ti-player-play' : 'ti ti-player-pause'}" id="ni-tb-pause-icon"></i>
            <span id="ni-tb-pause-text">${S.tbPaused ? '继续' : '暂停'}</span>
          </div>
        </div>
    
        <!-- 阶段下拉 -->
        <div class="ni-tb-drop-panel" id="ni-tb-stage-panel">
          <span class="ni-tb-sp-label">已开启阶段</span>
          <div class="ni-tb-sp-list" id="ni-tb-stage-list"></div>
        </div>
    
        <!-- 节点下拉 -->
        <div class="ni-tb-drop-panel" id="ni-tb-node-panel"></div>
    
        <!-- 轮播 -->
        <div class="ni-tb-carousel-wrap" id="ni-tb-wrap">
          <div class="ni-tb-track" id="ni-tb-track"></div>
        </div>
    
        <!-- 推演结果 -->
        <div class="ni-tb-infer-block" id="ni-tb-infer-block">
          <div class="ni-tb-infer-toggle expanded" id="ni-tb-infer-toggle">
            <span class="ni-tb-infer-toggle-label">以下为下一步行动选项，点击填入输入框</span>
            <i class="ti ti-chevron-up ni-tb-infer-toggle-icon expanded" id="ni-tb-infer-toggle-icon"></i>
          </div>
          <div class="ni-tb-infer-list vis" id="ni-tb-infer-list"></div>
        </div>
      </div>
    </div>`;
    }
    
    function niEsc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    
    function niTbBuildStageListHtml(stages, activeStageIdx, pagination = null) {
        const rows = (Array.isArray(stages) ? stages : []).map(s =>
            `<div class="ni-tb-sp-row${s.stageIdx === activeStageIdx ? ' active-stage' : ''}" data-si="${s.stageIdx}">
               <div class="ni-tb-sp-dot"></div>
               <span class="ni-tb-sp-name">${niEsc(s.title)}</span>
             </div>`
        ).join('');
        if (!pagination) return rows;
        const pager = niBuildListPaginationHtml({
            pagination,
            idPrefix: 'ni-tb-stage-page',
            wrapperClass: 'ni-tb-sp-page',
            sizeInputClass: 'ni-tb-sp-page-size',
            pageInputClass: 'ni-tb-sp-page-current',
            pageButtonClass: 'ni-tb-sp-page-btn',
            sizeAriaLabel: '每页穿书阶段数',
            pageAriaLabel: '当前穿书阶段页码',
        });
        return pager + rows;
    }
    
    // 节点面板「进行中」的全局下标：以推导出的注入节点为准，取不到时退回阶段锚点。
    function niTbResolveActivePanelIdx(nodes) {
        const list = Array.isArray(nodes) ? nodes : [];
        const injectionNode = niTbGetInjectionNode(list);
        if (!injectionNode) return S.tbCurIdx;
        const idx = list.findIndex(node => node === injectionNode
            || (injectionNode.id && node?.id === injectionNode.id));
        return idx >= 0 ? idx : S.tbCurIdx;
    }

    function niTbBuildNodePanelHtml(nodes, curIdx, limits = _tbNodePanelLimits) {
        const activeNode  = nodes.find(n => n._globalIdx === curIdx) || nodes[curIdx];
        const activeId    = activeNode?.id;
        // 整个阶段都归档后注入节点停在末节点，此时它自身是 done 的：从已归档列表里排除，
        // 否则同一个节点会同时出现在「已归档」和「进行中」两个区块。
        const doneNodes   = nodes.filter(n => n.done && n.id !== activeId);
        const todoNodes   = nodes.filter(n => !n.done && n.id !== activeId);
        const sOp = S.tbSectionOpen;
        const visibleDone = sOp.done ? doneNodes.slice(0, Math.max(1, limits?.done || TB_NODE_BATCH_SIZE)) : [];
        const visibleTodo = sOp.todo ? todoNodes.slice(0, Math.max(1, limits?.todo || TB_NODE_BATCH_SIZE)) : [];
    
        const mkRow = (n, i, cls, dotCls) =>
            `<div class="ni-tb-np-row ${cls}" data-ni="${n._globalIdx ?? i}">
               <div class="ni-tb-np-dot ${dotCls}"></div>
               <span class="ni-tb-np-title">${niEsc(n.title)}</span>
               <span class="ni-tb-np-type ${n.type}">${niEsc(n.typeLabel)}</span>
             </div>`;
    
        return `
          <div class="ni-tb-section-hd" data-sec="done">
            <i class="ti ti-chevron-right ni-tb-section-icon${sOp.done ? ' open' : ''}" id="ni-tb-sec-icon-done"></i>
            <span class="ni-tb-section-label">已归档</span>
            <span class="ni-tb-section-count done-count" id="ni-tb-sec-count-done">${doneNodes.length}</span>
          </div>
          <div class="ni-tb-np-list${sOp.done ? ' vis' : ''}" id="ni-tb-sec-list-done">
            ${visibleDone.map((n, i) => mkRow(n, i, 'done-row', 'done')).join('')}
            ${visibleDone.length < doneNodes.length ? `<button class="ni-tb-np-more" data-sec="done">继续显示（${doneNodes.length - visibleDone.length}）</button>` : ''}
          </div>
          <div class="ni-tb-section-hd" data-sec="active" style="background:var(--ni-warning-alpha-03, rgba(208,100,110,.03))">
            <i class="ti ti-chevron-right ni-tb-section-icon open" id="ni-tb-sec-icon-active"></i>
            <span class="ni-tb-section-label" style="color:var(--color-text-primary);font-weight:500">进行中</span>
            <span class="ni-tb-section-count done-count">当前</span>
          </div>
          <div class="ni-tb-np-list vis" id="ni-tb-sec-list-active">
            ${activeNode ? mkRow(activeNode, activeNode._globalIdx ?? curIdx, 'active', 'active-dot') : ''}
          </div>
          <div class="ni-tb-section-hd" data-sec="todo">
            <i class="ti ti-chevron-right ni-tb-section-icon${sOp.todo ? ' open' : ''}" id="ni-tb-sec-icon-todo"></i>
            <span class="ni-tb-section-label" style="opacity:.5">待解锁 / 未完成</span>
            <span class="ni-tb-section-count" id="ni-tb-sec-count-todo">${todoNodes.length}</span>
          </div>
          <div class="ni-tb-np-list${sOp.todo ? ' vis' : ''}" id="ni-tb-sec-list-todo">
            ${visibleTodo.map((n, i) => mkRow(n, i, n.locked ? '' : '', n.locked ? 'todo' : 'todo')).join('')}
            ${visibleTodo.length < todoNodes.length ? `<button class="ni-tb-np-more" data-sec="todo">继续显示（${todoNodes.length - visibleTodo.length}）</button>` : ''}
          </div>`;
    }
    
    // ── 轮播渲染 ─────────────────────────────────────────────────
    
    const TB_AW = 214, TB_SW = 150, TB_GAP = 10;
    
    function niTbGetSlots(nodes, cur) {
        const s = [];
        if (cur > 0) s.push({ idx: cur - 1, role: 'prev' });
        s.push({ idx: cur, role: 'active' });
        if (cur < nodes.length - 1) s.push({ idx: cur + 1, role: 'next' });
        return s;
    }
    
    function niTbCalcPos(slots, W) {
        const ws  = slots.map(s => s.role === 'active' ? TB_AW : TB_SW);
        const ai  = slots.findIndex(s => s.role === 'active');
        const pos = [];
        pos[ai] = W / 2 - TB_AW / 2;
        let rx = pos[ai];
        for (let i = ai - 1; i >= 0; i--) { rx -= TB_GAP + ws[i]; pos[i] = rx; }
        let lx = pos[ai] + TB_AW;
        for (let i = ai + 1; i < slots.length; i++) { pos[i] = lx + TB_GAP; lx = pos[i] + ws[i]; }
        return pos;
    }
    
    function niTbCardHTML(node, idx, displayIdx = idx) {
        const typeCls = node.type;
        const descText = node.locked ? '（待解锁）' : (node.body || '（暂无描述）');
        const metaParts = [node.time, node.location]
            .map(v => String(v || '').trim())
            .filter(Boolean);
        const metaHtml = metaParts.length
            ? `<span class="ni-tb-sc-num-meta">${niEsc(metaParts.join(' · '))}</span>`
            : '';
    
        // 事件列表
        const subNotes = (!node.locked && Array.isArray(node.sub_notes) && node.sub_notes.length)
            ? node.sub_notes : [];
        // 伏笔列表
        const foreshadows = (!node.locked && Array.isArray(node.branch_links))
            ? node.branch_links
                .filter(l => l.startsWith('【伏笔】'))
                .map(l => l.replace('【伏笔】', '').trim())
            : [];
    
        const subHtml = subNotes.length
            ? `<div class="ni-tb-sc-extras">${subNotes.map(s =>
                `<span class="ni-tb-sc-event"><i class="ti ti-circle-dot"></i>${niEsc(s)}</span>`
              ).join('')}</div>`
            : '';
        const foreHtml = foreshadows.length
            ? `<div class="ni-tb-sc-extras">${foreshadows.map(f =>
                `<span class="ni-tb-sc-fore"><i class="ti ti-bookmark"></i>${niEsc(f)}</span>`
              ).join('')}</div>`
            : '';
    
        return `<div class="ni-tb-sc-num">节点 ${displayIdx + 1}${metaHtml}</div>
    <span class="ni-tb-sc-type ${typeCls}">${niEsc(node.typeLabel)}</span>
    <div class="ni-tb-sc-check${node.done ? ' checked' : ''}" id="ni-tb-chk${idx}"><i class="ti ti-check"></i></div>
    <div class="ni-tb-sc-title">${niEsc(node.title)}</div>
    <div class="ni-tb-sc-desc">${niEsc(descText)}</div>
    ${subHtml}${foreHtml}
    <div class="ni-tb-scard-overlay" id="ni-tb-overlay${idx}">
      <div class="ni-tb-done-badge">已归档</div>
      <div class="ni-tb-unarchive-hint">点击取消归档</div>
    </div>`;
    }
    
    function niTbBuildTrack(nodes = null) {
        const track = document.getElementById('ni-tb-track');
        if (!track) return;
        track.innerHTML = '';
        const wrap = document.getElementById('ni-tb-wrap');
        const W    = wrap ? wrap.offsetWidth : 600;
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        if (!list.length) return;
        niTbReconcileViewNode(list);
        const view  = niTbStageView(list, S.tbViewIdx);
        if (!view.nodes.length) return;
        const slots = niTbGetSlots(view.nodes, view.curIdx);
        const pos   = niTbCalcPos(slots, W);
    
        slots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            const el = document.createElement('div');
            el.id        = `ni-tb-card${gi}`;
            el.className = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
            el.style.left  = pos[i] + 'px';
            el.style.width = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
            el.innerHTML   = niTbCardHTML(n, gi, s.idx);
            el.onclick     = (e) => niTbCardClick(e, gi);
            track.appendChild(el);
        });
        niRefreshStorybarTheme();
    }
    
    function niTbAnimateTo(newCur, nodes) {
        const wrap  = document.getElementById('ni-tb-wrap');
        const track = document.getElementById('ni-tb-track');
        if (!wrap || !track) return;
        const W = wrap.offsetWidth || 600;
    
        const view = niTbStageView(nodes, newCur);
        if (!view.nodes.length) return;
        const needed  = new Set();
        const localNeeded = new Set();
        if (view.curIdx > 0) localNeeded.add(view.curIdx - 1);
        localNeeded.add(view.curIdx);
        if (view.curIdx < view.nodes.length - 1) localNeeded.add(view.curIdx + 1);
        localNeeded.forEach(li => needed.add(view.nodes[li]._globalIdx ?? li));
    
        const existing  = new Set([...track.querySelectorAll('.ni-tb-scard')].map(el => +el.id.replace('ni-tb-card', '')));
        const newSlots  = niTbGetSlots(view.nodes, view.curIdx);
        const newPos    = niTbCalcPos(newSlots, W);
    
        // 移除不再需要的卡片
        existing.forEach(idx => {
            if (!needed.has(idx)) {
                const el = document.getElementById(`ni-tb-card${idx}`);
                if (!el) return;
                el.style.opacity = '0'; el.style.transform = 'scale(.92)';
                setTimeout(() => el.remove(), 400);
            }
        });
    
        // 新增卡片
        newSlots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            if (!existing.has(gi)) {
                const el = document.createElement('div');
                el.id        = `ni-tb-card${gi}`;
                el.className = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
                el.style.transition = 'none';
                el.style.left    = (newPos[i] + (gi < newCur ? -70 : 70)) + 'px';
                el.style.width   = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
                el.style.opacity = '0'; el.style.transform = 'scale(.94)';
                el.innerHTML     = niTbCardHTML(n, gi, s.idx);
                el.onclick       = (e) => niTbCardClick(e, gi);
                track.appendChild(el);
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    el.style.transition = '';
                    el.style.left = newPos[i] + 'px';
                    el.style.opacity = ''; el.style.transform = '';
                }));
            }
        });
    
        // 更新已有卡片位置/角色
        newSlots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            if (existing.has(gi)) {
                const el = document.getElementById(`ni-tb-card${gi}`);
                if (!el) return;
                el.className   = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
                el.style.left  = newPos[i] + 'px';
                el.style.width = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
                el.style.opacity = ''; el.style.transform = '';
            }
        });
        niRefreshStorybarTheme();
    }
    
    function niTbCardClick(e, idx, nodes = null) {
        // 卡片可能在归档状态变化后继续存活，闭包携带的节点数组会过期；点击时统一取最新数据
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        if (idx !== S.tbViewIdx) {
            niTbSetViewIdx(idx, list, { persist: true });
            niTbAnimateTo(idx, list);
            niTbSyncMeta(list);
            niTbRefreshNodePanel(list);
            return;
        }
        // active 卡：判断点击区域
        const overlay = document.getElementById(`ni-tb-overlay${idx}`);
        const chk     = document.getElementById(`ni-tb-chk${idx}`);
        if (overlay && overlay.contains(e.target)) {
            niTbUnarchive(idx, list);
        } else if (chk && chk.contains(e.target)) {
            niTbToggleCheck(idx, list);
        }
    }
    
    // ── 节点操作 ─────────────────────────────────────────────────
    
    function niTbSyncMeta(nodes) {
        niTbReconcileViewNode(nodes);
        const n = nodes[S.tbViewIdx];
        if (!n) return;
        const view   = niTbStageView(nodes, S.tbViewIdx);
        const el = (id) => document.getElementById(id);
        if (el('ni-tb-curtitle')) el('ni-tb-curtitle').textContent = n.title;
        if (el('ni-tb-meta'))     el('ni-tb-meta').textContent     = `节点 ${view.curIdx + 1} / ${view.nodes.length}`;
        niRefreshStorybarTheme();
    }
    
    function niTbRefreshNodePanel(nodes) {
        const panel = document.getElementById('ni-tb-node-panel');
        if (!panel) return;
        // 「进行中」必须指向真正参与注入的节点：tbCurIdx 只是阶段锚点，勾选归档时它不动，
        // 注入节点却会前移到阶段内第一个未归档未锁定的节点，两者会分叉。
        const activeIdx = niTbResolveActivePanelIdx(nodes);
        const view = niTbStageView(nodes, activeIdx);
        if (_tbNodePanelStageIdx !== view.stageIdx) {
            _tbNodePanelStageIdx = view.stageIdx;
            _tbNodePanelLimits.done = TB_NODE_BATCH_SIZE;
            _tbNodePanelLimits.todo = TB_NODE_BATCH_SIZE;
        }
        panel.innerHTML = niTbBuildNodePanelHtml(view.nodes, activeIdx, _tbNodePanelLimits);
        niTbBindNodePanelEvents();
        niRefreshStorybarTheme();
    }
    
    async function niTbToggleCheck(idx, nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const node  = list[idx];
        if (!node) return;
        if (node.locked) return; // 锁定节点不可操作
    
        const newDone = !node.done;
        S.tbNodeDone[node.id] = newDone;
        node.done = newDone;
        if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
        if (!newDone) {
            for (const key of _tbAdvanceSent) {
                if (key.startsWith(`${node.id}->`)) _tbAdvanceSent.delete(key);
            }
        }
    
        // 更新 DOM 立即反馈
        document.getElementById(`ni-tb-chk${idx}`)?.classList.toggle('checked', newDone);
        document.getElementById(`ni-tb-card${idx}`)?.classList.toggle('done', newDone);
        const updatedSnapshot = niCreateTbSnapshot();
        niTbRefreshNodePanel(updatedSnapshot.nodes);
        niTbSyncStoryBar(updatedSnapshot);
    
        await niTbSaveState(updatedSnapshot.nodes);
    
        // 节点完成后准备推进提示词；暂停期间保留待发送，恢复后生效
        if (newDone) {
            const freshNodes = updatedSnapshot.nodes;
            const nodeIndex = freshNodes.findIndex(x => x.id === node.id);
            const nextNode   = freshNodes.find((n, i) =>
                i > nodeIndex &&
                n.stageIdx === node.stageIdx && !n.done
            );
            if (nextNode) {
                niTbWriteAdvancePrompt(node, nextNode);
            } else {
                // 本阶段全部完成，显示完成标记
                niTbShowStageDone(node.stageIdx, updatedSnapshot.stages);
            }
        }
    }
    
    async function niTbUnarchive(idx, nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const node  = list[idx];
        if (!node) return;
        S.tbNodeDone[node.id] = false;
        node.done = false;
        if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
        // 取消归档：清除以该节点为起点的已发送记录，下次完成时重新发首次提示词
        for (const key of _tbAdvanceSent) {
            if (key.startsWith(`${node.id}->`)) _tbAdvanceSent.delete(key);
        }
        document.getElementById(`ni-tb-chk${idx}`)?.classList.remove('checked');
        document.getElementById(`ni-tb-card${idx}`)?.classList.remove('done');
        const updatedSnapshot = niCreateTbSnapshot();
        niTbRefreshNodePanel(updatedSnapshot.nodes);
        niTbSyncStoryBar(updatedSnapshot);
        await niTbSaveState(updatedSnapshot.nodes);
    }
    
    function niTbShowStageDone(stageIdx, stages = null) {
        const track = document.getElementById('ni-tb-track');
        if (!track) return;
        const list     = Array.isArray(stages) ? stages : niGetTbStages();
        const st       = list.find(s => s.stageIdx === stageIdx);
        const existing = document.getElementById('ni-tb-stage-done-badge');
        if (existing) existing.remove();
        const badge = document.createElement('div');
        badge.id        = 'ni-tb-stage-done-badge';
        badge.className = 'ni-tb-stage-done-badge';
        badge.innerHTML = `<i class="ti ti-circle-check" style="color:var(--ni-warning, #c05a62)"></i> 「${niEsc(st ? st.title : `第 ${stageIdx} 阶段`)}」本阶段已全部完成`;
        track.parentElement.insertAdjacentElement('afterend', badge);
    }
    
    // ── AI 推进提示词注入 ────────────────────────────────────────
    
    // 待注入的推进提示词
    let _tbPendingAdvancePrompt = '';
    // 已发送过首次激活提示词的节点对 key 集合
    const _tbAdvanceSent = new Set();

    /**
     * 一键重置全部节点进度：取消所有归档、回到第 1 阶段首个待演节点，
     * 清空推进/开场提示词状态。用于删除聊天记录后重新开玩。
     * confirm=true 时弹原生确认框。
     */
    async function niTbResetProgress({ confirm: needConfirm = true } = {}) {
        const before = niGetTbNodes();
        if (!Array.isArray(before) || !before.length) return { ok: false, reason: 'no-nodes' };
        const doneCount = before.filter(n => n.done).length;
        if (needConfirm) {
            const ok = window.confirm(`确定要重置剧情进度吗？\n将取消 ${doneCount} 个已归档节点，回到第 1 阶段第 1 个节点重新演绎。`);
            if (!ok) return { ok: false, reason: 'cancelled' };
        }
        // 归档状态权威来源是 S.tbNodeDone，清空后重新取节点（全部变为未归档）
        S.tbNodeDone = {};
        const list = niGetTbNodes();
        list.forEach(n => { n.done = false; });
        const targetIdx = Math.max(0, list.findIndex(n => !n.locked));
        const target = list[targetIdx];
        S.tbCurIdx = targetIdx;
        S.tbCurNodeId = target?.id || '';
        S.tbViewIdx = targetIdx;
        S.tbViewNodeId = target?.id || '';
        S.tbViewPinned = false;
        S.tbPaused = false;
        S.tbFrontierStageIdx = Math.max(1, Number(target?.stageIdx) || 1);
        // 清推进/开场提示词，使开场提示词可在重玩时重新注入
        _tbAdvanceSent.clear();
        _tbPendingAdvancePrompt = '';
        document.getElementById('ni-tb-stage-done-badge')?.remove();
        document.getElementById('ni-tb-stage-panel')?.classList.remove('vis');
        document.getElementById('ni-tb-node-panel')?.classList.remove('vis');

        await niTbSaveState(list);

        niTbBuildTrack(list);
        niTbSyncMeta(list);
        niTbRefreshNodePanel(list);
        niTbRebuildStageList(niCreateTbSnapshot(list), { alignActive: true });
        niTbResetViewToCurrent(list);
        niTbAnimateTo(targetIdx, list);
        globalThis.toastr?.success?.(`剧情进度已重置，回到「${target?.title || '第 1 个节点'}」重新开始`);
        console.info('[NI-TB] 剧情进度已重置，取消归档节点数:', doneCount);
        return { ok: true, reset: doneCount };
    }
    window.niTbResetProgress = niTbResetProgress;

    /**
     * 清空消息重开时自动回档：正文已无任何角色扮演消息、且存在已归档节点时，
     * 自动重置进度（不弹确认）；仍有正文或本就没有进度时不动作。
     */
    async function niTbAutoResetIfEmpty() {
        try {
            const ctx = getContext();
            const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
            // chat[0] 通常是开场白/元数据载体，不计入角色扮演正文
            const roleplayMsgs = chat.slice(1).filter(m => m && !m.is_system && String(m.mes || '').trim());
            if (roleplayMsgs.length > 0) return { ok: false, reason: 'has-messages' };
            const list = niGetTbNodes();
            if (!list.length) return { ok: false, reason: 'no-nodes' };
            const doneCount = list.filter(n => n.done).length;
            if (doneCount === 0) return { ok: false, reason: 'no-progress' };
            console.info('[NI-TB] 检测到正文已清空且存在归档节点，自动回档重玩');
            return await niTbResetProgress({ confirm: false });
        } catch (e) {
            console.warn('[NI-TB] 清空自动回档检测失败:', e?.message || e);
            return { ok: false, reason: 'error', error: e?.message || String(e) };
        }
    }
    window.niTbAutoResetIfEmpty = niTbAutoResetIfEmpty;
    
    function niTbWriteAdvancePrompt(nodeA, nodeB) {
        const sentKey = `${nodeA.id}->${nodeB.id}`;
        if (_tbAdvanceSent.has(sentKey)) {
            console.log('[NI-TB] 推进提示词已发送过，跳过重复注入');
            return;
        }
        _tbAdvanceSent.add(sentKey);
        const cfg = extension_settings[EXT_NAME];
        const tpl = (cfg.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT).trim();
        // 函数式替换：正文里的 $&、$'、`$` 等序列若作为字符串替换值会被当成替换模式，
        // 把模板片段重复插入或吞掉字符（自动归档处早已改函数式，这里同步修复）。
        _tbPendingAdvancePrompt = tpl
            .replace(/{A_TITLE}/g,    () => nodeA.title)
            .replace(/{B_TITLE}/g,    () => nodeB.title)
            .replace(/{B_BODY}/g,     () => nodeB.body      || '（暂无描述）')
            .replace(/{B_TIME}/g,     () => nodeB.time      || '不限')
            .replace(/{B_LOCATION}/g, () => nodeB.location  || '不限');
        console.log('[NI-TB] 推进提示词已就绪，等待下次发送生效');
    }
    
    // 开场提示词：故事最开始时注入
    function niTbWriteOpeningPrompt() {
        if (_tbAdvanceSent.has('__opening__')) return;
        _tbAdvanceSent.add('__opening__');
        const cfg = extension_settings[EXT_NAME];
        const nodes = niGetTbNodes();
        const firstNode = nodes.find(n => !n.done && !n.locked);
        if (!firstNode) return;
        const tpl = (cfg.tbOpeningPrompt || TB_DEFAULT_OPENING_PROMPT).trim();
        _tbPendingAdvancePrompt = tpl
            .replace(/{B_TITLE}/g,    () => firstNode.title)
            .replace(/{B_BODY}/g,     () => firstNode.body      || '（暂无描述）')
            .replace(/{B_TIME}/g,     () => firstNode.time      || '不限')
            .replace(/{B_LOCATION}/g, () => firstNode.location  || '不限');
        console.log('[NI-TB] 开场提示词已就绪，等待下次发送生效');
    }
    
    // ── 自由推演 ─────────────────────────────────────────────────
    
    async function niTbGenerateInfer() {
        if (S.tbInferring) return;
        S.tbInferring = true;
    
        const btn       = document.getElementById('ni-tb-btn-free');
        const icon      = document.getElementById('ni-tb-free-icon');
        const label     = document.getElementById('ni-tb-free-label');
        const inferBlock = document.getElementById('ni-tb-infer-block');
        const inferList  = document.getElementById('ni-tb-infer-list');
    
        if (btn)  { btn.classList.add('loading'); btn.classList.remove('has-result'); }
        if (icon) icon.className = 'ti ti-loader ni-tb-spin';
        if (label) label.textContent = '推演中';
        if (inferBlock) inferBlock.classList.remove('vis');
        if (inferList)  { inferList.classList.remove('vis'); inferList.innerHTML = ''; }
    
        try {
            const cfg   = extension_settings[EXT_NAME];
            const nodes = niGetTbNodes();
            const ctx   = getContext();

            // 当前节点
            const curNode = niTbGetInjectionNode(nodes) || nodes[0] || { title: '（未知）', body: '' };
    
            // 角色人设
            const userSubCfg = niGetUserSubConfig();
            const charLines = (S.characters || [])
                .map((c, idx) => ({ c, idx }))
                .filter(({ c, idx }) => c.enabled !== false && c.name && !niIsUserSubReplaceSelectedChar(idx, userSubCfg))
                .slice(0, 8)
                .map(({ c, idx }) => {
                    const isUserSubPlayChar = niIsUserSubSelectedChar(idx, userSubCfg) && niIsUserSubPlayMode(userSubCfg);
                    const parts = [isUserSubPlayChar
                        ? `【<user>（原著角色：${c.name}；${c.role || '其他'}）】`
                        : `【${c.name}（${c.role || '其他'}）】`];
                    const p = niGetCharAiShowEnabled(idx) ? niGetCharAiProfile(idx) : null;
                    if (p && typeof p === 'object') {
                        if (p.identity)    parts.push(`身份：${p.identity}`);
                        if (p.personality) parts.push(`性格：${p.personality}`);
                        if (p.relations)   parts.push(`关系：${p.relations}`);
                    } else {
                        if (c.identity)    parts.push(`身份：${c.identity}`);
                        if (c.personality) parts.push(`性格：${c.personality}`);
                        if (c.relations)   parts.push(`关系：${c.relations}`);
                    }
                    return parts.join('\n');
                });
            const charProfiles = charLines.length
                ? charLines.join('\n\n')
                : '（暂无角色人设数据，请在角色页配置）';
    
            // 最近对话
            const recentMsgs = (ctx?.chat || [])
                .filter(m => m.mes && m.mes.trim())
                .slice(-8)
                .map(m => `${m.is_user ? '[用户]' : '[AI]'} ${m.mes.trim()}`)
                .join('\n');
            const recentChat = recentMsgs || '（暂无对话记录）';
    
            const tpl = (cfg.tbInferPrompt || TB_DEFAULT_INFER_PROMPT).trim();
            // 函数式替换：节点正文/角色资料/聊天记录可能含 $& 等替换模式字符
            const prompt = tpl
                .replace(/{CUR_NODE_TITLE}/g, () => curNode.title)
                .replace(/{CUR_NODE_BODY}/g,  () => curNode.body || '（暂无描述）')
                .replace(/{CHAR_PROFILES}/g,  () => charProfiles)
                .replace(/{RECENT_CHAT}/g,    () => recentChat)
                .replace(/{MSG_COUNT}/g,      () => String(recentMsgs.split('\n').length))
                + niTbGetImmersionAppend(cfg);

            if (inferBlock) {
                inferBlock.dataset.sourceNodeId = curNode.id || '';
                inferBlock.dataset.sourceNodeTitle = curNode.title || '';
            }
    
            const raw = await callCleanApi([{ role: 'user', content: niApplyUserSubstitution(prompt) }]);
    
            // 解析 JSON，兼容带 ```json 包裹的情况
            let data;
            try {
                const cleaned = raw.replace(/```json|```/gi, '').trim();
                data = JSON.parse(cleaned);
            } catch (pe) {
                throw new Error('推演结果解析失败：' + pe.message);
            }
    
            if (!Array.isArray(data)) throw new Error('返回格式不是数组');
            data = data.map(item => ({
                ...item,
                title: niApplyUserSubstitution(item.title || ''),
                desc: niApplyUserSubstitution(item.desc || item.description || ''),
                description: niApplyUserSubstitution(item.description || item.desc || ''),
            }));
    
            // 保存结果供弹窗读取
            S.tbLastInfer = data;
    
            if (inferList) {
                inferList.innerHTML = '';
                data.forEach((d, i) => {
                    const item = document.createElement('div');
                    item.className = 'ni-tb-infer-item ni-tb-fade-in';
                    item.dataset.desc = d.desc || d.description || '';
                    item.innerHTML = `
                      <div class="ni-tb-infer-num">${i + 1}</div>
                      <div class="ni-tb-infer-content">
                        <span class="ni-tb-infer-tag ni-tb-tag-${niEsc(d.tag || 'canon')}">${niEsc(d.tagLabel || d.tag)}</span>
                        <div class="ni-tb-infer-title">${niEsc(d.title)}</div>
                        <div class="ni-tb-infer-desc">${niEsc(d.desc)}</div>
                      </div>`;
                    inferList.appendChild(item);
                });
                inferList.classList.add('vis');
            }
    
            if (inferBlock) inferBlock.classList.add('vis');
            if (btn)  { btn.classList.remove('loading'); btn.classList.add('has-result'); }
            if (icon) icon.className = 'ti ti-refresh';
            if (label) label.textContent = '推演';
    
        } catch (err) {
            console.error('[NI-TB] 推演失败:', err);
            if (inferList) {
                inferList.innerHTML = `<div style="padding:14px 16px;font-size:12px;color:var(--color-text-tertiary)">推演失败：${niEsc(err.message)}</div>`;
                inferList.classList.add('vis');
            }
            if (inferBlock) inferBlock.classList.add('vis');
            if (btn)  btn.classList.remove('loading');
            if (icon) icon.className = 'ti ti-chart-line';
            if (label) label.textContent = '推演';
        } finally {
            S.tbInferring = false;
        }
    }
    
    // ── 剧情自动归档 ─────────────────────────────────────────────

    let _tbAutoArchiving = false;
    let _tbAutoArchiveErrToastAt = 0;
    // 冷却/退避记账：_tbLastArchiveRunAt 为上次实际发起判定的时间（冷却基准），
    // _tbLastArchiveAiCount 为上次判定时 AI 消息数（退避基准），_tbZeroArchiveStreak
    // 为连续「判定成功但 0 归档」的次数，成功归档后归零。
    let _tbLastArchiveRunAt = 0;
    let _tbLastArchiveAiCount = 0;
    let _tbZeroArchiveStreak = 0;
    const TB_ARCHIVE_MSG_CLIP = 1200;  // 判定 prompt 内单条剧情截断长度
    const TB_ARCHIVE_BODY_CLIP = 800;  // 判定 prompt 内节点描述截断长度
    function _tbClipText(value, max) {
        const s = String(value ?? '').trim();
        return s.length > max ? s.slice(0, max) + ' …（后略）' : s;
    }
    function _tbAutoArchiveWarn(msg) {
        const now = Date.now();
        if (now - _tbAutoArchiveErrToastAt > 60000) {
            _tbAutoArchiveErrToastAt = now;
            globalThis.toastr?.warning?.(msg);
        }
    }

    /**
     * 根据最近剧情，调用清洗模型判定当前阶段内哪些待演节点已被完整演绎并自动归档。
     * 规则：保守判定、严格按顺序归档（遇到第一个未完成节点即停止，不跳过）；
     * 仅在当前阶段内自动推进，跨阶段仍由用户手动切换。
     * 成本守卫：默认 30 秒冷却（tbAutoArchiveCooldownSec，0 关闭）；连续 3 次判定无归档
     * 后启动退避，需积压 2/4/6/8（封顶）条新 AI 消息才再次判定。force 全绕过；
     * bypassCooldown 只绕过冷却与退避（供调度器补判链使用），仍受开关/暂停/并发锁约束。
     * 返回 { ok, archived, reason?, stageDone? }，失败不影响正文。
     */
    async function niTbAutoArchive({ force = false, bypassCooldown = false } = {}) {
        const cfg = extension_settings[EXT_NAME] || {};
        if (!force && (!cfg?.transBookMode || !cfg.tbAutoArchive)) return { ok: false, reason: 'disabled' };
        if (!force && S.tbPaused) return { ok: false, reason: 'paused' };
        if (_tbAutoArchiving) return { ok: false, reason: 'running' };
        if (typeof callCleanApi !== 'function') return { ok: false, reason: 'no-api' };

        const nodes = niGetTbNodes();
        if (!Array.isArray(nodes) || !nodes.length) return { ok: false, reason: 'no-nodes' };

        // 当前真正参与注入的节点（阶段内第一个未归档、未锁定）
        const anchorNode = niTbGetInjectionNode(nodes);
        if (!anchorNode || anchorNode.done || anchorNode.locked) {
            return { ok: false, reason: 'nothing-pending' };
        }
        const startIdx = nodes.findIndex(n => n.id === anchorNode.id);
        if (startIdx < 0) return { ok: false, reason: 'nothing-pending' };

        // 同阶段内、从当前节点起的连续待演候选（限定窗口，避免对远期剧情误判）
        let _tbWin = parseInt(cfg.tbAutoArchiveWindow, 10);
        // 旧版本默认窗口 5 偏小，未自定义过时升级到 10，一次核对更多节点
        if (!Number.isFinite(_tbWin) || _tbWin === 5) _tbWin = 10;
        const WINDOW = Math.max(1, _tbWin);
        const candidates = [];
        for (let i = startIdx; i < nodes.length && candidates.length < WINDOW; i++) {
            const n = nodes[i];
            if (n.stageIdx !== anchorNode.stageIdx) break;
            if (!n.done && !n.locked) candidates.push({ node: n, idx: i });
        }
        if (!candidates.length) return { ok: false, reason: 'nothing-pending' };

        // ── 冷却与退避：闲聊空转时压低清洗模型消耗（force / 补判链可绕过）──
        const ctx0 = getContext();
        const validMsgs = ((ctx0?.chat || []).filter(m => m && m.mes && String(m.mes).trim()));
        const aiMsgCount = validMsgs.reduce((n, m) => n + (m.is_user ? 0 : 1), 0);
        if (!force && !bypassCooldown && _tbLastArchiveRunAt > 0) {
            let cdSec = parseInt(cfg.tbAutoArchiveCooldownSec, 10);
            if (!Number.isFinite(cdSec) || cdSec < 0) cdSec = 30;
            if (cdSec > 0 && Date.now() - _tbLastArchiveRunAt < cdSec * 1000) {
                console.info(`[NI-TB] 自动归档：冷却期内，跳过本次判定（${cdSec}s 内不重复调用清洗模型）`);
                return { ok: false, reason: 'cooldown' };
            }
        }
        const TB_BACKOFF_AFTER = 3; // 连续 3 次判定无归档后启动退避
        if (!force && !bypassCooldown && _tbZeroArchiveStreak >= TB_BACKOFF_AFTER) {
            // 空转越久，要求积压的新 AI 消息越多：2/4/6/8 封顶
            const needNew = Math.min(2 * (_tbZeroArchiveStreak - TB_BACKOFF_AFTER + 1), 8);
            const sinceLast = aiMsgCount - _tbLastArchiveAiCount;
            if (sinceLast < needNew) {
                console.info(`[NI-TB] 自动归档：退避中（连续 ${_tbZeroArchiveStreak} 次无归档），距上次判定仅新增 ${sinceLast} 条 AI 消息，需 ${needNew} 条`);
                return { ok: false, reason: 'backoff' };
            }
        }

        console.info(`[NI-TB] 自动归档：开始判定，当前节点「${anchorNode.title}」，候选 ${candidates.length} 个，模型=${cfg.cleanModel || '（未配置）'}`);
        _tbAutoArchiving = true;
        try {
            // 单条剧情与节点描述截断，避免长回复场景下一次判定的输入膨胀到数万 token
            const recentChat = validMsgs.slice(-20)
                .map(m => `${m.is_user ? '[用户]' : '[AI]'} ${_tbClipText(m.mes, TB_ARCHIVE_MSG_CLIP)}`)
                .join('\n') || '（暂无对话记录）';

            const candidateText = candidates.map((c, i) => {
                const n = c.node;
                let t = `节点 ${i + 1}｜${n.title}\n${_tbClipText(n.body || '（无描述）', TB_ARCHIVE_BODY_CLIP)}`;
                if (n.time) t += `\n时间：${n.time}`;
                if (n.location) t += `\n地点：${n.location}`;
                return t;
            }).join('\n\n---\n\n');

            const tpl = (cfg.tbAutoArchivePrompt || TB_DEFAULT_AUTO_ARCHIVE_PROMPT).trim();
            const deviationCtx = String(getDeviationContext() || '').trim();
            // 用函数式替换，避免正文里的 $& / $1 等被当作替换模式
            let prompt = tpl
                .replace('{CUR_NODE_TITLE}', () => anchorNode.title || '')
                .replace('{CUR_NODE_BODY}', () => _tbClipText(anchorNode.body || '（暂无描述）', TB_ARCHIVE_BODY_CLIP))
                .replace('{CANDIDATE_NODES}', () => candidateText)
                .replace('{RECENT_CHAT}', () => recentChat)
                .replace('{MSG_COUNT}', () => String(Math.min(20, validMsgs.length)))
                .replace('{DEVIATION}', () => deviationCtx || '（暂无偏差档案）');
            // 兼容旧版/自定义提示词：没有 {DEVIATION} 占位符时，有内容才追加分支现实参考
            if (!/\{DEVIATION\}/.test(tpl) && deviationCtx) {
                prompt += `\n\n【当前分支现实（剧情相对原著的偏离，供判定"等价达成"时对照）】\n${deviationCtx}`;
            }

            // 记账：从这一刻起确实消耗一次清洗请求，作为冷却/退避的基准
            _tbLastArchiveRunAt = Date.now();
            _tbLastArchiveAiCount = aiMsgCount;

            // 判定是几十秒的长请求：先记下聊天身份与归档状态快照，返回后校验，
            // 避免等待期间用户切换聊天或手动归档/取消归档时，被这次旧结果覆盖。
            const chatIdAtStart = String(getCurrentChatId() || '');
            const doneSnapshotAtStart = { ...(S.tbNodeDone || {}) };

            const raw = await callCleanApi([{ role: 'user', content: niApplyUserSubstitution(prompt) }]);

            if (String(getCurrentChatId() || '') !== chatIdAtStart) {
                console.warn('[NI-TB] 自动归档：判定期间已切换聊天，本次结果丢弃（不写入任何进度）');
                return { ok: false, reason: 'chat-changed' };
            }

            // 解析 {"completed": [编号...]}，兼容裸数组 / 代码块包裹 / 对象数组
            let completed = [];
            let evidenceMap = {};
            try {
                let text = String(raw || '').replace(/```json|```/gi, '').trim();
                const s = text.indexOf('{');
                const e = text.lastIndexOf('}');
                if (s >= 0 && e > s) text = text.slice(s, e + 1);
                const data = JSON.parse(text);
                let arr = Array.isArray(data) ? data : null;
                if (!arr && data && typeof data === 'object') {
                    // 兼容不同模型可能使用的字段名
                    for (const k of ['completed','completed_nodes','completedNodes','done','archived','finished','nodes','result','data']) {
                        if (Array.isArray(data[k])) { arr = data[k]; break; }
                    }
                    // 兜底：取对象中任意一个数组字段
                    if (!arr) arr = Object.values(data).find(v => Array.isArray(v)) || [];
                }
                arr = arr || [];
                completed = arr
                    .map(x => typeof x === 'number' ? x
                        : (x && typeof x === 'object'
                            ? (x.index ?? x.no ?? x.number ?? x.node ?? x.nodeIndex ?? x.id)
                            : x))
                    .map(x => parseInt(x, 10))
                    .filter(x => Number.isFinite(x) && x >= 1 && x <= candidates.length);
                // 收集每个完成节点的判定证据（evidence 字段），用于控制台留痕与复盘
                arr.forEach(x => {
                    if (x && typeof x === 'object' && x.evidence != null) {
                        const idx = parseInt(x.index ?? x.no ?? x.number ?? x.node ?? x.nodeIndex ?? x.id, 10);
                        if (Number.isFinite(idx) && idx >= 1 && idx <= candidates.length) {
                            evidenceMap[idx] = String(x.evidence).slice(0, 200);
                        }
                    }
                });
            } catch (pe) {
                console.warn('[NI-TB] 自动归档：结果解析失败', pe.message, '| 原始返回前300字:', String(raw || '').slice(0, 300));
                _tbAutoArchiveWarn('剧情自动归档：模型未返回可识别的 JSON，本次跳过（详见控制台）');
                return { ok: false, reason: 'parse-error' };
            }

            // 顺序归档：从候选 1 起连续命中，遇到第一个未完成即停止
            const doneSet = new Set(completed);
            let run = 0;
            for (let i = 1; i <= candidates.length; i++) {
                if (doneSet.has(i)) run = i;
                else break;
            }
            if (run === 0) {
                _tbZeroArchiveStreak++;
                console.info(`[NI-TB] 自动归档：本轮无节点达到归档条件（连续 ${_tbZeroArchiveStreak} 次无归档）`);
                return { ok: true, archived: 0 };
            }
            // 防呆：一次判定把全部候选都判成完成，几乎都是"剧情跑偏被误判为已演完"，
            // 直接归档会吞掉整个剩余阶段；拒绝本轮并提示，确需跳过时请在节点面板手动归档。
            if (run === candidates.length && candidates.length >= 4) {
                console.warn(`[NI-TB] 自动归档：模型把全部 ${candidates.length} 个候选节点判为完成，判定可疑，本轮跳过（当前节点「${anchorNode.title}」）`);
                _tbAutoArchiveWarn(`剧情自动归档：本次判定把全部 ${candidates.length} 个待演节点都判成"已演完"，疑似把剧情偏离误判为演完，已跳过本次归档；如确认要跳过这些节点请在节点面板手动归档。`);
                return { ok: false, reason: 'suspicious-all-completed' };
            }
            _tbZeroArchiveStreak = 0;

            const archivedNodes = candidates.slice(0, run).map(c => c.node);
            const lastArchived = archivedNodes[archivedNodes.length - 1];
            console.info(`[NI-TB] 自动归档：本轮归档 ${run} 个节点：${archivedNodes.map(n => `「${n.title}」`).join('、')}`);
            archivedNodes.forEach((n, i) => {
                const ev = evidenceMap[i + 1];
                if (ev) console.info(`[NI-TB] 自动归档：  └ 节点「${n.title}」判定证据：${ev}`);
            });

            // 用最新节点数据落地完成状态（镜像 archivePrior 的写法）
            const fresh = niGetTbNodes();
            archivedNodes.forEach(src => {
                const live = fresh.find(n => n.id === src.id);
                if (!live || live.done || live.locked) return;
                // 判定期间该节点被用户手动改动（归档/取消归档）时不再自动落地，避免覆盖手动操作
                const before = !!(doneSnapshotAtStart[live.id] ?? doneSnapshotAtStart[live.legacyId]);
                const now = !!(S.tbNodeDone || {})[live.id] || !!(S.tbNodeDone || {})[live.legacyId];
                if (before !== now) {
                    console.info(`[NI-TB] 自动归档：节点「${live.title}」在判定期间被手动改动，跳过本次自动落地`);
                    return;
                }
                S.tbNodeDone[live.id] = true;
                if (live.legacyId && live.legacyId !== live.id) delete S.tbNodeDone[live.legacyId];
                live.done = true;
            });

            // 新的当前节点：优先窗口内紧随其后的候选，否则在同阶段剩余节点里找
            let newCurNode = candidates[run] ? candidates[run].node : null;
            if (newCurNode) {
                const liveNext = fresh.find(n => n.id === newCurNode.id);
                if (!liveNext || liveNext.done || liveNext.locked) newCurNode = null;
            }
            if (!newCurNode) {
                const lastIdx = fresh.findIndex(n => n.id === lastArchived.id);
                newCurNode = fresh.slice(lastIdx + 1)
                    .find(n => n.stageIdx === anchorNode.stageIdx && !n.done && !n.locked) || null;
            }

            let targetId = newCurNode ? newCurNode.id : lastArchived.id;
            const targetIdx = fresh.findIndex(n => n.id === targetId);
            if (targetIdx >= 0) {
                niTbSetCurrentIdx(targetIdx, fresh, { persist: false, archivePrior: false });
            }

            // 推进提示词（切到下一节点）；阶段演完则按开关决定跨阶段自动推进或停在阶段末
            let stageAdvanced = null;
            if (newCurNode) {
                niTbWriteAdvancePrompt(lastArchived, newCurNode);
            } else if (cfg.tbAutoStageAdvance !== false) {
                // 当前阶段已全部演完：定位下一个含待演节点的阶段并自动进入（与手动跨阶段一致）
                const stageIdxs = [...new Set(fresh.map(n => Number(n.stageIdx)))]
                    .filter(v => Number.isFinite(v))
                    .sort((a, b) => a - b);
                const nextStageIdx = stageIdxs.find(si => si > anchorNode.stageIdx
                    && fresh.some(n => Number(n.stageIdx) === si && !n.done && !n.locked));
                if (nextStageIdx != null) {
                    const nextNode = fresh.find(n => Number(n.stageIdx) === nextStageIdx && !n.done && !n.locked);
                    const nextIdx = fresh.findIndex(n => n.id === nextNode?.id);
                    if (nextNode && nextIdx >= 0) {
                        niTbSetCurrentIdx(nextIdx, fresh, { persist: false, archivePrior: true });
                        niTbWriteAdvancePrompt(lastArchived, nextNode);
                        newCurNode = nextNode;
                        targetId = nextNode.id;
                        const advSnap = niCreateTbSnapshot(fresh);
                        const advStage = advSnap.stages.find(s => Number(s.stageIdx) === nextStageIdx);
                        stageAdvanced = { stageIdx: nextStageIdx, title: advStage?.title || `第 ${nextStageIdx} 阶段`, node: nextNode.title };
                        niTbRebuildStageList(advSnap, { alignActive: true });
                    }
                }
                if (!newCurNode) {
                    const snap = niCreateTbSnapshot(fresh);
                    niTbShowStageDone(anchorNode.stageIdx, snap.stages);
                }
            } else {
                const snap = niCreateTbSnapshot(fresh);
                niTbShowStageDone(anchorNode.stageIdx, snap.stages);
            }

            await niTbSaveState(fresh);

            // 刷新时间线与节点面板
            niTbBuildTrack(fresh);
            niTbSyncMeta(fresh);
            niTbRefreshNodePanel(fresh);
            const animateIdx = fresh.findIndex(n => n.id === targetId);
            if (animateIdx >= 0) niTbAnimateTo(animateIdx, fresh);

            console.info(`[NI-TB] 自动归档：已归档 ${archivedNodes.length} 个节点 ->`,
                archivedNodes.map(n => n.title), stageAdvanced
                    ? `（跨阶段进入：${stageAdvanced.title} / ${stageAdvanced.node}）`
                    : newCurNode ? `（进入：${newCurNode.title}）` : '（本阶段已全部完成）');
            const _archiveToast = stageAdvanced
                ? `本阶段已演完，自动进入「${stageAdvanced.title}」，注入「${stageAdvanced.node}」`
                : `剧情自动归档 ${archivedNodes.length} 个节点${newCurNode ? `，进入「${newCurNode.title}」` : '，本阶段已全部完成'}`;
            globalThis.toastr?.success?.(_archiveToast);
            return {
                ok: true,
                archived: archivedNodes.length,
                nodes: archivedNodes.map(n => n.title),
                stageDone: !newCurNode && !stageAdvanced,
                stageAdvanced: stageAdvanced || null,
            };
        } catch (err) {
            console.warn('[NI-TB] 自动归档失败（不影响正文）:', err?.message || err);
            _tbAutoArchiveWarn(`剧情自动归档请求失败：${err?.message || err}`);
            return { ok: false, reason: 'error', error: err?.message || String(err) };
        } finally {
            _tbAutoArchiving = false;
        }
    }
    window.niTbAutoArchive = niTbAutoArchive;

    // ── 状态栏挂载 / 卸载 ────────────────────────────────────────
    
    // ── 将状态栏 CSS 注入到 document.head──────────
    function niTbInjectCSS() {
        if (document.getElementById('ni-tb-injected-css')) return;
        const style = document.createElement('style');
        style.id = 'ni-tb-injected-css';
        style.textContent = `.ni-tb-shell{background:var(--color-background-secondary,#f7f7f8);border-radius:16px;overflow:hidden;border:0.5px solid var(--color-border-tertiary,#e8e8ec);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;user-select:none;margin:8px 0}
    .ni-tb-bar{display:flex;align-items:center;gap:6px;padding:9px 14px;cursor:pointer;background:var(--color-background-primary,#fff);border-bottom:0.5px solid transparent;transition:border-color .25s}
    .ni-tb-bar.open{border-bottom-color:var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-pin{width:6px;height:6px;border-radius:50%;background:#e8848a;flex-shrink:0}
    .ni-tb-status{font-size:10px;font-weight:500;padding:1px 6px;border-radius:20px;background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62);flex-shrink:0;white-space:nowrap}
    .ni-tb-curtitle{font-size:13px;font-weight:500;color:var(--color-text-primary,#1a1a1a);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ni-tb-meta{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);white-space:nowrap;flex-shrink:0}
    .ni-tb-chevron{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);transition:transform .35s cubic-bezier(.34,1.56,.64,1);margin-left:2px;flex-shrink:0}
    .ni-tb-chevron.open{transform:rotate(180deg)}
    .ni-tb-body{max-height:0;overflow:hidden;transition:max-height .52s cubic-bezier(.4,0,.2,1)}
    .ni-tb-body.open{max-height:1400px}
    .ni-tb-selrow{display:flex;align-items:center;gap:8px;padding:0 16px;height:35px;box-sizing:border-box;background:var(--color-background-primary,#fff);flex-wrap:nowrap}
    .ni-tb-sel-btn{display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);background:var(--color-background-secondary,#f7f7f8);font-size:11px;color:var(--color-text-secondary,#5a5a6a);cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .ni-tb-sel-btn:hover{background:var(--color-background-tertiary,#eeeeef)}
    .ni-tb-sel-sep{font-size:14px;color:var(--color-border-secondary,#d8d8de);flex-shrink:0}
    .ni-tb-sel-spacer{flex:1}
    .ni-tb-btn-free{display:flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);background:var(--color-background-secondary,#f7f7f8);font-size:11px;color:var(--color-text-secondary,#5a5a6a);cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-free:hover:not(.loading){background:var(--color-background-tertiary,#eeeeef)}
    .ni-tb-btn-free.loading{opacity:.6;pointer-events:none}
    .ni-tb-btn-free.has-result{border-color:var(--ni-warning-alpha-30, rgba(208,100,110,.3));background:var(--ni-warning-alpha-06, rgba(208,100,110,.06));color:var(--ni-warning, #c05a62)}
    .ni-tb-btn-free.has-result:hover{background:var(--ni-warning-alpha-12, rgba(208,100,110,.12))}
    .ni-tb-btn-pause{display:flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--ni-warning-alpha-25, rgba(208,100,110,.25));background:var(--ni-warning-alpha-06, rgba(208,100,110,.06));font-size:11px;color:var(--ni-warning, #c05a62);cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-pause:hover{background:var(--ni-warning-alpha-12, rgba(208,100,110,.12))}
    .ni-tb-btn-pause.paused{background:var(--ni-warning-alpha-14, rgba(208,100,110,.14));border-color:var(--ni-warning-alpha-40, rgba(208,100,110,.4))}
    .ni-tb-drop-panel{display:none;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-drop-panel.vis{display:block}
    .ni-tb-sp-label{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);letter-spacing:.06em;padding:8px 16px 4px;display:block}
    .ni-tb-sp-list{display:flex;flex-direction:column;padding-bottom:6px;max-height:141px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--color-border-secondary,#d8d8de) var(--color-background-primary,#fff);box-sizing:border-box}
    .ni-tb-sp-list::-webkit-scrollbar{width:6px}
    .ni-tb-sp-list::-webkit-scrollbar-track{background:var(--color-background-primary,#fff);border-left:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-sp-list::-webkit-scrollbar-thumb{background:var(--color-border-secondary,#d8d8de);border-radius:6px;border:1px solid var(--color-background-primary,#fff)}
    .ni-tb-sp-list::-webkit-scrollbar-thumb:hover{background:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-sp-row{display:flex;align-items:center;gap:8px;padding:7px 16px;cursor:pointer;transition:background .15s}
    .ni-tb-sp-row:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-sp-row.active-stage .ni-tb-sp-name{color:var(--ni-warning, #c05a62);font-weight:500}
    .ni-tb-sp-row.active-stage .ni-tb-sp-dot{background:#e8848a}
    .ni-tb-sp-page.ni-list-pagination{position:sticky;top:0;z-index:2}
    .ni-tb-sp-dot{width:5px;height:5px;border-radius:50%;background:var(--color-border-secondary,#d8d8de);flex-shrink:0}
    .ni-tb-sp-name{font-size:12px;color:var(--color-text-secondary,#5a5a6a)}
    #ni-tb-node-panel{max-height:244px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--color-border-secondary,#d8d8de) var(--color-background-primary,#fff)}
    #ni-tb-node-panel::-webkit-scrollbar{width:6px}
    #ni-tb-node-panel::-webkit-scrollbar-track{background:var(--color-background-primary,#fff);border-left:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    #ni-tb-node-panel::-webkit-scrollbar-thumb{background:var(--color-border-secondary,#d8d8de);border-radius:6px;border:1px solid var(--color-background-primary,#fff)}
    #ni-tb-node-panel::-webkit-scrollbar-thumb:hover{background:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-section-hd{display:flex;align-items:center;gap:7px;padding:8px 16px;cursor:pointer;transition:background .15s;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-section-hd:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-section-icon{font-size:12px;color:var(--color-text-tertiary,#9a9aaa);transition:transform .2s;flex-shrink:0}
    .ni-tb-section-icon.open{transform:rotate(90deg)}
    .ni-tb-section-label{font-size:11px;font-weight:500;color:var(--color-text-secondary,#5a5a6a);flex:1}
    .ni-tb-section-count{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);background:var(--color-background-secondary,#f7f7f8);padding:1px 7px;border-radius:20px;border:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-section-count.done-count{background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62);border-color:var(--ni-warning-alpha-20, rgba(208,100,110,.2))}
    .ni-tb-np-list{display:none;flex-direction:column;padding:4px 0}
    .ni-tb-np-list.vis{display:flex}
    .ni-tb-np-row{display:flex;align-items:center;gap:10px;padding:7px 16px 7px 32px;cursor:pointer;transition:background .15s}
    .ni-tb-np-row:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-np-row.active{background:var(--ni-warning-soft-2, #fff5f6)}
    .ni-tb-np-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
    .ni-tb-np-dot.done{background:#e8848a}
    .ni-tb-np-dot.active-dot{background:#e8848a;box-shadow:0 0 0 3px rgba(232,132,138,.2)}
    .ni-tb-np-dot.todo{background:var(--color-border-secondary,#d8d8de)}
    .ni-tb-np-title{font-size:11px;color:var(--color-text-secondary,#5a5a6a);flex:1}
    .ni-tb-np-row.active .ni-tb-np-title{color:var(--color-text-primary,#1a1a1a);font-weight:500}
    .ni-tb-np-row.done-row .ni-tb-np-title{text-decoration:line-through;opacity:.45}
    .ni-tb-np-more{border:0;padding:8px 16px;background:transparent;color:var(--ni-warning,#c05a62);font-size:10px;cursor:pointer;text-align:center}
    .ni-tb-np-type{font-size:9px;padding:1px 5px;border-radius:8px;flex-shrink:0}
    .ni-tb-np-type.main{background:var(--ni-primary-soft, #F5E6EC);color:var(--ni-primary-soft-text, #8B3A50)}
    .ni-tb-np-type.sub{background:var(--ni-success-soft, #E1F5EE);color:var(--ni-success-text, #0F6E56)}
    .ni-tb-np-type.pivot{background:var(--ni-pivot-soft, #FCF7FB);color:var(--ni-pivot-text, #7C5071)}
    .ni-tb-carousel-wrap{padding:14px 0;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec);position:relative;overflow:hidden;height:200px;transform:translateZ(0)}
    .ni-tb-track{position:absolute;top:0;left:0;height:100%;width:100%}
    .ni-tb-scard{position:absolute;top:14px;height:160px;border-radius:12px;border:0.5px solid var(--color-border-tertiary,#e8e8ec);background:var(--color-background-primary,#fff);padding:13px 14px;overflow:hidden;cursor:pointer;backface-visibility:hidden;transition:left .4s cubic-bezier(.4,0,.2,1),width .4s cubic-bezier(.4,0,.2,1),opacity .4s ease,box-shadow .3s,border-color .3s,background .3s}
    .ni-tb-scard.active{border-color:var(--ni-warning-alpha-35, rgba(208,100,110,.35));background:var(--ni-warning-soft-2, #fff9f9);box-shadow:0 6px 24px var(--ni-warning-alpha-14, rgba(208,100,110,.14));z-index:2;cursor:default;padding-top:3px;padding-bottom:3px;height:auto;min-height:166px}
    .ni-tb-scard.side-prev,.ni-tb-scard.side-next{opacity:.52;background:var(--color-background-secondary,#f7f7f8);z-index:1}
    .ni-tb-scard.far{opacity:.15;background:var(--color-background-secondary,#f7f7f8);z-index:0;pointer-events:none}
    .ni-tb-scard-overlay{display:none;position:absolute;inset:0;border-radius:12px;cursor:pointer;background:rgba(248,235,237,.72);flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:background .2s}
    .ni-tb-scard.done .ni-tb-scard-overlay{display:flex}
    .ni-tb-scard-overlay:hover{background:rgba(242,218,220,.9)}
    .ni-tb-done-badge{font-size:10px;font-weight:500;color:var(--ni-warning, #c05a62);background:var(--ni-warning-soft, #fde8ea);padding:3px 10px;border-radius:20px;border:0.5px solid var(--ni-warning-alpha-30, rgba(208,100,110,.3));pointer-events:none;transition:opacity .2s}
    .ni-tb-unarchive-hint{font-size:9px;color:rgba(192,90,98,.65);opacity:0;transition:opacity .2s;pointer-events:none}
    .ni-tb-scard-overlay:hover .ni-tb-done-badge{opacity:.5}
    .ni-tb-scard-overlay:hover .ni-tb-unarchive-hint{opacity:1}
    .ni-tb-scard:not(.active) .ni-tb-sc-check{pointer-events:none;opacity:0}
    .ni-tb-scard:not(.active) .ni-tb-scard-overlay:hover{background:rgba(248,235,237,.72)}
    .ni-tb-sc-num{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);margin-bottom:3px;display:flex;align-items:center;gap:4px;min-width:0;padding-right:28px;white-space:nowrap}
    .ni-tb-sc-num-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--color-text-secondary,#5a5a6a)}
    .ni-tb-sc-type{display:inline-block;font-size:9px;font-weight:500;padding:1px 6px;border-radius:10px;margin-bottom:8px}
    .ni-tb-sc-type.main{background:var(--ni-primary-soft, #F5E6EC);color:var(--ni-primary-soft-text, #8B3A50)}
    .ni-tb-sc-type.sub{background:var(--ni-success-soft, #E1F5EE);color:var(--ni-success-text, #0F6E56)}
    .ni-tb-sc-type.pivot{background:var(--ni-pivot-soft, #FCF7FB);color:var(--ni-pivot-text, #7C5071)}
    .ni-tb-sc-title{font-size:12px;font-weight:500;color:var(--color-text-primary,#1a1a1a);line-height:1.4;margin-bottom:5px}
    .ni-tb-sc-desc{font-size:10px;color:var(--color-text-secondary,#5a5a6a);line-height:1.4;overflow:hidden}.ni-tb-sc-extras{display:flex;flex-direction:column;gap:1px;margin-top:3px;overflow:hidden}.ni-tb-sc-event,.ni-tb-sc-fore{display:flex;align-items:center;gap:2px;font-size:10px;line-height:1.35;color:var(--color-text-tertiary,#9a9aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ni-tb-sc-event i{font-size:9px;color:var(--ni-warning-alpha-50, rgba(208,100,110,.5));flex-shrink:0}.ni-tb-sc-fore i{font-size:9px;color:rgba(120,100,200,.5);flex-shrink:0}
    .ni-tb-sc-check{position:absolute;top:10px;right:10px;width:15px;height:15px;border-radius:50%;border:0.5px solid rgba(160,68,94,.3);background:var(--color-background-secondary,#f7f7f8);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;z-index:3}
    .ni-tb-sc-check.checked{background:var(--ni-warning-soft, #fde8ea);border-color:var(--ni-warning-alpha-50, rgba(208,100,110,.5))}
    .ni-tb-sc-check i{font-size:9px;color:transparent;transition:color .2s}
    .ni-tb-sc-check.checked i{color:var(--ni-primary, #A0445E)!important;text-shadow:none!important}
    .ni-tb-stage-done-badge{display:flex;align-items:center;justify-content:center;gap:5px;padding:10px 16px;font-size:11px;color:var(--ni-warning, #c05a62);background:var(--ni-warning-soft-2, #fff5f6);border-top:0.5px solid var(--ni-warning-alpha-15, rgba(208,100,110,.15))}
    .ni-tb-infer-block{display:none;flex-direction:column;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-infer-block.vis{display:flex}
    .ni-tb-infer-toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;transition:background .15s;border-bottom:0.5px solid transparent}
    .ni-tb-infer-toggle.expanded{border-bottom-color:var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-infer-toggle:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-infer-toggle-label{font-size:11px;color:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-infer-toggle-icon{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);opacity:.5;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}
    .ni-tb-infer-toggle-icon.expanded{transform:rotate(180deg)}
    .ni-tb-infer-list{display:none;flex-direction:column}
    .ni-tb-infer-list.vis{display:flex}
    .ni-tb-infer-item{display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec);transition:background .15s;cursor:pointer}
    .ni-tb-infer-item:last-child{border-bottom:none}
    .ni-tb-infer-item:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-infer-num{flex-shrink:0;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;background:var(--color-background-secondary,#f7f7f8);border:0.5px solid var(--color-border-secondary,#d8d8de);color:var(--color-text-tertiary,#9a9aaa);margin-top:1px}
    .ni-tb-infer-content{flex:1;min-width:0}
    .ni-tb-infer-tag{display:inline-block;font-size:9px;font-weight:500;padding:1px 7px;border-radius:10px;margin-bottom:5px}
    .ni-tb-tag-canon{background:#eef5ff;color:#185fa5}
    .ni-tb-tag-diverge{background:#fff8e6;color:#854f0b}
    .ni-tb-tag-break{background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62)}
    .ni-tb-infer-title{font-size:12px;font-weight:500;color:var(--color-text-primary,#1a1a1a);margin-bottom:4px;line-height:1.4}
    .ni-tb-infer-desc{font-size:11px;color:var(--color-text-secondary,#5a5a6a);line-height:1.6}
    .ni-tb-icon-only{padding:5px 10px !important;min-width:32px;justify-content:center}
    @keyframes ni-tb-spin{to{transform:rotate(360deg)}}
    .ni-tb-spin{animation:ni-tb-spin .8s linear infinite}
    @keyframes ni-tb-fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .ni-tb-fade-in{animation:ni-tb-fadeUp .32s ease both}
    .ni-tb-fade-in:nth-child(1){animation-delay:.04s}
    .ni-tb-fade-in:nth-child(2){animation-delay:.14s}
    .ni-tb-fade-in:nth-child(3){animation-delay:.24s}`;
        document.head.appendChild(style);
    }
    
    function niTbClearLazyPanels() {
        const stageList = document.getElementById('ni-tb-stage-list');
        const nodePanel = document.getElementById('ni-tb-node-panel');
        const track = document.getElementById('ni-tb-track');
        if (stageList) stageList.innerHTML = '';
        if (nodePanel) nodePanel.innerHTML = '';
        if (track) track.innerHTML = '';
        _tbNodePanelStageIdx = null;
        _tbNodePanelLimits.done = TB_NODE_BATCH_SIZE;
        _tbNodePanelLimits.todo = TB_NODE_BATCH_SIZE;
    }

    function niTbCollapseStoryBar({ clearLazy = false } = {}) {
        document.getElementById('ni-tb-body-wrap')?.classList.remove('open');
        document.getElementById('ni-tb-bar')?.classList.remove('open');
        document.getElementById('ni-tb-chevron')?.classList.remove('open');
        document.getElementById('ni-tb-stage-panel')?.classList.remove('vis');
        document.getElementById('ni-tb-node-panel')?.classList.remove('vis');
        if (clearLazy) niTbClearLazyPanels();
    }

    function niTbSyncStoryBar(snapshot) {
        const nodes = snapshot?.nodes || [];
        if (!nodes.length) return;
        niTbReconcileCurrentNode(nodes);
        const curNode = nodes[S.tbCurIdx] || nodes[0];
        const viewNode = nodes[S.tbViewIdx] || curNode;
        const stageView = niTbStageView(nodes, S.tbViewIdx);
        const status = document.querySelector?.('#ni-storybar .ni-tb-status');
        if (status) status.textContent = snapshot.doneCount === nodes.length ? '全部完成' : '进行中';
        const title = document.getElementById('ni-tb-curtitle');
        const meta = document.getElementById('ni-tb-meta');
        if (title) title.textContent = viewNode?.title || '（未命名）';
        if (meta) meta.textContent = `节点 ${stageView.curIdx + 1} / ${stageView.nodes.length}`;
    }

    function niTbRenderStoryBar({ resetView = false } = {}) {
        niTbInjectCSS(); // 确保样式已注入到 document.head
        const cfg = extension_settings[EXT_NAME];
        if (!cfg?.transBookMode) return;
        if (!S.stageMapN || S.stageMapN <= 0) return;
        // 如果状态栏显示未开启，移除旧实例并退出
        if (!cfg?.tbDisplayStatusbar) {
            document.getElementById('ni-storybar')?.remove();
            return;
        }

        const snapshot = niCreateTbSnapshot();
        if (!snapshot.nodes.length) {
            document.getElementById('ni-storybar')?.remove();
            return;
        }
        if (resetView) niTbResetViewToCurrent(snapshot.nodes);
    
        // 找最后一条 AI 消息的.mes_text
        const allMes = document.querySelectorAll('.mes');
        let lastAiMes = null;
        for (let i = allMes.length - 1; i >= 0; i--) {
            const m = allMes[i];
            if (m.getAttribute('is_user') === 'false' || m.classList.contains('assistant')) {
                lastAiMes = m; break;
            }
        }
        const mesText = lastAiMes?.querySelector('.mes_text') || null;
        const chat = document.getElementById('chat');
        let storybar = document.getElementById('ni-storybar');
        if (!storybar) {
            const html = niGetTbStoryBarHtml(snapshot);
            if (mesText) mesText.insertAdjacentHTML('afterend', html);
            else if (chat) chat.insertAdjacentHTML('beforeend', html);
            storybar = document.getElementById('ni-storybar');
        } else if (mesText?.insertAdjacentElement) {
            mesText.insertAdjacentElement('afterend', storybar);
        } else if (chat && storybar.parentElement !== chat) {
            chat.appendChild(storybar);
        }
        if (!storybar) return;

        // 刷新/新楼层重挂载时状态栏默认闭合，用户需要时再手动展开
        niTbCollapseStoryBar({ clearLazy: true });
        niTbSyncStoryBar(snapshot);
        if (storybar.dataset.niTbBound !== '1') {
            niTbBindEvents();
            storybar.dataset.niTbBound = '1';
        }
        niRefreshStorybarTheme();
        niTbSyncPauseUI();
    }
    
    function niRefreshStorybarTheme(themeDraft = null) {
        const cfg = extension_settings[EXT_NAME] || {};
        niApplyStatusbarTheme(themeDraft ? { ...cfg, ...themeDraft } : cfg);
    }
    
    // ── 事件绑定 ─────────────────────────────────────────────────

    function niTbBindEvents() {
        niTbBindBarEvents();
        niTbBindNodePanelEvents();
    }

    function niTbBindBarEvents() {
        const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

        // 顶栏展开/收起
        on('ni-tb-bar', 'click', () => {
            const bar  = document.getElementById('ni-tb-bar');
            const body = document.getElementById('ni-tb-body-wrap');
            const chev = document.getElementById('ni-tb-chevron');
            const isOpen = body?.classList.toggle('open');
            bar?.classList.toggle('open', isOpen);
            chev?.classList.toggle('open', isOpen);
            if (isOpen) {
                const renderOpenTrack = () => {
                    if (document.getElementById('ni-tb-body-wrap') !== body || !body?.classList.contains('open')) return;
                    niTbBuildTrack(niCreateTbSnapshot().nodes);
                };
                // 首次展开立即填充卡片，避免只能靠重选阶段触发渲染；动画展开后再校正一次位置。
                renderOpenTrack();
                setTimeout(renderOpenTrack, 60);
                // Edge/Chromium 在毛玻璃(backdrop-filter)祖先内偶发不绘制 absolute 子树；
                // 展开动画结束后轻推合成层强制重绘一次
                setTimeout(() => {
                    const wrapEl = document.getElementById('ni-tb-wrap');
                    if (!wrapEl) return;
                    wrapEl.style.transform = 'translateZ(0) scale(1)';
                    requestAnimationFrame(() => { wrapEl.style.transform = ''; });
                }, 700);
            } else {
                niTbCollapseStoryBar({ clearLazy: true });
            }
        });
    
        // 阶段按钮
        on('ni-tb-stage-btn', 'click', (e) => {
            e.stopPropagation();
            const visible = niTbToggleDropPanel('ni-tb-stage-panel', 'ni-tb-node-panel');
            if (visible) {
                const snapshot = niCreateTbSnapshot();
                niTbRebuildStageList(snapshot, { alignActive: true });
            }
        });
    
        // 节点按钮
        on('ni-tb-node-btn', 'click', (e) => {
            e.stopPropagation();
            const visible = niTbToggleDropPanel('ni-tb-node-panel', 'ni-tb-stage-panel');
            if (visible) {
                const snapshot = niCreateTbSnapshot();
                niTbRefreshNodePanel(snapshot.nodes);
            }
        });
    
        // 推演按钮
        on('ni-tb-btn-free', 'click', (e) => {
            e.stopPropagation();
            niTbGenerateInfer();
        });
    
        // 暂停/恢复按钮
        on('ni-tb-btn-pause', 'click', (e) => {
            e.stopPropagation();
            niTbTogglePaused();
        });

        // 重置全部节点进度（回档重玩）
        on('ni-tb-btn-reset', 'click', (e) => {
            e.stopPropagation();
            niTbResetProgress();
        });

        // 立即判定归档：手动调用清洗模型核对节点进度（force 绕过开关/暂停/冷却）
        on('ni-tb-btn-archive', 'click', async (e) => {
            e.stopPropagation();
            const btn   = document.getElementById('ni-tb-btn-archive');
            const icon  = document.getElementById('ni-tb-archive-icon');
            if (!btn || btn.classList.contains('loading')) return;
            btn.classList.add('loading');
            if (icon) icon.className = 'ti ti-loader ni-tb-spin';
            try {
                const res = await niTbAutoArchive({ force: true });
                if (res?.reason === 'running') globalThis.toastr?.info?.('正在判定中，请稍候…');
                else if (res?.reason === 'nothing-pending' || res?.reason === 'no-nodes') globalThis.toastr?.info?.('当前没有待判定的节点');
                else if (res?.ok && !res.archived) globalThis.toastr?.info?.('本轮没有可归档的节点');
            } catch (err) {
                console.warn('[NI-TB] 手动判定失败:', err);
            } finally {
                btn.classList.remove('loading');
                if (icon) icon.className = 'ti ti-archive';
            }
        });
    
        // 推演折叠
        on('ni-tb-infer-toggle', 'click', () => {
            const list    = document.getElementById('ni-tb-infer-list');
            const toggle  = document.getElementById('ni-tb-infer-toggle');
            const togIcon = document.getElementById('ni-tb-infer-toggle-icon');
            const expanded = list?.classList.toggle('vis');
            toggle?.classList.toggle('expanded', expanded);
            togIcon?.classList.toggle('expanded', expanded);
        });
    
        // 推演选项：点击整条填入输入框
        document.getElementById('ni-tb-infer-list')?.addEventListener('click', (e) => {
            const item = e.target.closest('.ni-tb-infer-item');
            if (!item) return;
            const desc = niApplyUserSubstitution(item.dataset.desc || '');
            const ta   = document.getElementById('send_textarea') || document.querySelector('#send_textarea');
            if (ta) {
                ta.value = desc;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
            }
        });
    
        // 阶段列表点击
        document.getElementById('ni-tb-stage-panel')?.addEventListener('click', (e) => {
            const pageBtn = e.target.closest('.ni-tb-sp-page-btn');
            if (pageBtn && !pageBtn.disabled) {
                const nextPage = parseInt(pageBtn.dataset.page, 10);
                if (Number.isFinite(nextPage)) _tbStagePage = nextPage;
                niTbRebuildStageList(niCreateTbSnapshot());
                return;
            }
            const row = e.target.closest('.ni-tb-sp-row');
            if (!row) return;
            const si    = parseInt(row.dataset.si);
            const snapshot = niCreateTbSnapshot();
            const { nodes } = snapshot;
            const firstIdx = snapshot.firstNodeIndexByStage[si];
            if (firstIdx >= 0) {
                niTbSetCurrentIdx(firstIdx, nodes, { persist: true, archivePrior: true });
                // 跨阶段立即重建，避免旧动画的延迟移除误删新阶段卡片。
                niTbBuildTrack(nodes);
                niTbSyncMeta(nodes);
                niTbRefreshNodePanel(nodes);
            }
            niTbRebuildStageList(snapshot, { alignActive: true });
            document.getElementById('ni-tb-stage-panel')?.classList.remove('vis');
        });
        document.getElementById('ni-tb-stage-panel')?.addEventListener('change', (e) => {
            const target = e.target;
            if (target?.classList?.contains('ni-tb-sp-page-size')) {
                niTbSetStagePageSize(target.value);
            } else if (target?.classList?.contains('ni-tb-sp-page-current')) {
                const snapshot = niCreateTbSnapshot();
                _tbStagePage = niResolveTransbookStagePagination(snapshot.stages, {
                    page: target.value,
                    pageSize: niTbGetStagePageSize(),
                }).page;
                niTbRebuildStageList(snapshot);
            }
        });
        document.getElementById('ni-tb-stage-panel')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const target = e.target;
            if (!target?.classList?.contains('ni-tb-sp-page-size') && !target?.classList?.contains('ni-tb-sp-page-current')) return;
            e.preventDefault();
            if (target.classList.contains('ni-tb-sp-page-size')) niTbSetStagePageSize(target.value);
            else {
                const snapshot = niCreateTbSnapshot();
                _tbStagePage = niResolveTransbookStagePagination(snapshot.stages, {
                    page: target.value,
                    pageSize: niTbGetStagePageSize(),
                }).page;
                niTbRebuildStageList(snapshot);
            }
        });
    }
    
    function niTbBindNodePanelEvents() {
        const panel = document.getElementById('ni-tb-node-panel');
        if (!panel || panel.dataset.niTbBound === '1') return;
        panel.dataset.niTbBound = '1';
        panel.addEventListener('click', (e) => {
            const snapshot = niCreateTbSnapshot();
            const more = e.target.closest('.ni-tb-np-more');
            if (more) {
                const sec = more.dataset.sec;
                if (sec === 'done' || sec === 'todo') {
                    _tbNodePanelLimits[sec] += TB_NODE_BATCH_SIZE;
                    niTbRefreshNodePanel(snapshot.nodes);
                }
                return;
            }

            const hd = e.target.closest('.ni-tb-section-hd');
            if (hd) {
                const sec = hd.dataset.sec;
                S.tbSectionOpen[sec] = !S.tbSectionOpen[sec];
                niTbRefreshNodePanel(snapshot.nodes);
                return;
            }

            const row = e.target.closest('.ni-tb-np-row');
            if (!row) return;
            const ni = parseInt(row.dataset.ni);
            if (isNaN(ni) || ni < 0 || ni >= snapshot.nodes.length) return;
            niTbSetCurrentIdx(ni, snapshot.nodes, { persist: true, archivePrior: true });
            niTbAnimateTo(ni, snapshot.nodes);
            niTbSyncMeta(snapshot.nodes);
            niTbRefreshNodePanel(snapshot.nodes);
            document.getElementById('ni-tb-node-panel')?.classList.remove('vis');
        });
    }
    
    function niTbToggleDropPanel(showId, hideId) {
        const show = document.getElementById(showId);
        const hide = document.getElementById(hideId);
        hide?.classList.remove('vis');
        return !!show?.classList.toggle('vis');
    }
    
    function niTbRebuildStageList(snapshot = null, { alignActive = false } = {}) {
        const runtime = snapshot?.nodes ? snapshot : niCreateTbSnapshot();
        const { nodes, stages } = runtime;
        const curNode = nodes[S.tbCurIdx];
        const list   = document.getElementById('ni-tb-stage-list');
        if (!list) return;
        const pagination = niResolveTransbookStagePagination(stages, {
            page: _tbStagePage,
            pageSize: niTbGetStagePageSize(),
            activeStageIdx: curNode?.stageIdx,
            alignActive,
        });
        _tbStagePage = pagination.page;
        list.innerHTML = niTbBuildStageListHtml(pagination.items, curNode?.stageIdx, pagination);
        niRefreshStorybarTheme();
    }
    
    // ── Settings 页 UI 绑定 ───────────────────────────────────────
    
    // 防止多次打开设置页时重复绑定事件监听器
    let _niTbUIBound = false;

    /** 未来剧情提前注入：按总开关显隐数量设置区 */
    function niTbSyncFutureInjectBox() {
        const cfg = extension_settings[EXT_NAME] || {};
        const box = document.getElementById('ni-tb-future-box');
        if (!box) return;
        box.style.display = cfg.tbFutureInjectEnabled !== false ? '' : 'none';
    }
    window.niTbSyncFutureInjectBox = niTbSyncFutureInjectBox;

    function niTbInitSettingsUI() {
        const cfg = extension_settings[EXT_NAME];
        if (niUpgradeLegacyTbDefaultPrompts(cfg)) saveSettingsDebounced();
    
        // 穿书模式 UI 绑定
        if (!_niTbUIBound) {
            // 设置面板按钮 & 提示词面板按钮
            const $appTb = typeof $ !== 'undefined' ? $(document.getElementById('ni-app') || document) : null;
            if ($appTb) {
                $appTb.on('click', '#ni-tb-cfg-btn', () => niTogglePanel('ni-tb-cfg-panel', 'ni-tb-cfg-btn'));
                $appTb.on('click', '#ni-tb-prompt-btn', () => niTogglePanel('ni-tb-pb', 'ni-tb-prompt-btn'));
            } else {
                document.addEventListener('click', e => {
                    if (e.target.closest('#ni-tb-cfg-btn'))    niTogglePanel('ni-tb-cfg-panel', 'ni-tb-cfg-btn');
                    if (e.target.closest('#ni-tb-prompt-btn')) niTogglePanel('ni-tb-pb', 'ni-tb-prompt-btn');
                });
            }
    
            // 设置项：状态栏
            document.getElementById('ni-tb-display-statusbar')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbDisplayStatusbar = this.checked;
                if (this.checked) {
                    // 关闭弹窗选项
                    extension_settings[EXT_NAME].tbDisplayPopup = false;
                    const popupChk = document.getElementById('ni-tb-display-popup');
                    if (popupChk) popupChk.checked = false;
                    if (typeof niPopSetVisible === 'function') niPopSetVisible(false);
                }
                // 根据新设置重新渲染状态栏
                if (this.checked) {
                    niTbRenderStoryBar();
                } else {
                    document.getElementById('ni-storybar')?.remove();
                }
                saveSettingsDebounced();
            });
    
            // 设置项：弹窗
            document.getElementById('ni-tb-display-popup')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbDisplayPopup = this.checked;
                if (this.checked) {
                    // 关闭状态栏选项，并移除状态栏
                    extension_settings[EXT_NAME].tbDisplayStatusbar = false;
                    const statusbarChk = document.getElementById('ni-tb-display-statusbar');
                    if (statusbarChk) statusbarChk.checked = false;
                    document.getElementById('ni-storybar')?.remove();
                }
                if (typeof niPopSyncVisibility === 'function') niPopSyncVisibility();
                saveSettingsDebounced();
            });
    
            // 穿书开关：监听 checkbox change 事件
            const tbChk = document.getElementById('ni-tb-chk');
            if (tbChk) {
                tbChk.addEventListener('change', function () {
                    extension_settings[EXT_NAME].tbRestoreAfterPluginEnable = false;
                    niSetTransBookMode(this.checked);
                    saveSettingsDebounced();
                });
            }
    
            // 推进提示词
            const advEl = document.getElementById('ni-tb-advance-prompt');
            if (advEl) {
                advEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbAdvancePrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-advance-reset')?.addEventListener('click', () => {
                const _advEl = document.getElementById('ni-tb-advance-prompt');
                if (_advEl) _advEl.value = TB_DEFAULT_ADVANCE_PROMPT;
                extension_settings[EXT_NAME].tbAdvancePrompt = TB_DEFAULT_ADVANCE_PROMPT;
                saveSettingsDebounced();
            });
    
            // 持续提示词
            const ongoingEl = document.getElementById('ni-tb-ongoing-prompt');
            if (ongoingEl) {
                ongoingEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbOngoingPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-ongoing-reset')?.addEventListener('click', () => {
                const _ongoingEl = document.getElementById('ni-tb-ongoing-prompt');
                if (_ongoingEl) _ongoingEl.value = TB_DEFAULT_ONGOING_PROMPT;
                extension_settings[EXT_NAME].tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
                saveSettingsDebounced();
            });
    
            // 推演提示词
            const inferEl = document.getElementById('ni-tb-infer-prompt');
            if (inferEl) {
                inferEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbInferPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-infer-reset')?.addEventListener('click', () => {
                const _inferEl = document.getElementById('ni-tb-infer-prompt');
                if (_inferEl) _inferEl.value = TB_DEFAULT_INFER_PROMPT;
                extension_settings[EXT_NAME].tbInferPrompt = TB_DEFAULT_INFER_PROMPT;
                saveSettingsDebounced();
            });
    
            // 沉浸提示词
            const immersionEl = document.getElementById('ni-tb-immersion-prompt');
            if (immersionEl) {
                immersionEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbImmersionPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            document.getElementById('ni-tb-immersion-reset')?.addEventListener('click', () => {
                const _immersionEl = document.getElementById('ni-tb-immersion-prompt');
                if (_immersionEl) _immersionEl.value = TB_DEFAULT_IMMERSION_PROMPT;
                extension_settings[EXT_NAME].tbImmersionPrompt = TB_DEFAULT_IMMERSION_PROMPT;
                saveSettingsDebounced();
            });
    
            document.getElementById('ni-tb-light-recall-mode')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbLightRecallMode = this.checked;
                saveSettingsDebounced();
            });

            // 未来剧情提前注入：总开关 + 后续节点数 / 后续阶段数 / 节点截断字数
            document.getElementById('ni-tb-future-inject')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbFutureInjectEnabled = this.checked;
                niTbSyncFutureInjectBox();
                saveSettingsDebounced();
            });
            document.getElementById('ni-tb-future-node-count')?.addEventListener('input', function () {
                extension_settings[EXT_NAME].tbFutureNodeCount = niNormalizeFutureInjectOptions({ nodeCount: this.value }).nodeCount;
                saveSettingsDebounced();
            });
            document.getElementById('ni-tb-future-stage-count')?.addEventListener('input', function () {
                extension_settings[EXT_NAME].tbFutureStageCount = niNormalizeFutureInjectOptions({ stageCount: this.value }).stageCount;
                saveSettingsDebounced();
            });
            document.getElementById('ni-tb-future-node-clip')?.addEventListener('input', function () {
                extension_settings[EXT_NAME].tbFutureNodeClip = niNormalizeFutureInjectOptions({ nodeClip: this.value }).nodeClip;
                saveSettingsDebounced();
            });
    
            document.getElementById('ni-tb-immersion-mode')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbImmersionMode = this.checked;
                saveSettingsDebounced();
            });

            document.getElementById('ni-tb-auto-archive')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbAutoArchive = this.checked;
                saveSettingsDebounced();
            });

            document.getElementById('ni-tb-auto-stage-advance')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbAutoStageAdvance = this.checked;
                saveSettingsDebounced();
            });
    
            _niTbUIBound = true;
        } // end if
    
        // ── 每次打开设置页都需要同步的 UI 值 ──────────────────────
        const chk = document.getElementById('ni-tb-chk');
        if (chk) niSyncTransBookToggleUI();
        const advElSync = document.getElementById('ni-tb-advance-prompt');
        if (advElSync) advElSync.value = cfg?.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT;
        const inferElSync = document.getElementById('ni-tb-infer-prompt');
        if (inferElSync) inferElSync.value = cfg?.tbInferPrompt || TB_DEFAULT_INFER_PROMPT;
        const ongoingElSync = document.getElementById('ni-tb-ongoing-prompt');
        if (ongoingElSync) ongoingElSync.value = cfg?.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT;
        const lightRecallModeChk = document.getElementById('ni-tb-light-recall-mode');
        if (lightRecallModeChk) lightRecallModeChk.checked = !!cfg?.tbLightRecallMode;
        const immersionElSync = document.getElementById('ni-tb-immersion-prompt');
        if (immersionElSync) immersionElSync.value = cfg?.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
        const statusbarChk = document.getElementById('ni-tb-display-statusbar');
        if (statusbarChk) statusbarChk.checked = !!cfg?.tbDisplayStatusbar;
        const popupChk = document.getElementById('ni-tb-display-popup');
        if (popupChk) popupChk.checked = !!cfg?.tbDisplayPopup;
        const immersionModeChk = document.getElementById('ni-tb-immersion-mode');
        if (immersionModeChk) immersionModeChk.checked = !!cfg?.tbImmersionMode;
        const autoArchiveChk = document.getElementById('ni-tb-auto-archive');
        if (autoArchiveChk) autoArchiveChk.checked = !!cfg?.tbAutoArchive;
        const stageAdvanceChk = document.getElementById('ni-tb-auto-stage-advance');
        if (stageAdvanceChk) stageAdvanceChk.checked = cfg?.tbAutoStageAdvance !== false;
        // 未来剧情提前注入
        const futureInjectChk = document.getElementById('ni-tb-future-inject');
        if (futureInjectChk) futureInjectChk.checked = cfg?.tbFutureInjectEnabled !== false;
        const futureNodeCountEl = document.getElementById('ni-tb-future-node-count');
        if (futureNodeCountEl) futureNodeCountEl.value = niNormalizeFutureInjectOptions({ nodeCount: cfg?.tbFutureNodeCount }).nodeCount;
        const futureStageCountEl = document.getElementById('ni-tb-future-stage-count');
        if (futureStageCountEl) futureStageCountEl.value = niNormalizeFutureInjectOptions({ stageCount: cfg?.tbFutureStageCount }).stageCount;
        const futureNodeClipEl = document.getElementById('ni-tb-future-node-clip');
        if (futureNodeClipEl) futureNodeClipEl.value = niNormalizeFutureInjectOptions({ nodeClip: cfg?.tbFutureNodeClip }).nodeClip;
        niTbSyncFutureInjectBox();
    }

    function niTbPeekPendingAdvancePrompt() {
        return _tbPendingAdvancePrompt;
    }

    function niTbConsumePendingAdvancePrompt() {
        const prompt = _tbPendingAdvancePrompt;
        _tbPendingAdvancePrompt = '';
        return prompt;
    }

    function niTbResetPromptRuntimeState() {
        _tbPendingAdvancePrompt = '';
        _tbAdvanceSent.clear();
        S.tbSectionOpen = { done: false, active: true, todo: false };
        _tbStagePage = 1;
        _tbNodePanelStageIdx = null;
        _tbNodePanelLimits.done = TB_NODE_BATCH_SIZE;
        _tbNodePanelLimits.todo = TB_NODE_BATCH_SIZE;
    }

    Object.assign(window, {
        _niS: S,
        niGetTbNodes,
        niGetTbStages,
        niCreateTbSnapshot,
        niTbSetCurrentIdx,
        niTbSetViewIdx,
        niTbResetViewToCurrent,
        niTbStageView,
        niTbToggleCheck,
        niTbGenerateInfer,
        niTbGetInjectionNode,
    });

    return {
        niTbSyncPauseUI,
        niTbSetPaused,
        niTbTogglePaused,
        niUpgradeLegacyTbDefaultPrompts,
        niTbGetImmersionAppend,
        niTbFrontierStage,
        niTbAdvanceFrontier,
        niGetTbNodes,
        niGetTbStages,
        niCreateTbSnapshot,
        niTbReconcileCurrentNode,
        niTbGetInjectionNode,
        niTbSetCurrentIdx,
        niTbSetViewIdx,
        niTbResetViewToCurrent,
        niTbUnpinView,
        niTbStageView,
        niTbSaveState,
        niTbLoadState,
        niGetTbStoryBarHtml,
        niEsc,
        niTbBuildStageListHtml,
        niTbBuildNodePanelHtml,
        niTbGetSlots,
        niTbCalcPos,
        niTbCardHTML,
        niTbBuildTrack,
        niTbAnimateTo,
        niTbCardClick,
        niTbSyncMeta,
        niTbRefreshNodePanel,
        niTbToggleCheck,
        niTbUnarchive,
        niTbShowStageDone,
        niTbWriteAdvancePrompt,
        niTbWriteOpeningPrompt,
        niTbGenerateInfer,
        niTbAutoArchive,
        niTbResetProgress,
        niTbAutoResetIfEmpty,
        niTbInjectCSS,
        niTbRenderStoryBar,
        niRefreshStorybarTheme,
        niTbBindEvents,
        niTbBindBarEvents,
        niTbBindNodePanelEvents,
        niTbToggleDropPanel,
        niTbRebuildStageList,
        niTbInitSettingsUI,
        niTbSyncFutureInjectBox,
        niTbPeekPendingAdvancePrompt,
        niTbConsumePendingAdvancePrompt,
        niTbResetPromptRuntimeState,
    };
}
