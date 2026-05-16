export type {
  AttachOptions,
  AxNode,
  BackendNodeId,
  BoundingBox,
  BrowserDriver,
  DriverErrorCode,
  PageMeta,
  ScrollDirection,
  TextBlock,
  WaitForReadyOptions,
} from "./driver.js";
export { DriverError } from "./driver.js";
export type { PerceptionFrame } from "./perception/types.js";
export {
  resolveIndex,
  serializeFrame,
  snapshot,
  type SnapshotOptions,
  type SerializeOptions,
} from "./perception/snapshot.js";
export type {
  Action,
  ActionType,
  ActionResult,
  ActionResultOk,
  ActionResultErr,
  ActionErrorCode,
  ClickAction,
  TypeAction,
  ScrollAction,
  GotoAction,
  WaitForAction,
  DoneAction,
} from "./actions/vocabulary.js";
export { execute } from "./actions/executor.js";
