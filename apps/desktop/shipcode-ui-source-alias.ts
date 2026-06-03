import path from 'node:path';
import type { Plugin } from 'vite';

export function shipcodeUiSourceAlias({
  uiSrc,
  rendererSrc,
}: {
  uiSrc: string;
  rendererSrc?: string;
}): Plugin {
  return {
    name: 'shipcode-ui-source-alias',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === '@shipcode/ui') {
        return path.join(uiSrc, 'index.ts');
      }

      if (source === '@shipcode/ui/second-ticker') {
        return path.join(uiSrc, 'second-ticker.ts');
      }

      if (!source.startsWith('@/')) return null;

      const importerPath = importer ? path.resolve(importer) : '';
      const baseDir = importerPath.startsWith(`${uiSrc}${path.sep}`) ? uiSrc : rendererSrc;
      if (!baseDir) return null;

      return this.resolve(path.join(baseDir, source.slice(2)), importer, {
        ...options,
        skipSelf: true,
      });
    },
  };
}
