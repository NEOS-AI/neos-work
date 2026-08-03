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
  stampNeosIds,
  toggleLockByNeosId,
  toggleVisibilityByNeosId,
  toggleVisibilityInHtml,
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
export { LayersPanel, type LayersPanelProps } from './LayersPanel.js';
export {
  DesignEditor,
  type DesignEditorMode,
  type DesignEditorProps,
} from './DesignEditor.js';

export {
  applyGroupResizeToHtml,
  applyPositionDeltaToHtml,
  applySizeDeltaToHtml,
  computeGroupResizeScales,
  elementIdFromSelector,
  isCanvasOverlayEnabled,
  mergePositionDeltaIntoOpenTag,
  mergeSizeDeltaIntoOpenTag,
  scaleBBoxFromAnchor,
  type GroupResizeBBox,
} from './canvas-style.js';
export {
  CanvasOverlay,
  type CanvasBBox,
  type CanvasOverlayProps,
  type CanvasTransformEnd,
} from './CanvasOverlay.js';
