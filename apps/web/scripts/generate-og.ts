/**
 * Generates the OG / Twitter card image as a static PNG.
 * Run: bun run scripts/generate-og.ts
 *
 * Output: public/og.png (1200x630)
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { ReactNode } from 'react';
import satori from 'satori';

const WIDTH = 1200;
const HEIGHT = 630;

async function loadFont(family: string, weight: number): Promise<ArrayBuffer> {
  // Google Fonts CSS API — request ttf format by using a basic user-agent
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  const cssRes = await fetch(cssUrl, {
    headers: {
      // Basic UA gets ttf format (satori needs ttf/woff, not woff2)
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const css = await cssRes.text();
  // Match ttf URL from the CSS
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('truetype'\)/);
  if (!match)
    throw new Error(
      `Could not find truetype font URL for ${family}:${weight}\nCSS:\n${css.slice(0, 500)}`,
    );
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

async function main() {
  const [interRegular, interSemibold, monoRegular] = await Promise.all([
    loadFont('Inter', 400),
    loadFont('Inter', 600),
    loadFont('JetBrains Mono', 400),
  ]);

  const element: ReactNode = {
    type: 'div',
    key: 'root',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#09090b',
        backgroundImage:
          'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.06), transparent 60%)',
        fontFamily: 'Inter',
        padding: '60px 80px',
      },
      children: [
        // Badge
        {
          type: 'div',
          key: 'badge',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderRadius: '9999px',
              padding: '8px 20px',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.18em',
              color: '#a1a1aa',
              textTransform: 'uppercase' as const,
              marginBottom: '32px',
            },
            children: 'SHIPCODE',
          },
        },
        // Headline line 1
        {
          type: 'div',
          key: 'h1',
          props: {
            style: {
              display: 'flex',
              fontSize: '60px',
              fontWeight: 600,
              letterSpacing: '-0.04em',
              color: '#fafafa',
              lineHeight: 1.15,
            },
            children: 'From issue queue',
          },
        },
        // Headline line 2
        {
          type: 'div',
          key: 'h2',
          props: {
            style: {
              display: 'flex',
              fontSize: '60px',
              fontWeight: 600,
              letterSpacing: '-0.04em',
              color: '#fafafa',
              lineHeight: 1.15,
            },
            children: 'to reviewed PR.',
          },
        },
        // Terminal block
        {
          type: 'div',
          key: 'terminal',
          props: {
            style: {
              display: 'flex',
              marginTop: '44px',
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: '12px',
              padding: '22px 32px',
              gap: '10px',
              fontFamily: 'JetBrains Mono',
              fontSize: '18px',
            },
            children: [
              {
                type: 'span',
                key: 'p',
                props: { style: { color: '#71717a' }, children: '$' },
              },
              {
                type: 'span',
                key: 'c',
                props: {
                  style: { color: '#a1a1aa' },
                  children: 'brew install --cask shipshitdev/tap/shipcode',
                },
              },
            ],
          },
        },
        // Subtext
        {
          type: 'div',
          key: 'sub',
          props: {
            style: {
              display: 'flex',
              marginTop: '28px',
              fontSize: '16px',
              color: '#71717a',
            },
            children: 'Autonomous AI coding pipeline · Desktop app + CLI',
          },
        },
      ],
    },
  } as unknown as ReactNode;

  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Inter', data: interRegular, weight: 400, style: 'normal' as const },
      { name: 'Inter', data: interSemibold, weight: 600, style: 'normal' as const },
      { name: 'JetBrains Mono', data: monoRegular, weight: 400, style: 'normal' as const },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });

  const png = resvg.render().asPng();
  const outDir = join(import.meta.dirname, '..', 'public');
  const outPath = join(outDir, 'og.png');
  writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
