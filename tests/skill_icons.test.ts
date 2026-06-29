import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABILITY_IMAGE_IDS, abilityImageUrl } from '../src/ui/icons';

// Gate for the committed WebP class ability icons. The art under
// public/ui/skills/<class>/<id>.webp is the source of truth (WebP only, no PNG/JPG in the
// tree), and abilityImageUrl serves it for the action bar (kind 'ability'), aura/debuff
// frames (kind 'aura'), and the /wiki guide class pages. Two assertions:
//   A) every id wired into ABILITY_IMAGE_IDS has its .webp committed (a wired id without
//      art, or a deleted/renamed file, fails here instead of rendering a blank icon);
//   B) no foreign (non-webp) raster image is committed under public/ui/skills, i.e. a
//      contributor dropped in a .png/.jpg and forgot to run `npm run assets:skills`
//      (scripts/convert_skill_icons_webp.mjs), which converts to webp and deletes the source.
// Filesystem-only (no canvas), so it runs headless on CI in the default node env.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(repoRoot, 'public/ui/skills');

// Foreign raster inputs the convert script normalizes away (must mirror SOURCE_EXTS there).
const FOREIGN_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

describe('class ability webp icons', () => {
  it('has image-backed ability ids wired (guards the fixture)', () => {
    expect(ABILITY_IMAGE_IDS.size).toBeGreaterThan(0);
  });

  it('A) every image-backed ability id resolves to a committed .webp', () => {
    const broken: string[] = [];
    for (const id of ABILITY_IMAGE_IDS) {
      const url = abilityImageUrl(id);
      if (!url) {
        broken.push(`${id} (abilityImageUrl returned null; missing ability class?)`);
        continue;
      }
      expect(url, `${id} must resolve to a webp url`).toMatch(/^\/ui\/skills\/.+\.webp$/);
      const file = path.join(repoRoot, 'public', url.replace(/^\//, ''));
      if (!existsSync(file)) broken.push(`${id} -> ${url} (missing file)`);
    }
    expect(broken).toEqual([]);
  });

  it('B) commits only webp images (no unconverted png/jpg/etc.)', () => {
    const foreign = walk(skillsDir)
      .filter((p) => FOREIGN_IMAGE_EXTS.has(path.extname(p).toLowerCase()))
      .map((p) => path.relative(repoRoot, p));
    expect(
      foreign,
      'non-webp image(s) committed; run `npm run assets:skills` to convert and delete them',
    ).toEqual([]);
  });
});
