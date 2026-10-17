// 后台清洗会话冒烟测试：模拟"清洗 A 途中切换工作区到 B"，
// 验证 1) 循环不碰 B 的工作区数组 2) 每轮/结束写回快照 3) 前台模式行为不变。
// 运行：node test-background-clean.mjs（断言失败以非零退出码结束）
import { createCleaningController } from './lib/cleaning-system.js';
import {
    mergeCharacters,
    mergeCharacterAliases,
    capturePlotCheckpointMemory,
    captureCharacterMemory,
    restorePlotCheckpointMemory,
    restoreCharacterMemory,
    rebuildStageMapFromPlotStageIdx,
} from './lib/story-data.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// console.assert 不中断执行，这里包一层让失败以非零退出码报告
let failures = 0;
const assert = (cond, ...args) => {
    if (!cond) failures++;
    console.assert(cond, ...args);
};

function makeWorkspace(novelKey) {
    return {
        novelKey,
        heavyFileKey: novelKey,
        fileFingerprint: 'fp_' + novelKey,
        chunkKbUsed: 100,
        _charsPerByte: 0.5,
        rawText: 'x',
        fileLoaded: true,
        cleanRunning: false,
        cleanDone: false,
        stopClean: false,
        skipCurrentChunk: false,
        _cleanAbortControllers: new Map(),
        _cleanSkippedChunks: new Set(),
        chunks: [],
        chunkStatus: [],
        chunkResults: [],
        chunkMeta: [],
        characters: [],
        plots: { main: [], sub: [], pivot: [] },
        worldCategories: [],
        styleGuide: '',
        stageMap: {},
        stageMapN: 0,
        chunkStageMap: null,
        stageStates: {},
        stageSummaries: {},
        stageTitles: {},
        vecDone: false,
    };
}

function makeController(S, { writeBacks, toasts }, extraDeps = {}) {
    let n = 0;
    const deps = {
        state: S,
        getSettings: () => ({ apiConcurrency: 1, customPrompt: 'p', cleanAutoResume: false }),
        defaultSettings: { apiConcurrency: 1, chunkKb: 100 },
        cleanPrompt: '',
        q: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, replaceChildren() {}, closest: () => null, textContent: '', disabled: false, hidden: false }),
        sv: () => {},
        alert: () => {},
        confirmRestart: async () => false,
        toastr: { info: (m) => toasts.push(['info', m]), success: (m) => toasts.push(['success', m]), warning: (m) => toasts.push(['warning', m]), clear: () => {} },
        logger: console,
        FileReader: globalThis.FileReader,
        AbortController: globalThis.AbortController,
        setTimer: (cb, d) => setTimeout(cb, d),
        clearTimer: id => clearTimeout(id),
        now: () => Date.now(),
        fingerprintArrayBuffer: async () => 'fp',
        // 模拟工作区重置：重绑定（而非原地修改）——这是后台会话成立的前提
        resetNovelWorkspace: () => {
            S.chunks = []; S.chunkStatus = []; S.chunkResults = []; S.chunkMeta = [];
            S.characters = []; S.plots = { main: [], sub: [], pivot: [] };
            S.stageMap = {}; S.stageMapN = 0; S.chunkStageMap = null;
            S.cleanRunning = false; S.cleanDone = false; S.stopClean = false;
        },
        maybeAutoProtectWorkspace: async () => ({ idx: 0, key: 'snapA' }),
        writeBackCleanSnapshot: async (info) => { writeBacks.push(JSON.parse(JSON.stringify(info))); return true; },
        serverLoadHeavy: async () => true,
        rechunkPreservingCompleted: () => ({ oldToNewChunkIdx: new Map(), preserved: 0 }),
        remapVectorSourceChunkIndices: async () => {},
        resetChunkDerivedState: () => {},
        populateStyleChunkSelector: () => {},
        saveSettings: () => {},
        ensureChunksLoaded: async () => true,
        hasLoadedChunks: () => true,
        concurrencyLimit: () => 1,
        mergeCharacters,
        mergeCharacterAliases,
        mergePlots: (state, incoming, i) => {
            (incoming || []).forEach(p => state.plots[p.type || 'main'].push({ ...p, _chunkIdx: i }));
        },
        restorePlotCheckpointMemory,
        restoreCharacterMemory,
        sortPlotsByStoryOrder: arr => arr,
        rebuildStageMapFromPlotStageIdx: state => { state.stageMapN = state.stageMapN || 0; },
        syncSubPlotStageAssignments: () => {},
        callCleanApi: async () => {
            const i = n++;
            await sleep(30); // 模拟真实 API 延迟，给 detach 留出中点
            return `压缩正文${i}<ni_meta>{"plots":[{"type":"main","title":"节点${i}","body":"b"}],"characters":[{"name":"角色${i}"}]}</ni_meta>`;
        },
        prepareCleanRequest: null,
        callCleanTaskApi: null,
        finishCleanRequest: null,
        capturePlotCheckpointMemory,
        captureCharacterMemory,
        renderPlots: () => {},
        renderCharacters: () => {},
        buildStages: () => {},
        clearNovelVectors: async () => {},
        onNovelFileLoaded: () => {},
        ...extraDeps,
    };
    return createCleaningController(deps);
}

function loadA(S) {
    S.chunks = ['a', 'b', 'c'];
    S.chunkStatus = ['pending', 'pending', 'pending'];
    S.chunkResults = ['', '', ''];
}

// ========== 场景 1：前台正常清洗（无切换），行为应与旧版一致 ==========
{
    const S1 = makeWorkspace('novelA');
    loadA(S1);
    const writeBacks1 = [];
    const toasts1 = [];
    const c1 = makeController(S1, { writeBacks: writeBacks1, toasts: toasts1 });
    await c1.niStartClean();
    assert(S1.chunkStatus.every(s => s === 'done'), '前台: 三段应全部完成', S1.chunkStatus);
    assert(S1.characters.length === 3, '前台: 工作区应有3个角色', S1.characters.length);
    assert(writeBacks1.length === 0, '前台: 不应触发写回', writeBacks1.length);
    console.log('场景1 前台清洗: 通过 (chunkStatus=%s, chars=%d, writeBacks=%d)', S1.chunkStatus.join(','), S1.characters.length, writeBacks1.length);
}

// ========== 场景 2：清洗 A 途中切换到 B，A 在后台跑完并写回快照 ==========
{
    const S2 = makeWorkspace('novelA');
    loadA(S2);
    const writeBacks2 = [];
    const toasts2 = [];
    const c2 = makeController(S2, { writeBacks: writeBacks2, toasts: toasts2 });

    const run = c2.niStartClean();
    await sleep(45); // 第一段完成、第二段进行中
    const detached = c2.niDetachCleanForSwitch();
    assert(detached === true, 'detach 应返回 true');
    c2.niSetCleanSessionHome({ idx: 0, key: 'snapA' });
    const stopRequested = S2.stopClean;
    // 模拟工作区切换：重置（重绑定空数组）+ 载入 B 的数据
    S2.chunks = []; S2.chunkStatus = []; S2.chunkResults = []; S2.chunkMeta = [];
    S2.characters = []; S2.plots = { main: [], sub: [], pivot: [] };
    S2.cleanRunning = false;
    S2.cleanRunning = true; S2.stopClean = !!stopRequested; // 流程里的恢复
    S2.novelKey = 'novelB';
    S2.chunks = ['B1'];
    S2.chunkStatus = ['pending'];
    S2.chunkResults = [''];

    await run;
    const last = writeBacks2[writeBacks2.length - 1];
    assert(last && last.key === 'snapA', '写回应指向 snapA', last?.key);
    assert(last.data.chunkStatus.length === 3 && last.data.chunkStatus.every(s => s === 'done'), '写回: A 的 3 段全部完成', last.data.chunkStatus);
    assert(last.data.characters.length === 3, '写回: A 应有3个角色', last.data.characters.length);
    assert(last.data.chunkResults.every(t => String(t).includes('压缩正文')), '写回: 压缩正文完整');
    assert(S2.chunkStatus.length === 1 && S2.chunkStatus[0] === 'pending', 'B 的工作区分段不应被后台循环触碰', S2.chunkStatus);
    assert(S2.characters.length === 0, 'B 的工作区角色不应被后台合并触碰', S2.characters.length);
    assert(toasts2.some(t => t[0] === 'success'), '结束应有成功提示');
    console.log('场景2 后台清洗: 通过 (writeBacks=%d, 末次写回 done=%s, B未受影响=%s)',
        writeBacks2.length,
        last.data.chunkStatus.every(s => s === 'done'),
        S2.chunkStatus[0] === 'pending');
}

// ========== 场景 3：detach 前点过暂停，stopClean 语义在切换后保留 ==========
{
    const S3 = makeWorkspace('novelA');
    S3.chunks = ['a', 'b', 'c', 'd'];
    S3.chunkStatus = ['pending', 'pending', 'pending', 'pending'];
    S3.chunkResults = ['', '', '', ''];
    const writeBacks3 = [];
    const toasts3 = [];
    const c3 = makeController(S3, { writeBacks: writeBacks3, toasts: toasts3 });
    const run3 = c3.niStartClean();
    await sleep(45);
    c3.niPauseClean(); // 切之前点暂停
    c3.niDetachCleanForSwitch();
    const stopRequested3 = S3.stopClean;
    S3.chunks = []; S3.chunkStatus = []; S3.chunkResults = []; S3.chunkMeta = [];
    S3.cleanRunning = false;
    S3.cleanRunning = true; S3.stopClean = !!stopRequested3;
    await run3;
    const last3 = writeBacks3[writeBacks3.length - 1];
    const doneCount = last3.data.chunkStatus.filter(s => s === 'done').length;
    assert(doneCount >= 1 && doneCount < 4, '暂停场景: 应有部分完成但非全部', last3.data.chunkStatus);
    assert(toasts3.some(t => t[0] === 'success' && String(t[1]).includes('暂停')), '暂停结束提示应说明已暂停');
    console.log('场景3 切换前暂停: 通过 (完成 %d/4 段, 写回 %d 次)', doneCount, writeBacks3.length);
}

// ========== 场景 4：写回目标只登记一次，不被后续 protect 劫持 ==========
// 回归：A 在后台清洗时，用户加载/上传小说 B 会触发第二次 protect（属于 B 的快照），
// 旧实现会把 A 会话的写回目标覆盖成 B 的快照——A 的进度写丢/写进 B 的快照。
{
    const S4 = makeWorkspace('novelA');
    loadA(S4);
    const writeBacks4 = [];
    const toasts4 = [];
    const c4 = makeController(S4, { writeBacks: writeBacks4, toasts: toasts4 });
    const run4 = c4.niStartClean();
    await sleep(45);
    c4.niDetachCleanForSwitch();
    c4.niSetCleanSessionHome({ idx: 0, key: 'snapA' });
    // 模拟切换流程里的第二次 protect（novelB 的快照）试图覆盖写回目标——必须被拒绝
    c4.niSetCleanSessionHome({ idx: 1, key: 'snapB' });
    S4.chunks = []; S4.chunkStatus = []; S4.chunkResults = []; S4.chunkMeta = [];
    S4.cleanRunning = false;
    S4.cleanRunning = true;
    await run4;
    const last4 = writeBacks4[writeBacks4.length - 1];
    assert(last4 && last4.key === 'snapA', '写回目标必须是先登记的 snapA，不得被 snapB 覆盖', last4?.key);
    assert(last4.data.chunkStatus.every(s => s === 'done'), '后台会话照常跑完');
    console.log('场景4 写回目标防劫持: 通过 (写回 key=%s)', last4?.key);
}

// ========== 场景 5：写回目标缺失时的指纹认领（控制器侧接口） ==========
// 回归：切换瞬间一段都没洗完 → 自动备份跳过 → 会话无写回目标；
// 存储侧按文件指纹找到快照后通过 niForceCleanSessionHome 登记，且登记后
// 不能被切换路径的 niSetCleanSessionHome（protect 属于别的小说）覆盖。
{
    const S5 = makeWorkspace('novelA');
    loadA(S5);
    S5.fileFingerprint = 'fp_novelA';
    const writeBacks5 = [];
    const toasts5 = [];
    const c5 = makeController(S5, { writeBacks: writeBacks5, toasts: toasts5 });
    const run5 = c5.niStartClean();
    await sleep(25);
    c5.niDetachCleanForSwitch();
    const info = c5.niGetCleanSessionInfo();
    assert(info && info.detached && !info.hasHome, '会话信息：已切走且无写回目标', info);
    assert(info.fileFingerprint === 'fp_novelA', '会话指纹保留', info?.fileFingerprint);
    // 模拟存储侧按指纹找到快照后的强制登记
    c5.niForceCleanSessionHome({ idx: 2, key: 'snapByFp' });
    const info2 = c5.niGetCleanSessionInfo();
    assert(info2.hasHome && info2.homeSnapshotKey === 'snapByFp', '认领登记生效', info2);
    // 此后加载/上传其他小说触发的 protect 登记（属于别的小说）必须被拒绝
    c5.niSetCleanSessionHome({ idx: 9, key: 'snapHijack' });
    const info3 = c5.niGetCleanSessionInfo();
    assert(info3.homeSnapshotIdx === 2 && info3.homeSnapshotKey === 'snapByFp', '认领结果不被普通登记覆盖', info3);
    S5.chunks = []; S5.chunkStatus = []; S5.chunkResults = []; S5.chunkMeta = [];
    S5.cleanRunning = false;
    S5.cleanRunning = true;
    await run5;
    const last5 = writeBacks5[writeBacks5.length - 1];
    assert(last5 && last5.key === 'snapByFp' && last5.data.chunkStatus.every(s => s === 'done'), '写回落在认领的快照上', last5?.key);
    console.log('场景5 指纹认领: 通过 (写回 key=%s)', last5?.key);
}

// ========== 场景 6：已完成段正文缺失 → 降级续跑（不重洗已完成段） ==========
{
    const S6 = makeWorkspace('novelA');
    S6.chunks = ['a', 'b', 'c'];
    S6.chunkStatus = ['done', 'pending', 'pending'];   // 第 1 段标记完成
    S6.chunkResults = ['', '', ''];                    // 但正文全部缺失（服务端读不到）
    S6.chunkMeta = [{ plots: [{ type: 'main', title: '旧节点', body: 'b' }], characters: [{ name: '角色甲' }] }, null, null];
    const writeBacks6 = [];
    const toasts6 = [];
    let confirmArgs = null;
    const c6 = makeController(S6, { writeBacks: writeBacks6, toasts: toasts6 }, {
        ensureChunksLoaded: async () => false,   // 模拟服务端正文加载失败
        hasLoadedChunks: () => false,
        confirm: async ({ done } = {}) => { confirmArgs = { done }; return true; }, // 用户选择降级续跑
    });
    await c6.niStartClean();
    assert(confirmArgs && confirmArgs.done === 1, '降级确认收到已完成段数', confirmArgs);
    assert(S6.chunkStatus.every(s => s === 'done'), '三段全部完成');
    assert(S6.chunkResults[0] === '', '已完成的第 1 段不被重洗、正文保持缺失');
    assert(String(S6.chunkResults[1]).includes('压缩正文') && String(S6.chunkResults[2]).includes('压缩正文'), '第 2/3 段正常压缩');
    console.log('场景6 降级续跑: 通过 (已完成段未重洗, 缺失=%s)', JSON.stringify(confirmArgs));
}

// ========== 场景 7：降级续跑被取消 → 清洗不启动 ==========
{
    const S7 = makeWorkspace('novelA');
    S7.chunks = ['a', 'b'];
    S7.chunkStatus = ['done', 'pending'];
    S7.chunkResults = ['', ''];
    const writeBacks7 = [];
    const toasts7 = [];
    let alerted = false;
    const c7 = makeController(S7, { writeBacks: writeBacks7, toasts: toasts7 }, {
        ensureChunksLoaded: async () => false,
        hasLoadedChunks: () => false,
        confirm: async () => false,  // 用户取消
        alert: () => { alerted = true; },
    });
    await c7.niStartClean();
    assert(alerted === true, '取消后弹出旧式提示');
    assert(S7.cleanRunning === false, '清洗未启动');
    assert(S7.chunkStatus[1] === 'pending', '未清洗段保持原状');
    console.log('场景7 降级取消: 通过 (清洗未启动)');
}

if (failures > 0) {
    console.error(`共 ${failures} 条断言失败`);
    process.exit(1);
}
console.log('全部冒烟测试通过');
