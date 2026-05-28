import type { ProcessorWrapperOptions } from '../ProcessorWrapper';
import type { FrameProcessingStats, SegmenterOptions } from './BackgroundTransformer';

export type AdvancedBackgroundMode = 'background-blur' | 'virtual-background' | 'disabled';

export type AdvancedBlendMode = 'screen' | 'linear-dodge';

export type AdvancedQualityProfileName = 'auto' | 'performance' | 'balanced' | 'quality';

export type AdvancedGpuFallbackReason =
  | 'webgl2-unavailable'
  | 'context-creation-failed'
  | 'texture-size-too-small'
  | 'mask-format-unsupported'
  | 'context-lost'
  | 'restore-failed';

export type AdvancedMaskResolution = {
  width: number;
  height: number;
};

export type AdvancedJointBilateralFilterOptions = {
  enabled?: boolean;
  sigmaSpace?: number;
  sigmaColor?: number;
};

export type AdvancedPostProcessingOptions = {
  maskResolution?: AdvancedMaskResolution;
  maskDownsampleFactor?: number;
  jointBilateralFilter?: AdvancedJointBilateralFilterOptions;
  temporalSmoothing?: number;
  coverage?: [number, number];
  lightWrapping?: number;
  blendMode?: AdvancedBlendMode;
};

export type AdvancedResolvedPostProcessingOptions = {
  maskResolution: AdvancedMaskResolution;
  jointBilateralFilter: Required<AdvancedJointBilateralFilterOptions>;
  temporalSmoothing: number;
  coverage: [number, number];
  lightWrapping: number;
  blendMode: AdvancedBlendMode;
};

export type AdvancedGpuCapabilities = {
  webgl2: boolean;
  maxTextureSize: number;
  supportsFloatTextures: boolean;
  supportsHalfFloatTextures: boolean;
  supportsRenderableMaskTextures: boolean;
  supportsTimerQueries: boolean;
  fallbackReason?: AdvancedGpuFallbackReason;
};

export type AdvancedFrameProcessingStats = FrameProcessingStats & {
  renderTimeMs: number;
  maskProcessingTimeMs: number;
  droppedFrames: number;
  skippedFrames: number;
  qualityProfile: Exclude<AdvancedQualityProfileName, 'auto'>;
  maskResolution: AdvancedMaskResolution;
  contextLossCount: number;
  contextRestoreCount: number;
  resizeCount: number;
  gpuStageTimingsMs?: Record<string, number>;
};

export type AdvancedBackgroundCommonOptions = ProcessorWrapperOptions & {
  qualityProfile?: AdvancedQualityProfileName;
  postProcessing?: AdvancedPostProcessingOptions;
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: AdvancedFrameProcessingStats) => void;
};

export type AdvancedBackgroundBlurOptions = AdvancedBackgroundCommonOptions & {
  mode: 'background-blur';
  blurRadius?: number;
};

export type AdvancedVirtualBackgroundOptions = AdvancedBackgroundCommonOptions & {
  mode: 'virtual-background';
  imagePath: string;
};

export type AdvancedBackgroundDisabledOptions = AdvancedBackgroundCommonOptions & {
  mode: 'disabled';
};

export type AdvancedBackgroundProcessorOptions =
  | AdvancedBackgroundBlurOptions
  | AdvancedVirtualBackgroundOptions
  | AdvancedBackgroundDisabledOptions;

export type AdvancedBackgroundTransformerOptions = {
  blurRadius?: number;
  imagePath?: string;
  backgroundDisabled?: boolean;
  qualityProfile?: AdvancedQualityProfileName;
  postProcessing?: AdvancedPostProcessingOptions;
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: AdvancedFrameProcessingStats) => void;
};

export const DEFAULT_ADVANCED_BLUR_RADIUS = 10;

export const DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS: AdvancedResolvedPostProcessingOptions = {
  maskResolution: { width: 320, height: 180 },
  jointBilateralFilter: {
    enabled: true,
    sigmaSpace: 1,
    sigmaColor: 0.1,
  },
  temporalSmoothing: 0.6,
  coverage: [0.68, 0.83],
  lightWrapping: 0,
  blendMode: 'screen',
};

export const ADVANCED_QUALITY_PROFILES: Record<
  Exclude<AdvancedQualityProfileName, 'auto'>,
  AdvancedResolvedPostProcessingOptions
> = {
  performance: {
    ...DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS,
    maskResolution: { width: 256, height: 144 },
    jointBilateralFilter: {
      ...DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS.jointBilateralFilter,
      enabled: false,
    },
    temporalSmoothing: 0.4,
  },
  balanced: DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS,
  quality: {
    ...DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS,
    maskResolution: { width: 480, height: 270 },
    temporalSmoothing: 0.7,
  },
};
