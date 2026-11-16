import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildActionCatalog(root, folder, clips, groups) {
  const posters = join(folder, 'miku-action-posters');
  mkdirSync(posters, { recursive: true });
  const categories = new Map();
  for (const { label, names } of groups) {
    for (const name of names) if (!categories.has(name)) categories.set(name, label);
  }
  const ffmpeg = join(root, 'tools/media/node_modules/ffmpeg-static/ffmpeg.exe');
  const catalog = clips.map(({ source, target: name, frames }) => {
    const digest = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 24);
    const poster = digest + '.png';
    if (!existsSync(join(posters, poster))) {
      execFileSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-threads', '2', '-i', source,
        '-vf', "select=eq(n\\," + Math.floor(frames * .45) + "),crop=480:360,scale=224:168,format=rgba",
        '-frames:v', '1', '-threads', '1', '-y', join(posters, poster),
      ]);
    }
    return { name, category: categories.get(name) ?? '其他', poster, seconds: frames / 24 };
  });
  const rank = new Map([...categories.keys()].map((name, index) => [name, index]));
  catalog.sort((a, b) => (rank.get(a.name) ?? rank.size) - (rank.get(b.name) ?? rank.size));
  writeFileSync(join(folder, 'miku-action-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
}
