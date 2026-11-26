import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function verifyAnimations(packageRoot) {
  const manifestUrl = new URL('../../integrations/dsh/pack/release-animations.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const folder = join(packageRoot, 'data-dsh', 'dsh-pet', 'pet', 'miku-animation');
  const actual = new Set(readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.webm'))
    .map(entry => entry.name));
  const problems = [];
  let verified = 0;
  for (const clips of Object.values(manifest.appearances)) {
    for (const clip of clips) {
      const name = clip.name + '.webm';
      if (!actual.delete(name)) {
        problems.push('缺少动作 ' + name);
        continue;
      }
      const digest = createHash('sha256').update(readFileSync(join(folder, name))).digest('hex');
      if (digest !== clip.sha256) problems.push('校验值不符 ' + name);
      else verified++;
    }
  }
  for (const extra of actual) problems.push('清单之外的动画 ' + extra);
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`v${manifest.version} 动画校验通过，共 ${verified} 个文件。`);
}

try {
  if (process.argv.length !== 3) throw new Error('用法：node tools/dsh/verify-release.mjs <已解压的桌宠目录>');
  verifyAnimations(resolve(process.argv[2]));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
