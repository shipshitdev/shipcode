// Icons — re-exported from lucide-react so apps import via @shipshitdev/ui

export {
  Activity,
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUpDown,
  Bell,
  Bot,
  Briefcase,
  Building2,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDot,
  Clock3,
  Code2,
  Columns2,
  Copy,
  DollarSign,
  Download,
  ExternalLink,
  FilePlus,
  Film,
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
  Mail,
  Maximize2,
  MessagesSquare,
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
  Play,
  Plus,
  RefreshCw,
  Rows2,
  Scissors,
  Search,
  Send,
  Settings,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Terminal,
  Trash2,
  Upload,
  UserRound,
  Video,
  Wand2,
  WandSparkles,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
export type { ActivePipelineCardProps } from './ActivePipelineCard';
export { ActivePipelineCard } from './ActivePipelineCard';
export type { ShipCodeLogoMarkProps } from './brand/ShipCodeLogoMark';
export { ShipCodeLogoMark } from './brand/ShipCodeLogoMark';
export type { ShipCutLogoMarkProps } from './brand/ShipCutLogoMark';
export { ShipCutLogoMark } from './brand/ShipCutLogoMark';
export { DiffViewer } from './DiffViewer';
export { IssueCard } from './IssueCard';
export { KanbanBoard } from './KanbanBoard';
export { LoadingButtonContent } from './LoadingButtonContent';
export {
  formatProviderModelDisplay,
  formatResolvedModelDisplay,
  inferProviderFromModel,
  MODEL_DISPLAY,
  modelDisplay,
  PROVIDER_DISPLAY,
  providerDisplay,
} from './lib/model-display';
export type {
  AgentType,
  AppSettings,
  DiffRecord,
  ExecutorModel,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  PipelinePhase,
  PlanReview,
  Project,
  ResolvedPhaseModel,
  ReviewFinding,
  ShipCodePlan,
  StatusLabelMapping,
  Thread,
  ThreadStatus,
  VerificationResult,
} from './lib/shipcode';
export { phaseToProgress, sanitizeResolvedModel } from './lib/shipcode';
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
export type { OverlayPanelProps } from './primitives/overlay-panel';
export { OverlayPanel } from './primitives/overlay-panel';
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
export { Skeleton } from './primitives/skeleton';
export type { StatCardProps, StatCardTone } from './primitives/stat-card';
export { StatCard } from './primitives/stat-card';
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
export type { TextareaProps } from './primitives/textarea';
export { Textarea } from './primitives/textarea';
export { ReviewViewer } from './ReviewViewer';
export { SideBySideDiffViewer } from './SideBySideDiffViewer';
export { StatusMappingEditor } from './StatusMappingEditor';
export { VerificationViewer } from './VerificationViewer';
