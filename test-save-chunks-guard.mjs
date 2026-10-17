// 压缩正文写入保护测试：
// 1) 内存全空 → 绝不写 chunks 文件（防止懒加载状态下保存快照清空服务端正文）
// 2) 部分槽位有正文 → 读服务端旧文件合并（新非空优先、空槽回填旧文）
// 3) 全部有正文 → 原样写入
// 运行：node test-save-chunks-guard.mjs（失败非零退出）
import { createStorageController } from './lib/storage-system.js';

let failures = 0;
const assert = (cond, ...args) => {
    if (!cond) failures++;
    console.assert(cond, ...args);
};

function makeController({ getResponses = {}, onUpload = null } = {}) {
    const uploads = [];
    const S = { novelKey: 'novelA', heavyFileKey: 'fk_A', characters: [], plots: { main: [], sub: [], pivot: [] }, chunkMeta: [], chunkStatus: [], styleGuide: '', chunkResults: [] };
    const storage = createStorageController({
        S,
        extension_settings: {},
        EXT_NAME: 'ni_test',
        DEFAULT_SETTINGS: {},
        q: () => null,
        getRequestHeaders: () => ({}),
        niEnsurePlotNodeId: p => p._nodeId || 'n1',
        saveSettingsDebounced: () => {},
        fetch: async (url, opts = {}) => {
            if (String(url).includes('/user/files/')) {
                const name = String(url).split('/').pop();
                const payload = getResponses[name];
                if (!payload) return { status: 404, ok: false, json: async () => ({}) };
                return { status: 200, ok: true, json: async () => payload };
            }
            if (String(url).includes('/api/files/upload')) {
                const parsed = JSON.parse(opts.body);
                const inner = JSON.parse(Buffer.from(parsed.data, 'base64').toString('utf8'));
                uploads.push({ name: parsed.name, payload: inner });
                onUpload?.(parsed.name, inner);
                return { ok: true };
            }
            return { ok: false, status: 500 };
        },
    });
    return { storage, uploads };
}

const baseData = over => ({
    _characters: [],
    _plots: { main: [], sub: [], pivot: [] },
    _chunkMeta: [],
    _chunkStatus: ['done', 'done', 'done'],
    _styleGuide: '',
    ...over,
});

// 1) 全空 → 不写 chunks 文件
{
    const { storage, uploads } = makeController();
    await storage.niServerSaveHeavyData('novelA', 'fk_A', baseData({ _chunkResults: ['', '', ''] }));
    const chunksUpload = uploads.find(u => u.name.endsWith('_chunks.json'));
    assert(!chunksUpload, '全空正文不得写 chunks 文件', chunksUpload?.name);
    assert(uploads.some(u => u.name.endsWith('_core.json')), 'core 照常写入');
    console.log('用例1 全空保护: 通过 (上传文件:', uploads.map(u => u.name).join(', '), ')');
}

// 2) 部分正文 → 与服务端旧文件合并
{
    const oldChunksPayload = { version: 2, part: 'chunks', novelKey: 'novelA', heavyFileKey: 'fk_A', _chunkResults: ['旧A', '', '旧C'] };
    const { storage, uploads } = makeController({
        getResponses: { 'fk_A_chunks.json': oldChunksPayload },
    });
    await storage.niServerSaveHeavyData('novelA', 'fk_A', baseData({ _chunkResults: ['', '新B', ''] }));
    const chunksUpload = uploads.find(u => u.name.endsWith('_chunks.json'));
    assert(chunksUpload, '部分正文应写 chunks 文件');
    const merged = chunksUpload.payload._chunkResults;
    assert(merged[0] === '旧A' && merged[1] === '新B' && merged[2] === '旧C', '合并：新非空优先、空槽回填旧文', merged);
    console.log('用例2 合并写入: 通过 (合并结果:', JSON.stringify(merged), ')');
}

// 3) 全部正文 → 原样写入
{
    const { storage, uploads } = makeController();
    await storage.niServerSaveHeavyData('novelA', 'fk_A', baseData({ _chunkResults: ['新A', '新B', '新C'] }));
    const chunksUpload = uploads.find(u => u.name.endsWith('_chunks.json'));
    assert(chunksUpload && chunksUpload.payload._chunkResults.join(',') === '新A,新B,新C', '全量正文原样写入', chunksUpload?.payload?._chunkResults);
    console.log('用例3 全量写入: 通过');
}

// 4) 空数组 → 不写 chunks 文件
{
    const { storage, uploads } = makeController();
    await storage.niServerSaveHeavyData('novelA', 'fk_A', baseData({ _chunkResults: [] }));
    assert(!uploads.some(u => u.name.endsWith('_chunks.json')), '空数组不写 chunks 文件');
    console.log('用例4 空数组保护: 通过');
}

if (failures > 0) {
    console.error(`共 ${failures} 条断言失败`);
    process.exit(1);
}
console.log('全部正文写入保护用例通过');
