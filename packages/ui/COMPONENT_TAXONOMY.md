# @shipshitdev/ui Component Taxonomy

`@shipshitdev/ui` should be the shared Shipshit.dev UI foundation, not a dumping ground for every app-specific component. Projects should extend the shared package only when a component is generic enough to work across ShipCode, GenFeed, ShipLead, ShipCut, and future v0-generated projects.

## Package Shape

Target source layout:

```txt
src/
  primitives/   # low-level Radix/Tailwind primitives
  common/       # generic reusable product UI patterns
  design/       # tokens, theme helpers, brand-neutral visual utilities
  workflows/    # reusable workflow surfaces such as boards, timelines, task lists
  code/         # developer/code-review specific UI
  brand/        # shared Shipshit.dev brand atoms only
  shipcode/     # ShipCode-only UI that should not leak into common exports
```

Export policy:

- Root export may expose stable `primitives`, `common`, `design`, `workflows`, and selected `brand` components.
- Product-specific exports should move behind explicit subpaths later, e.g. `@shipshitdev/ui/shipcode`.
- New components must start in the narrowest category. Promote to `common` only after at least two products need the same abstraction.

## Coverage Status

This document is the target architecture. The current published package does not fully implement it yet.

| Requirement | Status | Notes |
| --- | --- | --- |
| Use `@shipshitdev/ui` as cross-project base | Partially implemented | ShipCode, ShipCut, and ShipLead can consume the primitive layer. GenFeed should extend it, not replace `@genfeedai/ui` wholesale yet. |
| Not a full drop-in replacement for `@genfeedai/ui` | Covered by policy | GenFeed keeps its app shells, workflows, marketing, desktop, auth, PWA, and domain-heavy surfaces until they are intentionally generalized. |
| Base package includes primitives/forms/overlays/nav/feedback | Partially implemented | Many primitives exist. Missing common primitives from GenFeed are listed in the extraction backlog. |
| Tokens/CSS exports | Not implemented | Package currently expects consuming apps to define Tailwind/CSS tokens and scan `dist`. Add explicit `@shipshitdev/ui/styles.css` and token exports before treating this as complete. |
| Subpath exports | Not implemented | `package.json` currently exposes only `"."`. Add subpaths before splitting product-specific components. |
| No Next-only imports in base package | Covered by policy, verify continuously | Shared components must remain React-only. No `next/*` imports should enter `primitives`, `common`, `design`, `workflows`, or `code`. |
| No app-domain models in base package | Not implemented | Current root exports still include ShipCode pipeline types/helpers. Move them to `shipcode/` and remove them from common exports. |
| Product-specific UI outside base | Not implemented | ShipCode components and product logo marks are still root-exported for compatibility. Migration target is shared-only root exports plus product-local extension packages. |
| Kanban board shared | Partially implemented | `KanbanBoard` is exported, but still has issue/GitHub naming. Generalize to work-item props/renderers. |
| GenFeed extends `@shipshitdev/ui` | Not implemented | `@genfeedai/ui` should re-export/compose primitives from `@shipshitdev/ui`, then keep GenFeed-specific workflows locally. |

## Target Public API

Desired package exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./primitives": "./dist/primitives/index.js",
    "./common": "./dist/common/index.js",
    "./design": "./dist/design/index.js",
    "./workflows": "./dist/workflows/index.js",
    "./code": "./dist/code/index.js",
    "./brand": "./dist/brand/index.js",
    "./shipcode": "./dist/shipcode/index.js",
    "./styles.css": "./dist/styles.css"
  }
}
```

Root export should stay conservative:

- `primitives`
- broadly used `common`
- broadly used `workflows`
- stable `design` helpers
- shared Shipshit.dev brand atoms

Root export should not include:

- ShipCode pipeline types
- model/provider display helpers tied to agent execution
- plan/review/verification viewers
- app shells
- auth providers
- marketing pages
- product workflow models

## Base Package Guardrails

Components in `primitives/`, `common/`, `design/`, `workflows/`, and `code/` must not import:

- `next/*`
- app routers
- auth/session providers
- database clients or generated model types
- product-specific constants from GenFeed, ShipCode, ShipCut, or ShipLead
- environment variables

They may import:

- React
- Radix primitives
- `lucide-react`
- package-local utilities
- Tailwind class helpers
- generic TypeScript types defined in the same component folder

## Categories

### Common Primitives

Keep in `primitives/`. These are foundational, brand-neutral, and safe for every app.

- `Alert`
- `Badge`
- `Button`
- `Card`
- `Checkbox`
- `Command`
- `Dialog`
- `DropdownMenu`
- `Input`
- `Keycap`
- `Label`
- `Modal`
- `OverlayPanel`
- `Pagination`
- `Popover`
- `Select`
- `SettingsRow`
- `Skeleton`
- `StatCard`
- `Switch`
- `Table`
- `Tabs`
- `Textarea`
- `cn`
- Lucide icon re-exports

Add next from GenFeed when needed:

- `Accordion`
- `Avatar`
- `Breadcrumb`
- `Calendar`
- `Collapsible`
- `Drawer`
- `Progress`
- `RadioGroup`
- `ScrollArea`
- `Separator`
- `Sheet`
- `Slider`
- `Toggle`
- `ToggleGroup`
- `Tooltip`

### Common Product UI

Generic patterns that should be usable by GenFeed, ShipLead, ShipCut, and ShipCode.

Current candidates:

- `LoadingButtonContent`
- `Pagination`
- `StatCard`
- `SettingsRow`
- `OverlayPanel`

Extract/adapt from GenFeed:

- `EmptyState`
- `MetricCard` / `KeyMetric`
- `BentoGrid` / `BentoItem`
- `CommandPalette` shell, without GenFeed-specific providers
- `PageHeader`
- `ListPageLayout`
- `ViewToggle`
- `FiltersBar` / `FiltersButton`, if made data-agnostic
- `InsetSurface`
- `TrendBadge`
- `StatusDot`
- `PlatformBadge`, only if platform list is configurable
- `ButtonDropdown`
- `RefreshButton`
- `Masonry`, if data/render-prop based

Do not import GenFeed business constants into this package. Common components should receive labels, options, badges, metrics, and callbacks as props.

### Design System

Belongs in `design/` when extracted:

- Semantic color tokens
- Motion tokens
- Radius tokens
- Spacing tokens
- Typography tokens
- Web/native token generators, if kept framework-neutral

GenFeed has a stronger token system than current `@shipshitdev/ui`. The right path is to adapt the token model, not copy GenFeed brand values wholesale.

### Workflows

Reusable work-management components that apply to many products.

Keep/promote:

- `KanbanBoard`: common. It is useful for tasks, leads, content workflows, clips, issues, and pipeline states.
- Future `Timeline` / `ActivityFeed`: common if item rendering is prop-driven.
- Future `TaskList` / `TaskComposer`: common if product content types are injected.
- Future `WorkflowBuilder`: common only after removing GenFeed-specific content/model assumptions.

Current `KanbanBoard` should become less ShipCode-shaped over time:

- Rename issue-specific types to generic work-item types.
- Keep GitHub/PR links optional.
- Accept render props for card metadata and actions.
- Keep DnD optional and data-model agnostic.

### Code / Developer UI

Belongs in `code/` or `shipcode/`, depending on specificity.

Common developer UI candidates:

- Generic `DiffViewer`
- Generic `SideBySideDiffViewer`
- File tree / changed-file list, if introduced later
- Log viewer / terminal output viewer, if introduced later

ShipCode-only until generalized:

- `PlanViewer`
- `ReviewViewer`
- `VerificationViewer`
- `StatusMappingEditor`
- `PipelineStatus`
- `PhaseChip`
- `ActivePipelineCard`
- `modelDisplay` / provider display helpers
- ShipCode pipeline types and helpers

The current `DiffViewer` is useful, but it should not be root-exported as a product primitive until it is clearly generic and free of ShipCode assumptions.

### Brand

`brand/` is not for product logos. It is for brand-neutral or Shipshit.dev-level atoms shared by every product.

Allowed:

- Shipshit.dev family mark, if introduced.
- Shared loading/identity atoms that do not refer to one product.
- Brand-neutral visual utilities.

Not allowed:

- `GenFeedLogoMark`
- `ShipLeadLogoMark`
- `ShipCutLogoMark`
- `ShipCodeLogoMark`
- Product app shells
- Product marketing page sections

Current compatibility debt:

- `ShipCodeLogoMark` and `ShipCutLogoMark` are still exported today because older projects already consume them.
- Target state is to move product logos into their owning monorepos.
- If a product logo must remain publishable during migration, expose it only through a product-specific subpath, not root or `brand/`.

Do not put full app shells, marketing pages, pricing pages, or auth flows in `brand/`.

### Product-Specific Components

These should stay in the owning product package unless generalized.

ShipCode-specific:

- `ShipCodeLogoMark`
- Pipeline execution/review/verification surfaces
- GitHub issue pipeline cards
- Agent model/provider display helpers
- Status mapping editor

GenFeed-specific:

- `GenFeedLogoMark`
- AI caption/hashtag buttons
- Content/article/post generation forms
- Brand and organization providers
- Media/ingredient/storyboard/studio components
- Credits/subscription guards and upgrade modals
- PWA helpers specific to GenFeed apps
- Analytics cards/charts with GenFeed platform assumptions
- Prompt bars tied to GenFeed content models
- Rich editor pieces tied to GenFeed serializers
- Workflow builder pieces tied to GenFeed content pipelines

ShipCut-specific:

- `ShipCutLogoMark`
- Clip/video editing timeline controls
- Caption/video preview flows
- Export/render controls
- ShipCut brand/app shell

ShipLead-specific:

- `ShipLeadLogoMark`
- Lead/business/contact models
- CRM/import/enrichment flows
- Outreach sequence surfaces
- ShipLead brand/app shell

## Migration Rules

Use this decision test before moving a component into `@shipshitdev/ui`:

1. Can at least two products use it without product model imports?
2. Can labels, status values, metrics, and actions be passed as props?
3. Does it avoid app routers, auth/session providers, database models, and business constants?
4. Does it work with only React, Tailwind classes, Radix primitives, and package-local helpers?
5. Does it have a stable name that is not tied to one product?

If yes, move it into `common/`, `workflows/`, `design/`, or `code/`.

If no, keep it in the product package and maybe extract smaller primitives first.

## Initial Extraction Backlog

Priority 1: package hygiene

- Add subpath exports for `primitives`, `common`, `design`, `workflows`, `code`, `brand`, and `shipcode`.
- Add CSS/token exports, including a stable `styles.css` entry or documented token module.
- Add guard tests that fail if base folders import `next/*` or app-domain model packages.
- Move ShipCode-only components into `src/shipcode/`.
- Move code-review components into `src/code/`.
- Move `KanbanBoard` into `src/workflows/kanban/`.
- Keep backwards-compatible root exports during migration.

Priority 2: common primitives from GenFeed

- `Avatar`
- `Breadcrumb`
- `Drawer`
- `Progress`
- `RadioGroup`
- `ScrollArea`
- `Separator`
- `Sheet`
- `Tooltip`

Priority 3: common product patterns

- `EmptyState`
- `MetricCard`
- `PageHeader`
- `ListPageLayout`
- `ViewToggle`
- `FiltersBar`
- `CommandPalette` shell
- `BentoGrid`

Priority 4: common workflows

- Generalize `KanbanBoard`.
- Extract an `ActivityFeed`.
- Extract a `TaskComposer` after content-type props are generic.

Priority 5: product packages

- Keep GenFeed's broad `@genfeedai/ui` as canonical until extracted pieces are stable.
- Keep ShipCut and ShipLead app-specific shells local.
- Consume `@shipshitdev/ui` for primitives/common/workflow components first, then extend locally only when the package is not generic enough.
