// The icons a host-drawn menu or picker can show, by lucide name. Extensions pass names, never
// markup, and a name outside this set draws no icon. The set is loaded on first use, in its own
// chunk (`menuIcon`), so the app does not carry it until an extension opens a menu with icons.
import type { ExtensionIconComponent } from "./extension-icons";
import PlusIcon from "@lucide/svelte/icons/plus";
import MinusIcon from "@lucide/svelte/icons/minus";
import CheckIcon from "@lucide/svelte/icons/check";
import XIcon from "@lucide/svelte/icons/x";
import CopyIcon from "@lucide/svelte/icons/copy";
import ClipboardIcon from "@lucide/svelte/icons/clipboard";
import ScissorsIcon from "@lucide/svelte/icons/scissors";
import Trash2Icon from "@lucide/svelte/icons/trash-2";
import PencilIcon from "@lucide/svelte/icons/pencil";
import SaveIcon from "@lucide/svelte/icons/save";
import DownloadIcon from "@lucide/svelte/icons/download";
import UploadIcon from "@lucide/svelte/icons/upload";
import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
import LinkIcon from "@lucide/svelte/icons/link";
import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
import RotateCwIcon from "@lucide/svelte/icons/rotate-cw";
import Undo2Icon from "@lucide/svelte/icons/undo-2";
import Redo2Icon from "@lucide/svelte/icons/redo-2";
import SearchIcon from "@lucide/svelte/icons/search";
import FilterIcon from "@lucide/svelte/icons/filter";
import SettingsIcon from "@lucide/svelte/icons/settings";
import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
import EyeIcon from "@lucide/svelte/icons/eye";
import EyeOffIcon from "@lucide/svelte/icons/eye-off";
import StarIcon from "@lucide/svelte/icons/star";
import HeartIcon from "@lucide/svelte/icons/heart";
import BookmarkIcon from "@lucide/svelte/icons/bookmark";
import FlagIcon from "@lucide/svelte/icons/flag";
import PinIcon from "@lucide/svelte/icons/pin";
import TagIcon from "@lucide/svelte/icons/tag";
import FolderIcon from "@lucide/svelte/icons/folder";
import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
import FileIcon from "@lucide/svelte/icons/file";
import FileTextIcon from "@lucide/svelte/icons/file-text";
import FilePlusIcon from "@lucide/svelte/icons/file-plus";
import FileCodeIcon from "@lucide/svelte/icons/file-code";
import ImageIcon from "@lucide/svelte/icons/image";
import PlayIcon from "@lucide/svelte/icons/play";
import PauseIcon from "@lucide/svelte/icons/pause";
import SquareIcon from "@lucide/svelte/icons/square";
import CircleIcon from "@lucide/svelte/icons/circle";
import InfoIcon from "@lucide/svelte/icons/info";
import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
import CircleXIcon from "@lucide/svelte/icons/circle-x";
import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
import BellIcon from "@lucide/svelte/icons/bell";
import LockIcon from "@lucide/svelte/icons/lock";
import LockOpenIcon from "@lucide/svelte/icons/lock-open";
import KeyIcon from "@lucide/svelte/icons/key";
import UserIcon from "@lucide/svelte/icons/user";
import UsersIcon from "@lucide/svelte/icons/users";
import MailIcon from "@lucide/svelte/icons/mail";
import MessageSquareIcon from "@lucide/svelte/icons/message-square";
import SendIcon from "@lucide/svelte/icons/send";
import ShareIcon from "@lucide/svelte/icons/share";
import GitBranchIcon from "@lucide/svelte/icons/git-branch";
import GitCommitHorizontalIcon from "@lucide/svelte/icons/git-commit-horizontal";
import GitMergeIcon from "@lucide/svelte/icons/git-merge";
import CodeIcon from "@lucide/svelte/icons/code";
import TerminalIcon from "@lucide/svelte/icons/terminal";
import TableIcon from "@lucide/svelte/icons/table";
import ListIcon from "@lucide/svelte/icons/list";
import ListChecksIcon from "@lucide/svelte/icons/list-checks";
import LayoutGridIcon from "@lucide/svelte/icons/layout-grid";
import Columns2Icon from "@lucide/svelte/icons/columns-2";
import Rows2Icon from "@lucide/svelte/icons/rows-2";
import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
import ChevronUpIcon from "@lucide/svelte/icons/chevron-up";
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
import MoveIcon from "@lucide/svelte/icons/move";
import Maximize2Icon from "@lucide/svelte/icons/maximize-2";
import Minimize2Icon from "@lucide/svelte/icons/minimize-2";
import ZoomInIcon from "@lucide/svelte/icons/zoom-in";
import ZoomOutIcon from "@lucide/svelte/icons/zoom-out";
import SunIcon from "@lucide/svelte/icons/sun";
import MoonIcon from "@lucide/svelte/icons/moon";
import PaletteIcon from "@lucide/svelte/icons/palette";
import TypeIcon from "@lucide/svelte/icons/type";
import BoldIcon from "@lucide/svelte/icons/bold";
import ItalicIcon from "@lucide/svelte/icons/italic";
import AlignLeftIcon from "@lucide/svelte/icons/align-left";
import CalendarIcon from "@lucide/svelte/icons/calendar";
import ClockIcon from "@lucide/svelte/icons/clock";
import HistoryIcon from "@lucide/svelte/icons/history";
import ArchiveIcon from "@lucide/svelte/icons/archive";
import DatabaseIcon from "@lucide/svelte/icons/database";
import GlobeIcon from "@lucide/svelte/icons/globe";
import ZapIcon from "@lucide/svelte/icons/zap";
import SparklesIcon from "@lucide/svelte/icons/sparkles";
import WandSparklesIcon from "@lucide/svelte/icons/wand-sparkles";
import BugIcon from "@lucide/svelte/icons/bug";
import HashIcon from "@lucide/svelte/icons/hash";
import EllipsisIcon from "@lucide/svelte/icons/ellipsis";

export const menuIcons: Record<string, ExtensionIconComponent> = {
  plus: PlusIcon,
  minus: MinusIcon,
  check: CheckIcon,
  x: XIcon,
  copy: CopyIcon,
  clipboard: ClipboardIcon,
  scissors: ScissorsIcon,
  "trash-2": Trash2Icon,
  pencil: PencilIcon,
  save: SaveIcon,
  download: DownloadIcon,
  upload: UploadIcon,
  "external-link": ExternalLinkIcon,
  link: LinkIcon,
  "refresh-cw": RefreshCwIcon,
  "rotate-ccw": RotateCcwIcon,
  "rotate-cw": RotateCwIcon,
  "undo-2": Undo2Icon,
  "redo-2": Redo2Icon,
  search: SearchIcon,
  filter: FilterIcon,
  settings: SettingsIcon,
  "sliders-horizontal": SlidersHorizontalIcon,
  eye: EyeIcon,
  "eye-off": EyeOffIcon,
  star: StarIcon,
  heart: HeartIcon,
  bookmark: BookmarkIcon,
  flag: FlagIcon,
  pin: PinIcon,
  tag: TagIcon,
  folder: FolderIcon,
  "folder-open": FolderOpenIcon,
  file: FileIcon,
  "file-text": FileTextIcon,
  "file-plus": FilePlusIcon,
  "file-code": FileCodeIcon,
  image: ImageIcon,
  play: PlayIcon,
  pause: PauseIcon,
  square: SquareIcon,
  circle: CircleIcon,
  info: InfoIcon,
  "circle-alert": CircleAlertIcon,
  "triangle-alert": TriangleAlertIcon,
  "circle-check": CircleCheckIcon,
  "circle-x": CircleXIcon,
  "circle-help": CircleHelpIcon,
  bell: BellIcon,
  lock: LockIcon,
  "lock-open": LockOpenIcon,
  key: KeyIcon,
  user: UserIcon,
  users: UsersIcon,
  mail: MailIcon,
  "message-square": MessageSquareIcon,
  send: SendIcon,
  share: ShareIcon,
  "git-branch": GitBranchIcon,
  "git-commit-horizontal": GitCommitHorizontalIcon,
  "git-merge": GitMergeIcon,
  code: CodeIcon,
  terminal: TerminalIcon,
  table: TableIcon,
  list: ListIcon,
  "list-checks": ListChecksIcon,
  "layout-grid": LayoutGridIcon,
  "columns-2": Columns2Icon,
  "rows-2": Rows2Icon,
  "arrow-up": ArrowUpIcon,
  "arrow-down": ArrowDownIcon,
  "arrow-left": ArrowLeftIcon,
  "arrow-right": ArrowRightIcon,
  "chevron-up": ChevronUpIcon,
  "chevron-down": ChevronDownIcon,
  "chevrons-up-down": ChevronsUpDownIcon,
  "arrow-up-down": ArrowUpDownIcon,
  move: MoveIcon,
  "maximize-2": Maximize2Icon,
  "minimize-2": Minimize2Icon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  sun: SunIcon,
  moon: MoonIcon,
  palette: PaletteIcon,
  type: TypeIcon,
  bold: BoldIcon,
  italic: ItalicIcon,
  "align-left": AlignLeftIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  history: HistoryIcon,
  archive: ArchiveIcon,
  database: DatabaseIcon,
  globe: GlobeIcon,
  zap: ZapIcon,
  sparkles: SparklesIcon,
  "wand-sparkles": WandSparklesIcon,
  bug: BugIcon,
  hash: HashIcon,
  ellipsis: EllipsisIcon,
};
