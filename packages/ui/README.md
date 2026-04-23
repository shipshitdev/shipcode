# @shipshitdev/ui

Shared React UI components for Shipshit.dev projects.

This package is the common UI surface used by ShipCode, ShipCut, ShipLead, and future side projects. It ships typed React components, Lucide icon re-exports, and a small set of Shipshit.dev product primitives.

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
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ShipCodeLogoMark } from '@shipshitdev/ui';

export function Example() {
  return (
    <Card>
      <CardHeader>
        <ShipCodeLogoMark className="size-8" />
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

## Component Groups

Primitives:

- `Alert`, `Badge`, `Button`
- `Card`, `Checkbox`, `Command`
- `Dialog`, `DropdownMenu`, `Input`
- `Keycap`, `Label`, `Modal`
- `OverlayPanel`, `Pagination`, `Popover`
- `Select`, `SettingsRow`, `Skeleton`
- `StatCard`, `Switch`, `Table`
- `Tabs`, `Textarea`

Product components:

- `ActivePipelineCard`
- `DiffViewer`, `SideBySideDiffViewer`
- `IssueCard`, `KanbanBoard`
- `PhaseChip`, `PipelineStatus`
- `PlanViewer`, `ReviewViewer`, `VerificationViewer`
- `StatusMappingEditor`

Brand marks:

- `ShipCodeLogoMark`
- `ShipCutLogoMark`

Utilities:

- `cn`
- `phaseToProgress`
- `sanitizeResolvedModel`
- model display helpers such as `modelDisplay`, `providerDisplay`, and `formatResolvedModelDisplay`

Icons:

- Common Lucide icons are re-exported so product apps can import from one package.

## Versioning

This package is pre-1.0. Patch releases may add exports or make compatibility fixes for Shipshit.dev apps. Breaking UI or token changes should still be called out in release notes before side projects are upgraded.
