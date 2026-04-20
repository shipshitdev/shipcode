// Icons — re-exported from lucide-react so apps import via @shipcode/ui

export { sanitizeResolvedModel } from '@shipcode/shared';
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
  CircleCheck,
  CircleDot,
  Code2,
  Columns2,
  Copy,
  DollarSign,
  ExternalLink,
  FilePlus,
  Folder,
  FolderGit,
  FolderOpen,
  Ghost,
  GitPullRequest,
  Globe,
  ImageIcon,
  Inbox,
  Keyboard,
  Layers,
  LayoutGrid,
  LayoutList,
  ListTodo,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PackageCheck,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Rows2,
  Search,
  Settings,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wand2,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
export type { ActivePipelineCardProps } from './ActivePipelineCard';
export { ActivePipelineCard } from './ActivePipelineCard';
export type { ShipCodeLogoMarkProps } from './brand/ShipCodeLogoMark';
export { ShipCodeLogoMark } from './brand/ShipCodeLogoMark';
export { DiffViewer } from './DiffViewer';
export { IssueCard } from './IssueCard';
export { KanbanBoard } from './KanbanBoard';
export {
  formatProviderModelDisplay,
  formatResolvedModelDisplay,
  inferProviderFromModel,
  MODEL_DISPLAY,
  modelDisplay,
  PROVIDER_DISPLAY,
  providerDisplay,
} from './lib/model-display';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './primitives/dropdown-menu';
export { Input } from './primitives/input';
export { Keycap } from './primitives/keycap';
export { Label } from './primitives/label';
export { Modal, ModalFooter } from './primitives/modal';
export type { PaginationProps } from './primitives/pagination';
export { Pagination } from './primitives/pagination';
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from './primitives/popover';
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
