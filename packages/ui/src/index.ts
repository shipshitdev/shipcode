export { cn } from './lib/utils'

// Icons — re-exported from lucide-react so apps import via @shipcode/ui
export {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Folder,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'

// Primitives (more added incrementally as tasks need them)
export { Button, buttonVariants } from './primitives/button'
export { Input } from './primitives/input'
export { Badge, badgeVariants } from './primitives/badge'
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './primitives/card'
export { Alert, AlertTitle, AlertDescription, alertVariants } from './primitives/alert'
export { Label } from './primitives/label'
export { Textarea } from './primitives/textarea'
export { Switch } from './primitives/switch'
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './primitives/table'
export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './primitives/dialog'
export { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from './primitives/command'
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select'
export { Pagination } from './primitives/pagination'
export type { PaginationProps } from './primitives/pagination'

// Domain components
export { PipelineStatus } from './PipelineStatus'
export { PlanViewer } from './PlanViewer'
export { ReviewViewer } from './ReviewViewer'
export { VerificationViewer } from './VerificationViewer'
export { KanbanBoard } from './KanbanBoard'
export { IssueCard } from './IssueCard'
export { DiffViewer } from './DiffViewer'
export { StatusMappingEditor } from './StatusMappingEditor'
