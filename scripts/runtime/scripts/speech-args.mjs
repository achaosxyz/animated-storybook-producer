import { parseArgs } from 'node:util';
import { fail } from '../src/job.mjs';

export function parseSpeechArgs(args, actions, options, defaults = {}) {
  const [action, ...flags] = args;
  if (!Object.hasOwn(actions, action)) fail('INVALID_ACTION', `声音入口使用 ${Object.keys(actions).join('、')}`);
  let parsed;
  try { parsed = parseArgs({ args: flags, tokens: true, options }); }
  catch { fail('INVALID_ARGUMENT', '声音参数无效；凭证仅从私有配置读取，不输出原始参数'); }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option' || seen.has(token.name)) fail('INVALID_ARGUMENT', '拒绝重复或未命名声音参数');
    seen.add(token.name);
  }
  const spec = actions[action];
  if (Object.keys(parsed.values).some(k => !spec.allowed.includes(k))) fail('INVALID_ARGUMENT', '参数不属于当前声音操作');
  if (spec.required?.some(k => !parsed.values[k])) fail('INVALID_ARGUMENT', `当前操作需要 ${spec.required.map(k => `--${k}`).join('、')}`);
  return { action, values: { ...defaults, ...parsed.values } };
}
