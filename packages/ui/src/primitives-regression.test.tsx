// @vitest-environment jsdom

import { Activity } from 'lucide-react';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/primitives/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/primitives/command';
import { Input } from '@/primitives/input';
import { Keycap } from '@/primitives/keycap';
import { Label } from '@/primitives/label';
import { Pagination } from '@/primitives/pagination';
import { Skeleton } from '@/primitives/skeleton';
import { StatCard } from '@/primitives/stat-card';
import { Switch } from '@/primitives/switch';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/primitives/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/primitives/tabs';
import { Textarea } from '@/primitives/textarea';

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('primitive component coverage', () => {
  it('renders form primitives with forwarded props and state classes', () => {
    const onCheckedChange = vi.fn();
    const view = renderIntoDom(
      <form>
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Project name" />
        <Textarea mono defaultValue="console.log('ship')" />
        <Checkbox checked onCheckedChange={onCheckedChange} aria-label="Enable feature" />
        <Switch checked aria-label="Enabled" />
        <Keycap>⌘K</Keycap>
        <Skeleton className="h-4 w-10" />
      </form>,
    );

    expect(view.container.textContent).toContain('Name');
    expect(view.container.querySelector('input')?.getAttribute('placeholder')).toBe('Project name');
    expect(view.container.querySelector('textarea')?.className).toContain('font-mono');
    expect(view.container.querySelector('[role="checkbox"]')?.getAttribute('data-state')).toBe(
      'checked',
    );
    expect(view.container.querySelector('[role="switch"]')?.getAttribute('data-state')).toBe(
      'checked',
    );
    expect(view.container.textContent).toContain('⌘K');
    expect(view.container.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true');
    view.cleanup();
  });

  it('renders table, tabs, command, stat card, and pagination primitives', () => {
    const onPageChange = vi.fn();
    const view = renderIntoDom(
      <div>
        <StatCard
          label="Running"
          value={4}
          subtitle="Agents active"
          tone="agent"
          icon={<Activity size={12} />}
        />
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First tab</TabsContent>
          <TabsContent value="two">Second tab</TabsContent>
        </Tabs>
        <Command>
          <CommandInput value="" onValueChange={() => {}} placeholder="Search" />
          <CommandList>
            <CommandEmpty>No commands</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem value="ship">Ship it</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        <Table>
          <TableCaption>Recent runs</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Fix coverage</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <Pagination page={3} totalPages={8} onPageChange={onPageChange} />
      </div>,
    );

    expect(view.container.textContent).toContain('Agents active');
    expect(view.container.textContent).toContain('First tab');
    expect(view.container.textContent).toContain('Ship it');
    expect(view.container.textContent).toContain('Recent runs');

    const next = view.container.querySelector('button[aria-label="Next page"]');
    if (!(next instanceof HTMLButtonElement)) throw new Error('Expected next page button');
    act(() => {
      next.click();
    });

    expect(onPageChange).toHaveBeenCalledWith(4);
    view.cleanup();
  });

  it('omits pagination when there is only one page', () => {
    const view = renderIntoDom(<Pagination page={1} totalPages={1} onPageChange={vi.fn()} />);
    expect(view.container.textContent).toBe('');
    view.cleanup();
  });
});
