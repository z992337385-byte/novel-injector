// 清洗专用 API（双 API）冒烟测试：
// 验证 1) apiRole='clean' 且覆盖生效时：请求走覆盖凭据 + 清洗专用限速槽
//      2) 覆盖模型留空时沿用主模型
//      3) 主通道（游玩时功能）完全不受影响
//      4) 覆盖未启用时：清洗与主通道共用计量（避免同一凭据被双倍限速/并发）
//      5) prepared 组装请求的凭据以 requestSettings 为准（prepareCleanRequest 已覆盖）
//      6) prepared 未标记隔离时共用主通道计量
// 运行：node test-clean-api2.mjs
import { createNovelApiClient, DynamicSemaphore } from './lib/api-system.js';

let failures = 0;
const assert = (cond, ...args) => {
    if (!cond) failures++;
    console.assert(cond, ...args);
};

function makeClient(settings, counters) {
    const fetchBodies = [];
    const client = createNovelApiClient({
        getSettings: () => settings,
        acquireApiRateSlot: async () => { counters.main++; },
        acquireCleanApiRateSlot: async () => { counters.clean++; },
        useTavernGlobalPreset: () => false,
        runWithSemaphore: (sem, task) => task(),
        apiSemaphore: new DynamicSemaphore(() => 8),
        cleanApiSemaphore: new DynamicSemaphore(() => 8),
        applyGlobalPromptsToMessages: m => m,
        extractChatCompletionText: json => json?.choices?.[0]?.message?.content ?? '',
        getRequestHeaders: () => ({}),
        fetch: async (url, opts) => {
            fetchBodies.push({ url, body: JSON.parse(opts.body) });
            return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
        },
    });
    return { callCleanApi: client.callCleanApi, fetchBodies };
}

const MAIN = {
    cleanUrl: 'https://main.example/v1', cleanKey: 'main-key', cleanModel: 'main-model',
    cleanStream: false, cleanApi2Enabled: false,
};
const OVERRIDE = {
    ...MAIN,
    cleanApi2Enabled: true,
    cleanApi2Url: 'https://clean.example/v1',
    cleanApi2Key: 'clean-key',
    cleanApi2Model: 'clean-model',
};

// 1) 清洗角色 + 覆盖开启：走覆盖凭据与清洗限速槽
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi, fetchBodies } = makeClient(OVERRIDE, counters);
    await callCleanApi([{ role: 'user', content: 'x' }], { apiRole: 'clean' });
    const b = fetchBodies[0].body;
    assert(b.reverse_proxy === 'https://clean.example/v1', '覆盖端点生效', b.reverse_proxy);
    assert(b.proxy_password === 'clean-key', '覆盖 Key 生效', b.proxy_password);
    assert(b.model === 'clean-model', '覆盖模型生效', b.model);
    assert(counters.clean === 1 && counters.main === 0, '清洗走专用限速槽', counters);
    console.log('用例1 清洗+覆盖: 通过', counters);
}

// 2) 覆盖模型留空 → 沿用主模型
{
    const counters = { main: 0, clean: 0 };
    const settings = { ...OVERRIDE, cleanApi2Model: '  ' };
    const { callCleanApi, fetchBodies } = makeClient(settings, counters);
    await callCleanApi([{ role: 'user', content: 'x' }], { apiRole: 'clean' });
    assert(fetchBodies[0].body.model === 'main-model', '模型留空沿用主配置', fetchBodies[0].body.model);
    console.log('用例2 模型留空回退: 通过');
}

// 3) 覆盖开启但主通道调用（无 apiRole）→ 完全不受影响
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi, fetchBodies } = makeClient(OVERRIDE, counters);
    await callCleanApi([{ role: 'user', content: 'x' }]);
    const b = fetchBodies[0].body;
    assert(b.reverse_proxy === 'https://main.example/v1' && b.model === 'main-model', '主通道凭据不变', b.reverse_proxy);
    assert(counters.main === 1 && counters.clean === 0, '主通道走主限速槽', counters);
    console.log('用例3 主通道不受影响: 通过', counters);
}

// 4) 覆盖未启用（开关关）→ 清洗与主通道共用计量（同一凭据不能双倍计数）
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi, fetchBodies } = makeClient(MAIN, counters);
    await callCleanApi([{ role: 'user', content: 'x' }], { apiRole: 'clean' });
    const b = fetchBodies[0].body;
    assert(b.reverse_proxy === 'https://main.example/v1', '开关关闭时不改凭据', b.reverse_proxy);
    assert(counters.main === 1 && counters.clean === 0, '未隔离时共用主通道计量', counters);
    console.log('用例4 开关关+清洗角色: 通过', counters);
}

// 5) prepared 组装请求：requestSettings（prepareCleanRequest 已应用覆盖）优先，不再二次覆盖
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi, fetchBodies } = makeClient(OVERRIDE, counters);
    const requestSettings = {
        cleanUrl: 'https://assembled.example/v1', cleanKey: 'assembled-key', cleanModel: 'assembled-model',
        cleanStream: false, _cleanLaneIsolated: true,
    };
    await callCleanApi([{ role: 'user', content: 'x' }], { prepared: true, requestSettings, apiRole: 'clean' });
    const b = fetchBodies[0].body;
    assert(b.reverse_proxy === 'https://assembled.example/v1' && b.model === 'assembled-model', '组装凭据不被二次覆盖', b.reverse_proxy);
    assert(counters.clean === 1, '已隔离的组装请求走清洗通道', counters);
    console.log('用例5 prepared 不重覆盖: 通过');
}

// 6) prepared 未标记隔离（未开双 API）→ 共用主通道计量
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi } = makeClient(MAIN, counters);
    const requestSettings = {
        cleanUrl: 'https://main.example/v1', cleanKey: 'main-key', cleanModel: 'main-model',
        cleanStream: false, _cleanLaneIsolated: false,
    };
    await callCleanApi([{ role: 'user', content: 'x' }], { prepared: true, requestSettings, apiRole: 'clean' });
    assert(counters.main === 1 && counters.clean === 0, '未隔离的组装请求共用主通道', counters);
    console.log('用例6 prepared 未隔离共用主通道: 通过');
}

// 7) 按作用域中止：暂停清洗只中止 clean 通道请求，不影响并行的主通道请求
{
    const scopes = new Map(); // role -> Set<AbortController>
    const register = (controller, role) => {
        const key = role || 'main';
        if (!scopes.has(key)) scopes.set(key, new Set());
        scopes.get(key).add(controller);
    };
    const unregister = controller => {
        scopes.forEach(set => set.delete(controller));
    };
    const pending = [];
    const client = createNovelApiClient({
        getSettings: () => ({ ...OVERRIDE, apiTimeoutMin: 1 }),
        acquireApiRateSlot: async () => {},
        acquireCleanApiRateSlot: async () => {},
        useTavernGlobalPreset: () => false,
        runWithSemaphore: (sem, task) => task(),
        apiSemaphore: new DynamicSemaphore(() => 8),
        cleanApiSemaphore: new DynamicSemaphore(() => 8),
        applyGlobalPromptsToMessages: m => m,
        extractChatCompletionText: json => json?.choices?.[0]?.message?.content ?? '',
        getRequestHeaders: () => ({}),
        registerRequestScope: register,
        unregisterRequestScope: unregister,
        fetch: async (url, opts) => {
            const body = JSON.parse(opts.body);
            // 两个请求都先挂起，等到断言完作用域登记后再分别处理
            return new Promise((resolve, reject) => {
                pending.push({
                    isClean: body.reverse_proxy === 'https://clean.example/v1',
                    resolve,
                    reject,
                });
                opts.signal.addEventListener('abort', () => {
                    const err = new Error('AbortError');
                    err.name = 'AbortError';
                    reject(err);
                }, { once: true });
            });
        },
    });

    const mainPromise = client.callCleanApi([{ role: 'user', content: 'main' }], {});
    const cleanPromise = client.callCleanApi([{ role: 'user', content: 'clean' }], { apiRole: 'clean' });
    await new Promise(resolve => setTimeout(resolve, 30));

    assert((scopes.get('clean')?.size || 0) === 1, '清洗请求登记在 clean 作用域', scopes.get('clean')?.size);
    assert((scopes.get('main')?.size || 0) === 1, '主请求登记在 main 作用域', scopes.get('main')?.size);

    // 模拟「暂停清洗」：只中止 clean 作用域
    [...(scopes.get('clean') || [])].forEach(controller => controller.abort());

    let cleanRejected = false;
    try { await cleanPromise; } catch (e) { cleanRejected = true; }
    assert(cleanRejected, '清洗请求被按作用域中止');

    // 放行主请求，验证它没有被清洗的中止波及
    const mainPending = pending.find(item => !item.isClean);
    mainPending.resolve({
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'main-ok' } }] }),
    });
    const mainResult = await mainPromise;
    assert(mainResult === 'main-ok', '主通道请求不受清洗中止影响', mainResult);
    console.log('用例7 按作用域中止互不误杀: 通过');
}

if (failures > 0) {
    console.error(`共 ${failures} 条断言失败`);
    process.exit(1);
}
console.log('全部双 API 用例通过');
