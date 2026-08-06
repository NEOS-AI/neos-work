export {
  createEmptyBuffer,
  isConflict,
  isDirty,
  reduceEditorBuffer,
  shouldSkipDiskReload,
  simpleDiffLines,
  type ConflictChoice,
  type EditorBufferEvent,
  type EditorBufferState,
} from './dirty-state.js';

export {
  NEOS_BRIDGE_SOURCE,
  isBridgeInbound,
  type BridgeDomNode,
  type BridgeInboundMessage,
  type BridgeMeasureItem,
  type BridgeMessageType,
  type BridgeOutboundCommand,
  type BridgeSelectPayload,
} from './bridge-types.js';

export { buildBridgeInjectScript, injectBridgeIntoHtml } from './bridge-inject.js';

export {
  bridgeTreeToLayers,
  filterLayers,
  findLayerById,
  findLayerBySelector,
  flattenLayers,
  parseHtmlToLayerTree,
  applyZOrderInHtml,
  reorderSiblingByNeosId,
  reorderSiblingInHtml,
  stampNeosIds,
  toggleLockByNeosId,
  toggleVisibilityByNeosId,
  toggleVisibilityInHtml,
  type ReorderSiblingReason,
  type ReorderSiblingResult,
  type ReorderSiblingSource,
  type ReorderSiblingTarget,
  type ZOrderOp,
} from './html-layers.js';

export {
  extractJsxReturnSnippet,
  isJsxPath,
  jsxSnippetToPseudoHtml,
  parseJsxToLayerTree,
  type JsxLayerParseResult,
} from './jsx-layers.js';

export {
  bboxesFromMultiEntries,
  createEmptySelection,
  editContextFromSelection,
  multiEntriesFromBridge,
  selectionEquals,
  selectionFromBridge,
  selectionFromLayer,
  selectionWithMulti,
  splitPrimaryExtras,
  toggleMultiSelectLayer,
  type MultiSelectEntry,
} from './selection-state.js';

export { DEVICE_PRESETS, resolvePresetWidth, type DevicePreset } from './device-presets.js';
export {
  PreviewFrame,
  postToPreview,
  toPreviewDocument,
  type PreviewFrameProps,
} from './PreviewFrame.js';
export { CodeEditor, type CodeEditorProps } from './CodeEditor.js';
export {
  LayersPanel,
  type LayerReorderPayload,
  type LayersPanelProps,
} from './LayersPanel.js';
export {
  DesignEditor,
  CANVAS_UNDO_CAP,
  mergePeerCanvasFrames,
  type DesignEditorMode,
  type DesignEditorProps,
  type PeerAwarenessHint,
} from './DesignEditor.js';

export {
  applyAlignToHtml,
  applyDistributeToHtml,
  applyGroupResizeToHtml,
  applyPositionDeltaToHtml,
  applySizeDeltaToHtml,
  CANVAS_OVERLAY_PREF_KEY,
  computeAlignDeltas,
  computeDistributeDeltas,
  computeGroupResizeScales,
  elementIdFromSelector,
  isCanvasOverlayEnabled,
  mergePositionDeltaIntoOpenTag,
  mergeSizeDeltaIntoOpenTag,
  readCanvasOverlayPref,
  scaleBBoxFromAnchor,
  writeCanvasOverlayPref,
  type AlignableBox,
  type AlignDelta,
  type AlignEdge,
  type GroupResizeBBox,
} from './canvas-style.js';
export {
  CanvasOverlay,
  type CanvasBBox,
  type CanvasOverlayProps,
  type CanvasTransformEnd,
  type PeerCanvasFrame,
} from './CanvasOverlay.js';
