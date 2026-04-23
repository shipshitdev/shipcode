# @shipshitdev/ui

Shared React UI components for Shipshit.dev projects.

This package is the common UI surface used by ShipCode, ShipCut, ShipLead, and future side projects. It ships typed React components, Lucide icon re-exports, and a small set of Shipshit.dev product primitives.

For the component boundary rules and extraction backlog, see [COMPONENT_TAXONOMY.md](./COMPONENT_TAXONOMY.md).

Current status: this package is the cross-project base, but it is not yet a clean full replacement for product UI packages such as `@genfeedai/ui`. It currently exposes only the root `"."` package export and still includes some ShipCode-specific compatibility exports. The target split is documented in the taxonomy.

## Install

```bash
bun add @shipshitdev/ui
```

React and React DOM are peer dependencies:

```json
{
  "react": "18.0.0 || ^19.0.0",
  "react-dom": "18.0.0 || ^19.0.0"
}
```

## Usage

```tsx
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@shipshitdev/ui';

export function Example() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ship fast</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Badge variant="success">Ready</Badge>
        <Button>Continue</Button>
      </CardContent>
    </Card>
  );
}
```

## Styling Contract

The package does not ship a global stylesheet. Components are Tailwind-class based and expect the consuming app to provide the Shipshit.dev design tokens used across the product suite, such as:

```css
/* examples, not the full token set */
--primary: ...
--secondary: ...
--muted: ...
--border: ...
--accent: ...
--success: ...
--warning: ...
--danger: ...
```

If your Tailwind setup does not scan dependencies automatically, include this package as a source. For Tailwind v4:

```css
@source "../../node_modules/@shipshitdev/ui/dist";
```

Adjust the relative path for your app.

## Exports

Primary import:

```ts
import { Button, Card, cn } from '@shipshitdev/ui';
```

The package publishes ESM, CJS, and TypeScript declarations:

```json
{
  "import": "./dist/index.js",
  "require": "./dist/index.cjs",
  "types": "./dist/index.d.ts"
}
```

Planned exports:

- `@shipshitdev/ui/primitives`
- `@shipshitdev/ui/common`
- `@shipshitdev/ui/design`
- `@shipshitdev/ui/workflows`
- `@shipshitdev/ui/code`
- `@shipshitdev/ui/brand`
- `@shipshitdev/ui/shipcode`
- `@shipshitdev/ui/styles.css`

These subpaths are not implemented yet in `0.4.8`.

## Component Groups

The target package shape is:

- `primitives/` - low-level Radix/Tailwind primitives.
- `common/` - reusable product UI patterns.
- `design/` - tokens, themes, and visual utilities.
- `workflows/` - reusable workflow surfaces such as kanban boards and activity feeds.
- `code/` - developer/code-review UI.
- `shipcode/` - ShipCode-only UI kept out of generic categories.

Primitives:

- `Alert`, `Badge`, `Button`
- `Card`, `Checkbox`, `Command`
- `Dialog`, `DropdownMenu`, `Input`
- `Keycap`, `Label`, `Modal`
- `OverlayPanel`, `Pagination`, `Popover`
- `Select`, `SettingsRow`, `Skeleton`
- `StatCard`, `Switch`, `Table`
- `Tabs`, `Textarea`

Common / workflow candidates:

- `IssueCard`, `KanbanBoard`
- `LoadingButtonContent`
- `OverlayPanel`
- `Pagination`
- `SettingsRow`
- `StatCard`

ShipCode-specific components currently exported for compatibility:

- `ActivePipelineCard`
- `DiffViewer`, `SideBySideDiffViewer`
- `PhaseChip`, `PipelineStatus`
- `PlanViewer`, `ReviewViewer`, `VerificationViewer`
- `StatusMappingEditor`

Product logo marks currently exported for compatibility:

- `ShipCodeLogoMark`
- `ShipCutLogoMark`

These are not part of the target shared base contract. Product logos should live in their owning monorepos, e.g. GenFeed logos stay in GenFeed and ShipLead logos stay in ShipLead.

Utilities:

- `cn`
- `phaseToProgress`
- `sanitizeResolvedModel`
- model display helpers such as `modelDisplay`, `providerDisplay`, and `formatResolvedModelDisplay`

Icons:

- Common Lucide icons are re-exported so product apps can import from one package.

## Versioning

This package is pre-1.0. Patch releases may add exports or make compatibility fixes for Shipshit.dev apps. Breaking UI or token changes should still be called out in release notes before side projects are upgraded.
