import type { ProcessorWrapperOptions } from '../ProcessorWrapper';
import type { FrameProcessingStats, SegmenterOptions } from './BackgroundTransformer';

export type JBFBackgroundMode = 'background-blur' | 'virtual-background' | 'disabled';

export type JBFBlendMode = 'screen' | 'linearDodge';

export type JBFDebugOutput =
  | 'none'
  | 'raw-mask'
  | 'dilated-mask'
  | 'jbf-mask'
  | 'temporal-mask'
  | 'coverage-mask';

export type JBFTemporalMode = 'off' | 'temporal' | 'hysteresis';

export type JBFBackgroundCommonOptions = ProcessorWrapperOptions & {
  coverage?: [number, number];
  lightWrapping?: number;
  blendMode?: JBFBlendMode;
  sigmaSpace?: number;
  sigmaColor?: number;
  jointBilateralFilterEnabled?: boolean;
  dilationEnabled?: boolean;
  dilationStrength?: number;
  temporalMode?: JBFTemporalMode;
  temporalAlpha?: number;
  maskFeatheringEnabled?: boolean;
  maskFeatheringStrength?: number;
  hysteresisEnterThreshold?: number;
  hysteresisExitThreshold?: number;
  debugOutput?: JBFDebugOutput;
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: FrameProcessingStats) => void;
};

export type JBFBackgroundBlurOptions = JBFBackgroundCommonOptions & {
  mode: 'background-blur';
  blurRadius?: number;
};

export type JBFVirtualBackgroundOptions = JBFBackgroundCommonOptions & {
  mode: 'virtual-background';
  imagePath: string;
};

export type JBFBackgroundDisabledOptions = JBFBackgroundCommonOptions & {
  mode: 'disabled';
};

export type JBFBackgroundProcessorOptions =
  | JBFBackgroundBlurOptions
  | JBFVirtualBackgroundOptions
  | JBFBackgroundDisabledOptions;

export type JBFBackgroundTransformerOptions = {
  blurRadius?: number;
  imagePath?: string;
  backgroundDisabled?: boolean;
  coverage?: [number, number];
  lightWrapping?: number;
  blendMode?: JBFBlendMode;
  sigmaSpace?: number;
  sigmaColor?: number;
  jointBilateralFilterEnabled?: boolean;
  dilationEnabled?: boolean;
  dilationStrength?: number;
  temporalMode?: JBFTemporalMode;
  temporalAlpha?: number;
  maskFeatheringEnabled?: boolean;
  maskFeatheringStrength?: number;
  hysteresisEnterThreshold?: number;
  hysteresisExitThreshold?: number;
  debugOutput?: JBFDebugOutput;
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: FrameProcessingStats) => void;
};

export type SwitchJBFBackgroundProcessorBackgroundBlurOptions = {
  mode: 'background-blur';
  blurRadius?: number;
};

export type SwitchJBFBackgroundProcessorVirtualBackgroundOptions = {
  mode: 'virtual-background';
  imagePath: string;
};

export type SwitchJBFBackgroundProcessorDisabledOptions = {
  mode: 'disabled';
};

export type SwitchJBFBackgroundProcessorOptions =
  | SwitchJBFBackgroundProcessorBackgroundBlurOptions
  | SwitchJBFBackgroundProcessorVirtualBackgroundOptions
  | SwitchJBFBackgroundProcessorDisabledOptions;

export const DEFAULT_JBF_BLUR_RADIUS = 10;

export const DEFAULT_JBF_COVERAGE: [number, number] = [0.68, 0.83];

export const DEFAULT_JBF_SIGMA_SPACE = 1;

export const DEFAULT_JBF_SIGMA_COLOR = 0.1;

export const DEFAULT_JBF_JOINT_BILATERAL_FILTER_ENABLED = true;

export const DEFAULT_JBF_DILATION_ENABLED = false;

export const DEFAULT_JBF_DILATION_STRENGTH = 0.7;

export const DEFAULT_JBF_TEMPORAL_MODE: JBFTemporalMode = 'temporal';

export const DEFAULT_JBF_TEMPORAL_ALPHA = 0.5;

export const DEFAULT_JBF_MASK_FEATHERING_ENABLED = true;

export const DEFAULT_JBF_MASK_FEATHERING_STRENGTH = 0.35;

export const DEFAULT_JBF_HYSTERESIS_ENTER_THRESHOLD = 0.45;

export const DEFAULT_JBF_HYSTERESIS_EXIT_THRESHOLD = 0.25;

export const DEFAULT_JBF_DEBUG_OUTPUT: JBFDebugOutput = 'none';
