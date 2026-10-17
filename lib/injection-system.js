export const NI_RAW_INJECTION_MAX_TOKENS_DEFAULT = 32000;
export const NI_RAW_INJECTION_CHARS_PER_TOKEN = 1.5;

export function niNormalizeRawInjectionMaxTokens(value, fallback = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT) {
    const fallbackValue = Math.max(256, Math.min(200000, parseInt(fallback, 10) || NI_RAW_INJECTION_MAX_TOKENS_DEFAULT));
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(256, Math.min(200000, parsed));
}

export function niPrioritizeStageIndices(stageIndices = [], currentStageIdx = null) {
    const stages = [...new Set((Array.isArray(stageIndices) ? stageIndices : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    if (!stages.length) return [];
    const explicitCurrent = Number(currentStageIdx);
    const anchor = Number.isFinite(explicitCurrent) && explicitCurrent > 0
        ? explicitCurrent
        : Math.max(...stages);
    return stages.sort((a, b) => {
        const distanceDiff = Math.abs(anchor - a) - Math.abs(anchor - b);
        return distanceDiff || b - a;
    });
}

export function niBuildBoundedStageInjection({
    stageIndices = [],
    currentStageIdx = null,
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    getDetailText = () => '',
    getSummaryText = () => '',
} = {}) {
    const normalizedCharsPerToken = Number(charsPerToken) > 0 ? Number(charsPerToken) : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const tokenBudget = niNormalizeRawInjectionMaxTokens(maxTokens);
    const charBudget = Math.max(1, Math.floor(tokenBudget * normalizedCharsPerToken));
    const priorityStages = niPrioritizeStageIndices(stageIndices, currentStageIdx);
    const anchor = Number.isFinite(Number(currentStageIdx)) && Number(currentStageIdx) > 0
        ? Number(currentStageIdx)
        : (priorityStages[0] ?? null);
    const selected = [];
    const omittedStages = [];
    const emptyStages = [];
    let usedChars = 0;
    let truncated = false;

    const append = (stageIdx, kind, rawText, allowTruncate = false) => {
        const text = String(rawText || '').trim();
        if (!text) return false;
        const separatorChars = selected.length ? 2 : 0;
        const available = charBudget - usedChars - separatorChars;
        if (available <= 0) return false;
        if (text.length <= available) {
            selected.push({ stageIdx, kind, text });
            usedChars += separatorChars + text.length;
            return true;
        }
        if (!allowTruncate) return false;
        const marker = '\n……（已达到未向量阶段单轮注入上限）';
        if (available <= marker.length + 20) return false;
        selected.push({
            stageIdx,
            kind: `${kind}-truncated`,
            text: `${text.slice(0, available - marker.length)}${marker}`,
        });
        usedChars += separatorChars + available;
        truncated = true;
        return true;
    };

    priorityStages.forEach(stageIdx => {
        if (usedChars >= charBudget) {
            omittedStages.push(stageIdx);
            return;
        }
        const detailText = String(getDetailText(stageIdx) || '').trim();
        const isPrimary = stageIdx === anchor || selected.length === 0;
        if (detailText && append(stageIdx, 'detail', detailText, isPrimary)) return;
        const summaryText = String(getSummaryText(stageIdx) || '').trim();
        if (summaryText && append(stageIdx, 'summary', summaryText, false)) return;
        if (!detailText && !summaryText) emptyStages.push(stageIdx);
        else omittedStages.push(stageIdx);
    });

    const chronological = selected.slice().sort((a, b) => a.stageIdx - b.stageIdx);
    const text = chronological.map(item => item.text).join('\n\n');
    return {
        text,
        selected: chronological,
        detailStages: chronological.filter(item => item.kind.startsWith('detail')).map(item => item.stageIdx),
        summaryStages: chronological.filter(item => item.kind === 'summary').map(item => item.stageIdx),
        omittedStages,
        emptyStages,
        truncated,
        maxTokens: tokenBudget,
        estimatedTokens: text ? Math.ceil(text.length / normalizedCharsPerToken) : 0,
        usedChars: text.length,
        charBudget,
    };
}

export function niBuildStageInjectionPayload({
    stageIndices = [],
    currentStageIdx = null,
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    rawMode = 'nodes',
    contentTokenReserve = 32,
    getDetailText = () => '',
    getSummaryText = () => '',
} = {}) {
    const mode = rawMode === 'compressed' ? 'compressed' : 'nodes';
    const normalizedMaxTokens = niNormalizeRawInjectionMaxTokens(maxTokens);
    const reserve = Math.max(0, parseInt(contentTokenReserve, 10) || 0);
    const normalizedCharsPerToken = Number(charsPerToken) > 0
        ? Number(charsPerToken)
        : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const result = niBuildBoundedStageInjection({
        stageIndices,
        currentStageIdx,
        maxTokens: Math.max(256, normalizedMaxTokens - reserve),
        charsPerToken: normalizedCharsPerToken,
        getDetailText,
        getSummaryText,
    });
    const tag = mode === 'compressed' ? '小说压缩原文' : '小说剧情节点';
    const content = result.text ? `[${tag}]\n${result.text}\n[/${tag}]` : '';

    return {
        ...result,
        rawMode: mode,
        tag,
        content,
        configuredMaxTokens: normalizedMaxTokens,
        estimatedTokens: content ? Math.ceil(content.length / normalizedCharsPerToken) : 0,
    };
}

export function niIsVectorInjectionDisabledByUser(settings = {}) {
    return settings?.vecInjDisabled === true && settings?.vecInjDisabledByUser === true;
}

export function niNormalizeVectorInjectionPreference(settings = {}) {
    const disabled = niIsVectorInjectionDisabledByUser(settings);
    const changed = settings.vecInjDisabled !== disabled
        || settings.vecInjDisabledByUser !== disabled;
    settings.vecInjDisabled = disabled;
    settings.vecInjDisabledByUser = disabled;
    return changed;
}

export function niSetVectorInjectionDisabledByUser(settings = {}, disabled = false) {
    const value = disabled === true;
    settings.vecInjDisabled = value;
    settings.vecInjDisabledByUser = value;
    return value;
}

export function niResolveStageInjectionPlan({
    enabledStages = [],
    stageVecDone = {},
    settings = {},
} = {}) {
    const stages = [...new Set((Array.isArray(enabledStages) ? enabledStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    const vectorInjectionDisabled = niIsVectorInjectionDisabledByUser(settings);
    const stageHasVector = stageIdx => !!stageVecDone?.[stageIdx];
    const vectorStages = vectorInjectionDisabled
        ? []
        : stages.filter(stageHasVector);
    const rawStages = vectorInjectionDisabled
        ? stages.slice()
        : stages.filter(stageIdx => !stageHasVector(stageIdx));

    return {
        vectorInjectionDisabled,
        vectorStages,
        rawStages,
    };
}

export function niResolveDirectStageInjectionStages({
    rawStages = [],
    transBookMode = false,
    currentStageIdx = null,
    paused = false,
} = {}) {
    const stages = [...new Set((Array.isArray(rawStages) ? rawStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    if (!transBookMode) return stages;
    if (paused) return [];

    const current = Number(currentStageIdx);
    if (!Number.isFinite(current) || current <= 0) return [];
    return stages.includes(current) ? [current] : [];
}

/**
 * 穿书模式下阶段直注的取文范围：只发「当前正在进行的节点」，而不是整个当前阶段。
 * 阶段里排在当前节点之后的节点还没演到，整阶段发出去等于提前向模型剧透。
 *
 * nodes 模式取该节点本身；compressed 模式取它所在的那一段清洗原文
 * （节点的 _chunkIdx 指向原始分段的全局索引，由 niNormalizeTransbookNode 写入）。
 * 返回 null 表示无法收紧，由调用方退回整阶段逻辑——不能让注入直接变空。
 */
export function niBuildTransbookStageDetailText(stageIdx, curTbNode, {
    rawMode = 'nodes',
    getCompressedChunkText = () => '',
} = {}) {
    if (!curTbNode) return null;
    const nodeStageIdx = Number(curTbNode.stageIdx);
    // 锚点节点不属于本阶段时不替换取文，否则会把别的阶段内容挂到这个阶段名下。
    if (Number.isFinite(nodeStageIdx) && nodeStageIdx > 0 && nodeStageIdx !== Number(stageIdx)) return null;

    if (rawMode === 'compressed') {
        const chunkIdx = Number(curTbNode._chunkIdx);
        if (!Number.isFinite(chunkIdx) || chunkIdx < 0) return null;
        const text = String(getCompressedChunkText(chunkIdx) || '').trim();
        return text ? `【第 ${stageIdx} 阶段当前节点原文】\n${text}` : null;
    }

    const title = String(curTbNode.title || '').trim() || '未命名节点';
    const body = String(curTbNode.body || curTbNode.content || '').trim();
    return `【第 ${stageIdx} 阶段当前节点】\n· ${title}：${body}`;
}

// ============================================================
// 穿书模式：未来剧情提前注入
// 在「持续提示词」之后追加后续待演节点与后续阶段走向，让模型提前把握主线
// 节奏、铺垫伏笔；同时用块首规则约束它不得提前揭示或跳过当前节点。
// ============================================================

export const NI_FUTURE_INJECT_DEFAULT_NODE_COUNT = 3;
export const NI_FUTURE_INJECT_DEFAULT_STAGE_COUNT = 1;
export const NI_FUTURE_INJECT_DEFAULT_NODE_CLIP = 150;
export const NI_FUTURE_INJECT_NODE_COUNT_MAX = 10;
export const NI_FUTURE_INJECT_STAGE_COUNT_MAX = 5;
export const NI_FUTURE_INJECT_NODE_CLIP_MAX = 2000;
export const NI_FUTURE_INJECT_STAGE_PREVIEW_NODES = 2;

function niFutureInjectBoundInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    const base = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, base));
}

/**
 * 归一化「未来剧情提前注入」的三项数字设置，供注入层与设置页共用。
 * nodeCount / stageCount 允许 0（表示该部分不注入）。
 */
export function niNormalizeFutureInjectOptions({
    enabled = true,
    nodeCount = NI_FUTURE_INJECT_DEFAULT_NODE_COUNT,
    stageCount = NI_FUTURE_INJECT_DEFAULT_STAGE_COUNT,
    nodeClip = NI_FUTURE_INJECT_DEFAULT_NODE_CLIP,
} = {}) {
    return {
        enabled: enabled !== false,
        nodeCount: niFutureInjectBoundInt(
            nodeCount, NI_FUTURE_INJECT_DEFAULT_NODE_COUNT, 0, NI_FUTURE_INJECT_NODE_COUNT_MAX,
        ),
        stageCount: niFutureInjectBoundInt(
            stageCount, NI_FUTURE_INJECT_DEFAULT_STAGE_COUNT, 0, NI_FUTURE_INJECT_STAGE_COUNT_MAX,
        ),
        nodeClip: niFutureInjectBoundInt(
            nodeClip, NI_FUTURE_INJECT_DEFAULT_NODE_CLIP, 20, NI_FUTURE_INJECT_NODE_CLIP_MAX,
        ),
    };
}

function niFutureInjectClipText(text, maxLength) {
    const value = String(text || '').trim();
    if (!value) return '';
    return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

/**
 * 构建穿书「未来剧情预告」文本块。
 *
 * - 后续节点：从当前注入节点之后按顺序取 maxNodes 个未归档节点，可跨阶段；
 *   已归档节点跳过，locked 不影响预告（locked 只约束界面推进）。
 * - 后续阶段：从「当前阶段之后」取 maxStages 个已启用阶段，优先使用阶段概括；
 *   没有概括时退回该阶段前几个待演节点标题，避免整段空缺。节点与阶段是两个
 *   独立旋钮：节点给具体桥段，阶段给整体走向，允许在同一阶段上各有侧重。
 *
 * 返回空串表示本轮没有可预告内容（调用方直接不追加）。
 */
export function niBuildFuturePlotBlock({
    nodes = [],
    curNode = null,
    stageTitles = {},
    stageSummaries = {},
    stageStates = {},
    totalStages = 0,
    enabled = true,
    nodeCount = NI_FUTURE_INJECT_DEFAULT_NODE_COUNT,
    stageCount = NI_FUTURE_INJECT_DEFAULT_STAGE_COUNT,
    nodeClip = NI_FUTURE_INJECT_DEFAULT_NODE_CLIP,
} = {}) {
    const options = niNormalizeFutureInjectOptions({ enabled, nodeCount, stageCount, nodeClip });
    if (!options.enabled) return '';
    if (!options.nodeCount && !options.stageCount) return '';

    const list = (Array.isArray(nodes) ? nodes : []).filter(node => node && typeof node === 'object');
    const currentNode = curNode && typeof curNode === 'object' ? curNode : null;
    if (!list.length || !currentNode) return '';

    // 找不到当前节点时宁可不猜位置，避免把已演过的节点当成未来预告。
    const currentIdx = list.findIndex(node => node?.id && node.id === currentNode.id);
    if (currentIdx < 0) return '';

    const upcomingNodes = [];
    let lastStageIdx = Number(currentNode.stageIdx) || 0;
    for (let i = currentIdx + 1; i < list.length && upcomingNodes.length < options.nodeCount; i++) {
        const node = list[i];
        if (!node || node.done) continue;
        upcomingNodes.push(node);
        lastStageIdx = Number(node.stageIdx) || lastStageIdx;
    }

    const stageLines = [];
    if (options.stageCount > 0) {
        const lastKnownStage = list.reduce(
            (max, node) => Math.max(max, Number(node?.stageIdx) || 0), 0,
        );
        // 阶段总数缺失或与节点数据不一致时以实际节点中的最大阶段兜底。
        const upperStage = Math.max(0, parseInt(totalStages, 10) || 0, lastKnownStage);
        // 「后续阶段」从当前阶段之后算起，与节点预告是两个独立旋钮：
        // 节点给具体桥段，阶段给整体走向，允许在同一阶段上各有侧重。
        const currentStageIdx = Number(currentNode.stageIdx) || 0;
        const stageStartIdx = currentStageIdx > 0 ? currentStageIdx : lastStageIdx;
        let takenStages = 0;
        for (let stageIdx = stageStartIdx + 1; stageIdx <= upperStage && takenStages < options.stageCount; stageIdx++) {
            if (stageStates?.[stageIdx] === false) continue;
            const title = String(stageTitles?.[stageIdx] || '').trim();
            let detail = String(stageSummaries?.[stageIdx] || '').trim();
            if (!detail) {
                const previews = [];
                for (const node of list) {
                    if (Number(node?.stageIdx) !== stageIdx || node?.done) continue;
                    const nodeTitle = String(node?.title || '').trim();
                    if (nodeTitle) previews.push(nodeTitle);
                    if (previews.length >= NI_FUTURE_INJECT_STAGE_PREVIEW_NODES) break;
                }
                detail = previews.length ? `待演节点：${previews.join('、')}` : '';
            }
            if (!title && !detail) continue;
            const label = title ? `第 ${stageIdx} 阶段「${title}」` : `第 ${stageIdx} 阶段`;
            stageLines.push(detail ? `· ${label}：${detail}` : `· ${label}`);
            takenStages++;
        }
    }

    if (!upcomingNodes.length && !stageLines.length) return '';

    const lines = [
        '【后续剧情预告·后台参考】',
        '以下内容来自原著后续剧情，只用于把握主线节奏、铺垫伏笔与保持因果一致：不得提前揭示，不得让角色预知，也不得跳过当前节点直接演绎后续内容。',
    ];
    if (upcomingNodes.length) {
        lines.push('▌后续待演节点（按顺序推进）');
        upcomingNodes.forEach((node, index) => {
            const title = String(node?.title || '').trim() || '未命名节点';
            const body = niFutureInjectClipText(node?.body || node?.content || '', options.nodeClip);
            lines.push(`${index + 1}. ${title}${body ? `｜${body}` : ''}`);
        });
    }
    if (stageLines.length) {
        lines.push('▌后续阶段走向');
        lines.push(...stageLines);
    }
    lines.push('[/后续剧情预告]');
    return lines.join('\n');
}

export function niResolvePausedTransbookPromptSlots({
    paused = false,
    immersionContent = '',
} = {}) {
    if (!paused) return null;
    return {
        advanceContent: '',
        ongoingContent: String(immersionContent ?? '').trim(),
    };
}
