// 未来剧情提前注入 + 前情召回条数 测试
// 覆盖：开关/空数据、节点预告（跨阶段、跳过已归档、截断）、阶段预告（概括优先、
// 无概括回退节点标题、跳过已关闭阶段、与节点不重复）、数量边界、前情条数归一化。
// 运行：node test-future-inject.mjs（失败非零退出）
import { niBuildFuturePlotBlock, niNormalizeFutureInjectOptions } from './lib/injection-system.js';
import { niNormalizeRecallHistoryTopK, createVectorRecallService } from './lib/vector-system.js';

let failures = 0;
const assert = (cond, ...args) => {
    if (!cond) failures++;
    console.assert(cond, ...args);
};

const node = (id, stageIdx, { title = `节点${id}`, body = '', done = false } = {}) => ({
    id, stageIdx, title, body, done, locked: false,
});

const nodes = [
    node('a1', 1, { title: '阶段一节点A', body: '一A正文' }),
    node('a2', 1, { title: '阶段一节点B', body: '一B正文', done: true }),
    node('a3', 1, { title: '阶段一节点C', body: '一C正文' }),
    node('b1', 2, { title: '阶段二节点A', body: '二A正文' }),
    node('b2', 2, { title: '阶段二节点B', body: '二B正文' }),
    node('c1', 3, { title: '阶段三节点A', body: '三A正文' }),
    node('d1', 4, { title: '阶段四节点A', body: '四A正文' }),
];

const baseOptions = {
    nodes,
    curNode: nodes[0],
    stageTitles: { 1: '初入江湖', 2: '风起云涌', 3: '决战', 4: '尾声' },
    stageSummaries: { 2: '主角卷入宗门纷争。', 3: '最终决战爆发。' },
    stageStates: { 4: false },
    totalStages: 4,
};

// 1) 总开关关闭 → 不注入
{
    const text = niBuildFuturePlotBlock({ ...baseOptions, enabled: false });
    assert(text === '', '关闭时返回空串', text);
    console.log('用例1 关闭开关: 通过');
}

// 2) 缺少当前节点 / 空节点列表 → 不注入（不猜位置）
{
    assert(niBuildFuturePlotBlock({ ...baseOptions, curNode: null }) === '', '缺少当前节点返回空串');
    assert(niBuildFuturePlotBlock({ ...baseOptions, nodes: [] }) === '', '空节点列表返回空串');
    const ghost = niBuildFuturePlotBlock({ ...baseOptions, curNode: node('nope', 1) });
    assert(ghost === '', '当前节点不在列表内返回空串', ghost);
    console.log('用例2 数据缺失保护: 通过');
}

// 3) 节点预告：默认 3 个、跳过已归档、正文截断、带块首约束
{
    const text = niBuildFuturePlotBlock({
        ...baseOptions,
        nodeCount: 3,
        stageCount: 0,
        nodeClip: 50,
    });
    assert(text.includes('【后续剧情预告·后台参考】'), '包含块标题', text);
    assert(text.includes('不得提前揭示'), '包含防剧透约束', text);
    assert(text.includes('1. 阶段一节点C｜一C正文'), '按顺序从当前节点之后开始', text);
    assert(!text.includes('阶段一节点B'), '已归档节点不预告', text);
    assert(text.includes('2. 阶段二节点A｜二A正文'), '可跨阶段继续预告节点', text);
    assert(text.includes('3. 阶段二节点B｜二B正文'), '继续跨阶段预告', text);
    assert(!text.includes('阶段三节点A'), '超过 nodeCount 的节点不出现', text);
    assert(text.includes('[/后续剧情预告]'), '块有闭合标记', text);
    console.log('用例3 节点预告: 通过');
}

// 4) 节点截断：超长正文以省略号收尾
{
    const longNodes = [
        node('x1', 1, { title: '起点' }),
        node('x2', 1, { title: '长节点', body: '字'.repeat(400) }),
    ];
    const text = niBuildFuturePlotBlock({
        ...baseOptions,
        nodes: longNodes,
        curNode: longNodes[0],
        nodeCount: 1,
        stageCount: 0,
        nodeClip: 100,
    });
    assert(text.includes(`${'字'.repeat(100)}…`), '按 nodeClip 截断并加省略号', text.slice(0, 200));
    assert(!text.includes('字'.repeat(101)), '截断长度不超过 nodeClip', text);
    console.log('用例4 节点截断: 通过');
}

// 5) 阶段预告：从当前阶段之后开始，概括优先、跳过已关闭阶段
{
    // 当前节点在阶段一最后：节点预告跨到阶段二，阶段预告仍从阶段二开始（两个独立旋钮）
    const text = niBuildFuturePlotBlock({
        ...baseOptions,
        curNode: nodes[2], // a3，阶段一最后一个未归档节点
        nodeCount: 2,
        stageCount: 2,
    });
    assert(text.includes('▌后续待演节点'), '有节点区块', text);
    assert(text.includes('1. 阶段二节点A'), '节点预告从阶段二开始', text);
    assert(text.includes('2. 阶段二节点B'), '节点预告第二个', text);
    assert(text.includes('▌后续阶段走向'), '有阶段区块', text);
    assert(text.includes('第 2 阶段「风起云涌」：主角卷入宗门纷争。'), '阶段二概括', text);
    assert(text.includes('第 3 阶段「决战」：最终决战爆发。'), '阶段三概括', text);
    assert(!text.includes('第 4 阶段'), '已关闭阶段不预告', text);
    console.log('用例5 阶段预告: 通过');
}

// 6) 阶段无概括时回退为待演节点标题
{
    const text = niBuildFuturePlotBlock({
        ...baseOptions,
        stageSummaries: { 3: '最终决战爆发。' }, // 阶段二没有概括
        curNode: nodes[2],
        nodeCount: 0,
        stageCount: 1,
    });
    assert(text.includes('第 2 阶段「风起云涌」：待演节点：阶段二节点A、阶段二节点B'), '无概括回退节点标题', text);
    assert(!text.includes('▌后续待演节点'), 'nodeCount=0 时不注入节点区块', text);
    console.log('用例6 阶段概括回退: 通过');
}

// 7) 数量都为 0 → 不注入
{
    const text = niBuildFuturePlotBlock({ ...baseOptions, nodeCount: 0, stageCount: 0 });
    assert(text === '', 'nodeCount 与 stageCount 均为 0 时不注入', text);
    console.log('用例7 数量全零: 通过');
}

// 8) 末尾节点没有后续内容 → 不注入
{
    const tailNodes = [node('t1', 1, { title: '唯一节点' })];
    const text = niBuildFuturePlotBlock({
        ...baseOptions,
        nodes: tailNodes,
        curNode: tailNodes[0],
        totalStages: 1,
        nodeCount: 3,
        stageCount: 2,
    });
    assert(text === '', '没有后续节点和阶段时返回空串', text);
    console.log('用例8 末尾节点: 通过');
}

// 9) 数量/截断归一化边界
{
    const opt = niNormalizeFutureInjectOptions({
        nodeCount: 99,
        stageCount: -3,
        nodeClip: 5,
    });
    assert(opt.nodeCount === 10, '节点数上限 10', opt);
    assert(opt.stageCount === 0, '阶段数下限 0', opt);
    assert(opt.nodeClip === 20, '截断下限 20', opt);
    const fallback = niNormalizeFutureInjectOptions({});
    assert(fallback.nodeCount === 3 && fallback.stageCount === 1 && fallback.nodeClip === 150, '默认值正确', fallback);
    console.log('用例9 数量归一化: 通过');
}

// 10) 前情召回条数归一化
{
    assert(niNormalizeRecallHistoryTopK(undefined, 3) === 2, '未设置时沿用旧行为 2 条');
    assert(niNormalizeRecallHistoryTopK(undefined, 1) === 1, '当前名额为 1 时不超过当前名额');
    assert(niNormalizeRecallHistoryTopK(0, 3) === 0, '0 = 不召回前情');
    assert(niNormalizeRecallHistoryTopK('5', 3) === 5, '设置值生效');
    assert(niNormalizeRecallHistoryTopK(99, 3) === 20, '上限 20');
    assert(niNormalizeRecallHistoryTopK(-1, 3) === 0, '负数按 0');
    console.log('用例10 前情召回条数: 通过');
}

// 11) 前情条数接入召回服务：0 = 不出前情区块，2 = 出前情区块
{
    const rows = [
        { stageIdx: 1, chunkIdx: 0, text: '当前阶段原文', vector: [1, 0] },
        { stageIdx: 2, chunkIdx: 0, text: '很久以前的前情原文', vector: [0.9, 0.1] },
    ];
    const makeService = historyTopK => createVectorRecallService({
        getSettings: () => ({ recallTopK: 3, recallThresh: 0.5, recallHistoryTopK: historyTopK }),
        getState: () => ({ novelKey: 'k1', stageStates: { 1: true, 2: true }, stageVecDone: { 1: true, 2: true } }),
        defaultSettings: { recallTopK: 3, recallThresh: 0.5, recallHistoryTopK: 2 },
        dbLoadByNovel: async () => rows,
        cosineSim: (a, b) => {
            const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
            const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
            const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
            return dot / (normA * normB);
        },
        isVectorRowCompatible: row => Array.isArray(row?.vector),
        embeddingClient: {
            niRequestEmbeddings: async inputs => inputs.map(() => [1, 0]),
            embedText: async () => [1, 0],
        },
        onVectorQueryCompared: () => {},
    });

    const zero = await makeService(0).recallRelevant('查询', [1], { historicalStages: [2], splitSections: true });
    assert(zero.includes('当前阶段原文'), '前情 0：当前阶段片段仍在', zero);
    assert(!zero.includes('原著前情片段') && !zero.includes('很久以前的前情原文'), '前情 0：不召回前情', zero);

    const two = await makeService(2).recallRelevant('查询', [1], { historicalStages: [2], splitSections: true });
    assert(two.includes('原著前情片段') && two.includes('很久以前的前情原文'), '前情 2：正常召回前情', two);
    console.log('用例11 前情召回条数接入召回服务: 通过');
}

if (failures) {
    console.error(`未来剧情注入测试失败：${failures} 项`);
    process.exit(1);
}
console.log('全部未来剧情注入 / 前情召回条数用例通过');
