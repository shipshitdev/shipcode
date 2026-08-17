/**
 * Nextra folder group headers render `data-href={item.route}` (e.g. `/desktop`)
 * when the folder has no index page. Those bare routes 404 on the marketing
 * host, which serves docs under `/docs`.
 *
 * Attach the existing child page href so the sidebar can link at the real
 * doc (Next.js `basePath` still prefixes `/docs` at build time).
 */
const FOLDER_NAV_HREFS: Record<string, string> = {
  desktop: '/desktop/overview',
  pipeline: '/pipeline/overview',
  cli: '/cli',
};

type PageMapNode = {
  name?: string;
  href?: string;
  children?: PageMapNode[];
  [key: string]: unknown;
};

export function assignFolderNavHrefs<T>(pageMap: T): T {
  const walk = (items: unknown): unknown => {
    if (!Array.isArray(items)) {
      return items;
    }

    return items.map((item) => {
      if (!item || typeof item !== 'object') {
        return item;
      }

      const node = item as PageMapNode;
      const children = node.children ? (walk(node.children) as PageMapNode[]) : node.children;
      const href = typeof node.name === 'string' ? FOLDER_NAV_HREFS[node.name] : undefined;

      if (href && children && children.length > 0) {
        return {
          ...node,
          children,
          href,
        };
      }

      return children ? { ...node, children } : node;
    });
  };

  return walk(pageMap) as T;
}
