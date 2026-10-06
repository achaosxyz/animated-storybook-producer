#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
const runtime = fileURLToPath(new URL('./runtime/', import.meta.url));
const actions = {
  inspect: ['state'], build: ['input'], check: ['job', 'out', 'quality'], preview: ['job', 'port'], render: ['job', 'out', 'quality'],
  'tts check': ['job', 'env-file'], 'tts synthesize': ['job', 'env-file', 'out', 'allow-paid'],
  'asr check': ['audio', 'env-file'], 'asr recognize': ['audio', 'env-file', 'out', 'allow-paid'],
  'music render': ['input', 'out'], 'audio assemble': ['input', 'out'],
  'qa plan': ['job', 'run', 'risks', 'out'], 'qa sample': ['job', 'run', 'plan', 'out'],
  'qa encoded': ['run', 'plan', 'out'], 'qa playback': ['run', 'reuse', 'out'],
  package: ['input', 'out'], deliver: ['run', 'review', 'out'],
};
actions.build.push('out');
export function parse(argv) {
  const args = [...argv]; let action = args.shift();
  if (['tts', 'asr', 'music', 'audio', 'qa'].includes(action)) action += ` ${args.shift()}`;
  if (!actions[action]) throw Object.assign(new Error('Unknown command; use --help'), { code: 'INVALID_ARGUMENT' });
  const opts = {};
  while (args.length) {
    const flag = args.shift(); const key = flag?.slice(2);
    if (!flag?.startsWith('--') || ![...actions[action], 'workspace'].includes(key) || key in opts) throw Object.assign(new Error('Unknown or duplicate option'), { code: 'INVALID_ARGUMENT' });
    if (key === 'allow-paid') opts[key] = true;
    else { if (!args.length || args[0].startsWith('--')) throw Object.assign(new Error('Missing option value'), {code:'INVALID_ARGUMENT'}); opts[key] = args.shift(); }
  }
  const required = ['workspace'];
  if (['build','music render','audio assemble','package'].includes(action)) required.push('input');
  if (['build','check','render','tts synthesize','asr recognize','music render','audio assemble','package','deliver'].includes(action) || action.startsWith('qa ')) required.push('out');
  if (['check','render','preview','qa sample','tts check','tts synthesize'].includes(action)) required.push('job');
  if (['qa sample','qa encoded','qa playback','deliver'].includes(action)) required.push('run');
  if (['qa sample','qa encoded'].includes(action)) required.push('plan');
  if (action === 'asr recognize') required.push('audio');
  if (action === 'deliver') required.push('review');
  if(action==='qa plan' && (!opts.job===!opts.run)) throw Object.assign(new Error('qa plan requires exactly one of --job or --run'),{code:'INVALID_ARGUMENT'});
  for (const key of required) if (!opts[key]) throw Object.assign(new Error(`Required: --${key}`),{code:'INVALID_ARGUMENT'});
  for (const key of ['workspace','input','job','out','run','plan','risks','review','state','reuse','env-file','audio']) if (opts[key]) opts[key] = path.resolve(opts[key]);
  return { action, opts };
}
export async function main(argv) {
  if (argv.length === 1 && ['--help','-h'].includes(argv[0])) {
    console.log('animated-storybook-producer 0.1.0\nAll commands require --workspace PATH. Paths resolve from the calling cwd. Outputs must be new directories.\n' + Object.entries(actions).map(([k,v]) => `${k}: ${v.map(x=>'--'+x+(x==='allow-paid'?'':' VALUE')).join(' ')}`).join('\n') + '\nSee references/cli.md for required arguments and input contracts.'); return;
  }
  const { action, opts } = parse(argv); opts.workspace = await realpath(opts.workspace);
  process.env.STORYBOOK_WORKSPACE = opts.workspace;
  const io = await import('./runtime/src/producer-io.mjs');
  for (const key of ['input','job','run','plan','risks','review','state','reuse','audio']) if (opts[key]) opts[key] = await io.input(opts.workspace, opts[key]);
  if (opts.out) opts.out = await io.output(opts.workspace, opts.out);
  // A private explicitly selected env file may live outside the media workspace.
  if (action.startsWith('tts ') || action.startsWith('asr ')) {
    const [group, op] = action.split(' '); const forwarded = [op];
    for (const key of ['job','audio','out']) if (opts[key]) forwarded.push('--'+key,opts[key]);
    forwarded.push('--env',opts['env-file'] ?? path.join(opts.workspace,'.env',`volcengine-${group}.env`));
    if (opts['allow-paid']) forwarded.push('--allow-paid');
    await (await import(`./runtime/scripts/${group}.mjs`)).main(forwarded); return;
  }
  if (['check','preview','render'].includes(action)) {
    const marker = await io.json(path.join(path.dirname(opts.job),'build.json'));
    if (marker.status !== 'completed' || marker.job !== path.basename(opts.job)) io.fail('BUILD_REQUIRED','Use a new producer build, not an approved source directory');
    const current = await (await import('./runtime/src/job.mjs')).prepareJob(opts.job);
    if(JSON.stringify(current.sources)!==JSON.stringify(marker.compiled_sources))io.fail('SOURCE_CHANGED','Build content changed; create a new build');
    const forwarded = [action,'--job',opts.job];
    for (const key of ['out','quality','port']) if (opts[key]) forwarded.push('--'+key,opts[key]);
    await (await import('./runtime/scripts/factory.mjs')).main(forwarded); return;
  }
  const result = await (await import('./runtime/src/producer-operations.mjs')).execute(action, opts);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(JSON.stringify({ status:'failed',code:e.code??'ERROR',message: e.code === 'ENOENT' ? `Required file or dependency missing; install locked dependencies in ${runtime}` : (e.code ? e.message : 'Local operation failed; inspect retained run evidence') })); process.exitCode=1; });
}
