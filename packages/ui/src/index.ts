export { cn } from './lib/utils';
export { getStatusBadgeVariant } from './lib/status-variant';
export type { StatusBadgeVariant } from './lib/status-variant';
export { MODEL_DISPLAY, modelDisplay } from './lib/model-display';

// Icons — re-exported from lucide-react so apps import via @shipcode/ui
export {
  Archive,
  ArrowRight,
  Copy,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Folder,
  Globe,
  Keyboard,
  Layers,
  Lock,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';

// Primitives (more added incrementally as tasks need them)
export { Button, buttonVariants } from './primitives/button';
export { Input } from './primitives/input';
export { Badge, badgeVariants } from './primitives/badge';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './primitives/card';
export { Alert, AlertTitle, AlertDescription, alertVariants } from './primitives/alert';
export { Label } from './primitives/label';
export { Textarea } from './primitives/textarea';
export { Switch } from './primitives/switch';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './primitives/table';
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './primitives/dialog';
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './primitives/command';
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './primitives/dropdown-menu';
export { Pagination } from './primitives/pagination';
export type { PaginationProps } from './primitives/pagination';
export { SettingsRow } from './primitives/settings-row';

// Domain components
export { PipelineStatus } from './PipelineStatus';
export { PlanViewer } from './PlanViewer';
export { ReviewViewer } from './ReviewViewer';
export { VerificationViewer } from './VerificationViewer';
export { KanbanBoard } from './KanbanBoard';
export { IssueCard } from './IssueCard';
export { DiffViewer } from './DiffViewer';
export { StatusMappingEditor } from './StatusMappingEditor';
