// 清洗专用 API（双 API）冒烟测试：
// 验证 1) apiRole='clean' 时请求走覆盖凭据 + 清洗专用限速槽
//      2) 未开覆盖时清洗仍走独立通道但不改凭据
//      3) 主通道（游玩时功能）完全不受影响
//      4) prepared 组装请求的凭据以 requestSettings 为准（prepareCleanRequest 已覆盖）
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

// 4) 覆盖未启用（开关关）→ 清洗角色仍用独立通道，但凭据是主配置
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi, fetchBodies } = makeClient(MAIN, counters);
    await callCleanApi([{ role: 'user', content: 'x' }], { apiRole: 'clean' });
    const b = fetchBodies[0].body;
    assert(b.reverse_proxy === 'https://main.example/v1', '开关关闭时不改凭据', b.reverse_proxy);
    assert(counters.clean === 1 && counters.main === 0, '通道仍独立', counters);
    console.log('用例4 开关关+清洗角色: 通过', counters);
}

// 5) prepared 组装请求：requestSettings（prepareCleanRequest 已应用覆盖）优先，不再二次覆盖
{
    const counters = { main: 0, clean: 0 };
    const { callCleanApi, fetchBodies } = makeClient(OVERRIDE, counters);
    const requestSettings = { cleanUrl: 'https://assembled.example/v1', cleanKey: 'assembled-key', cleanModel: 'assembled-model', cleanStream: false };
    await callCleanApi([{ role: 'user', content: 'x' }], { prepared: true, requestSettings, apiRole: 'clean' });
    const b = fetchBodies[0].body;
    assert(b.reverse_proxy === 'https://assembled.example/v1' && b.model === 'assembled-model', '组装凭据不被二次覆盖', b.reverse_proxy);
    assert(counters.clean === 1, '组装请求也走清洗通道', counters);
    console.log('用例5 prepared 不重覆盖: 通过');
}

if (failures > 0) {
    console.error(`共 ${failures} 条断言失败`);
    process.exit(1);
}
console.log('全部双 API 用例通过');
