// 修复项回归测试（纯函数部分）：
// 1) 世界设定「删空最后一个大类」后不再被默认大类顶替
// 2) 穿书节点正文为空时，阶段直注取文必须回退（返回 null）而不是注入一行空标题
// 3) ZIP 解析只接受本扩展导出的 store(0) 格式，压缩/数据描述符结构明确报错
// 运行：node test-fix-regressions.mjs（失败非零退出）
import { niSelectWorldCategories, niCloneWorldDefaultCategories } from './lib/world-system.js';
import { niBuildTransbookStageDetailText } from './lib/injection-system.js';
import { _parseZip } from './lib/storage-system.js';

let failures = 0;
const assert = (cond, ...args) => {
    if (!cond) failures++;
    console.assert(cond, ...args);
};

const DEFAULTS = [
    { id: 'geo', label: '地理环境', enabled: true, content: '' },
    { id: 'faction', label: '势力组织', enabled: true, content: '' },
];

// 1) 用户显式删空 → 必须保持空数组，不再复活默认大类
{
    const empty = [];
    const result = niSelectWorldCategories(empty, DEFAULTS);
    assert(Array.isArray(result) && result.length === 0, '空数组应原样返回（删除最后一个大类不被撤销）', result);
    console.log('用例1 世界大类删空不回填: 通过');
}

// 2) 从未初始化（null/undefined）→ 使用默认大类
{
    const fromNull = niSelectWorldCategories(null, DEFAULTS);
    const fromUndef = niSelectWorldCategories(undefined, DEFAULTS);
    assert(fromNull.length === DEFAULTS.length && fromUndef.length === DEFAULTS.length, '未初始化时返回默认大类');
    assert(fromNull !== DEFAULTS, '默认大类应是克隆，不共享引用');
    assert(fromNull.every(c => c.content === ''), '默认大类内容应为空');
    console.log('用例2 未初始化用默认大类: 通过');
}

// 3) 有内容的自定义大类原样返回（同一引用，避免每次读取都重建）
{
    const custom = [{ id: 'x', label: '自定义', enabled: false, content: '内容' }];
    const result = niSelectWorldCategories(custom, DEFAULTS);
    assert(result === custom, '自定义大类应原样返回同一引用');
    console.log('用例3 自定义大类原样返回: 通过');
}

// 4) 穿书 nodes 模式：正文为空 → 返回 null（让调用方退回整阶段逻辑）
{
    const emptyBody = niBuildTransbookStageDetailText(2, { stageIdx: 2, title: '某节点', body: '' });
    assert(emptyBody === null, '正文为空必须返回 null，不能注入空标题行', emptyBody);
    const whitespaceBody = niBuildTransbookStageDetailText(2, { stageIdx: 2, title: '某节点', body: '   ' });
    assert(whitespaceBody === null, '纯空白正文同样返回 null', whitespaceBody);
    console.log('用例4 穿书空正文回退: 通过');
}

// 5) 穿书 nodes 模式：有正文 → 正常输出标题与正文
{
    const text = niBuildTransbookStageDetailText(2, { stageIdx: 2, title: '某节点', body: '正文内容' });
    assert(typeof text === 'string' && text.includes('某节点') && text.includes('正文内容'), '有正文时正常输出', text);
    console.log('用例5 穿书正常取文: 通过');
}

// 6) 穿书 compressed 模式：取不到原文同样回退
{
    const noChunk = niBuildTransbookStageDetailText(2, { stageIdx: 2, title: 'n', body: '正文' }, {
        rawMode: 'compressed',
        getCompressedChunkText: () => '',
    });
    assert(noChunk === null, '压缩原文为空时返回 null', noChunk);
    const withChunk = niBuildTransbookStageDetailText(2, { stageIdx: 2, title: 'n', body: '正文', _chunkIdx: 5 }, {
        rawMode: 'compressed',
        getCompressedChunkText: idx => (idx === 5 ? '第 5 段原文' : ''),
    });
    assert(typeof withChunk === 'string' && withChunk.includes('第 5 段原文'), '能取到原文时正常输出', withChunk);
    console.log('用例6 穿书压缩原文取文: 通过');
}

// 7) 节点不属于该阶段时不替换取文
{
    const mismatch = niBuildTransbookStageDetailText(3, { stageIdx: 2, title: 'n', body: '正文' });
    assert(mismatch === null, '节点阶段与请求阶段不一致时返回 null', mismatch);
    console.log('用例7 阶段不匹配保护: 通过');
}

// 8) ZIP 解析：store(0) 正常解析，deflate 与数据描述符结构明确报错
{
    const enc = new TextEncoder();
    const buildZip = ({ name = 'a.json', data = '{"ok":1}', method = 0, flags = 0 }) => {
        const nameBytes = enc.encode(name);
        const dataBytes = enc.encode(data);
        const buf = new ArrayBuffer(30 + nameBytes.length + dataBytes.length);
        const view = new DataView(buf);
        const u8 = new Uint8Array(buf);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);           // version needed
        view.setUint16(6, flags, true);        // general purpose flags
        view.setUint16(8, method, true);       // compression method
        view.setUint16(10, 0, true);           // mod time
        view.setUint16(12, 0, true);           // mod date
        view.setUint32(14, 0, true);           // crc32（解析器不校验）
        view.setUint32(18, dataBytes.length, true);
        view.setUint32(22, dataBytes.length, true);
        view.setUint16(26, nameBytes.length, true);
        view.setUint16(28, 0, true);
        u8.set(nameBytes, 30);
        u8.set(dataBytes, 30 + nameBytes.length);
        return buf;
    };

    const parsed = _parseZip(buildZip({}));
    const decoded = new TextDecoder().decode(parsed['a.json']);
    assert(decoded === '{"ok":1}', 'store(0) ZIP 应正常解析', decoded);

    let deflateError = null;
    try { _parseZip(buildZip({ method: 8 })); } catch (e) { deflateError = e; }
    assert(deflateError && /压缩方式/.test(deflateError.message), 'deflate 压缩必须明确报错', deflateError?.message);

    let descriptorError = null;
    try { _parseZip(buildZip({ flags: 0x0008 })); } catch (e) { descriptorError = e; }
    assert(descriptorError && /数据描述符/.test(descriptorError.message), '数据描述符结构必须明确报错', descriptorError?.message);
    console.log('用例8 ZIP 解析校验: 通过');
}

if (failures) {
    console.error(`修复回归测试失败：${failures} 项`);
    process.exit(1);
}
console.log('全部修复回归用例通过');
