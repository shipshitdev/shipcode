// Icons — re-exported from lucide-react so apps import via @shipcode/ui
export {
  Activity,
  Archive,
  ArrowRight,
  ArrowUpDown,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  DollarSign,
  ExternalLink,
  Folder,
  Globe,
  Inbox,
  Keyboard,
  Layers,
  LayoutGrid,
  ListTodo,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
export { DiffViewer } from './DiffViewer';
export { IssueCard } from './IssueCard';
export { KanbanBoard } from './KanbanBoard';
export { MODEL_DISPLAY, modelDisplay } from './lib/model-display';
export type { StatusBadgeVariant } from './lib/status-variant';
export { getStatusBadgeVariant } from './lib/status-variant';
export { cn } from './lib/utils';
export { PhaseChip } from './PhaseChip';
// Domain components
export { PipelineStatus } from './PipelineStatus';
export { PlanViewer } from './PlanViewer';
export { Alert, AlertDescription, AlertTitle, alertVariants } from './primitives/alert';
export { Badge, badgeVariants } from './primitives/badge';
// Primitives (more added incrementally as tasks need them)
export { Button, buttonVariants } from './primitives/button';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './primitives/card';
export { Checkbox } from './primitives/checkbox';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/dropdown-menu';
export { Input } from './primitives/input';
export { Label } from './primitives/label';
export { Modal, ModalFooter } from './primitives/modal';
export type { PaginationProps } from './primitives/pagination';
export { Pagination } from './primitives/pagination';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './primitives/select';
export { SettingsRow } from './primitives/settings-row';
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
export { Tabs, TabsContent, TabsList, TabsTrigger } from './primitives/tabs';
export { Textarea } from './primitives/textarea';
export { ReviewViewer } from './ReviewViewer';
export { StatusMappingEditor } from './StatusMappingEditor';
export { VerificationViewer } from './VerificationViewer';
