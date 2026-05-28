import ProcessorWrapper, { ProcessorWrapperOptions } from './ProcessorWrapper';
import {
  AdvancedBackgroundProcessorOptions,
  AdvancedBackgroundTransformerOptions,
  AdvancedFrameProcessingStats,
  AdvancedGpuCapabilities,
  AdvancedPostProcessingOptions,
  DEFAULT_ADVANCED_BLUR_RADIUS,
} from './transformers/AdvancedBackgroundOptions';
import AdvancedBackgroundTransformer from './transformers/AdvancedBackgroundTransformer';
import BackgroundTransformer, {
  BackgroundOptions,
  FrameProcessingStats,
  SegmenterOptions,
} from './transformers/BackgroundTransformer';
import {
  DEFAULT_JBF_BLUR_RADIUS,
  JBFBackgroundProcessorOptions,
  JBFBackgroundTransformerOptions,
  SwitchJBFBackgroundProcessorOptions,
} from './transformers/JBFBackgroundOptions';
import JBFBackgroundTransformer from './transformers/JBFBackgroundTransformer';

export * from './transformers/types';
export { default as VideoTransformer } from './transformers/VideoTransformer';
export { GainAudioProcessor, type GainAudioProcessorOptions } from './audio/GainAudioProcessor';
export {
  AdvancedBackgroundTransformer,
  JBFBackgroundTransformer,
  ProcessorWrapper,
  type AdvancedBackgroundProcessorOptions,
  type AdvancedBackgroundTransformerOptions,
  type AdvancedFrameProcessingStats,
  type AdvancedGpuCapabilities,
  type AdvancedPostProcessingOptions,
  type BackgroundOptions,
  type JBFBackgroundProcessorOptions,
  type JBFBackgroundTransformerOptions,
  type SwitchJBFBackgroundProcessorOptions,
  type SegmenterOptions,
  BackgroundTransformer,
  type ProcessorWrapperOptions,
};
export * from './logger';

const DEFAULT_BLUR_RADIUS = 10;

/**
 * Determines if the current browser supports background processors
 */
export const supportsBackgroundProcessors = () =>
  BackgroundTransformer.isSupported && ProcessorWrapper.isSupported;

/**
 * Determines if the current browser supports modern background processors, which yield better performance
 */
export const supportsModernBackgroundProcessors = () =>
  BackgroundTransformer.isSupported && ProcessorWrapper.hasModernApiSupport;

export const supportsAdvancedBackgroundProcessors = () =>
  AdvancedBackgroundTransformer.isSupported && ProcessorWrapper.isSupported;

export const supportsModernAdvancedBackgroundProcessors = () =>
  AdvancedBackgroundTransformer.isSupported && ProcessorWrapper.hasModernApiSupport;

export const supportsJBFBackgroundProcessors = () =>
  JBFBackgroundTransformer.isSupported && ProcessorWrapper.isSupported;

export const supportsModernJBFBackgroundProcessors = () =>
  JBFBackgroundTransformer.isSupported && ProcessorWrapper.hasModernApiSupport;

type SwitchBackgroundProcessorBackgroundBlurOptions = {
  mode: 'background-blur';
  /** If unspecified, defaults to {@link DEFAULT_BLUR_RADIUS} */
  blurRadius?: number;
};

type SwitchBackgroundProcessorVirtualBackgroundOptions = {
  mode: 'virtual-background';
  imagePath: string;
};

type SwitchBackgroundProcessorDisabledOptions = {
  mode: 'disabled';
};

export type SwitchBackgroundProcessorOptions =
  | SwitchBackgroundProcessorDisabledOptions
  | SwitchBackgroundProcessorBackgroundBlurOptions
  | SwitchBackgroundProcessorVirtualBackgroundOptions

type SwitchAdvancedBackgroundProcessorBackgroundBlurOptions = {
  mode: 'background-blur';
  /** If unspecified, defaults to {@link DEFAULT_ADVANCED_BLUR_RADIUS} */
  blurRadius?: number;
};

type SwitchAdvancedBackgroundProcessorVirtualBackgroundOptions = {
  mode: 'virtual-background';
  imagePath: string;
};

type SwitchAdvancedBackgroundProcessorDisabledOptions = {
  mode: 'disabled';
};

export type SwitchAdvancedBackgroundProcessorOptions =
  | SwitchAdvancedBackgroundProcessorDisabledOptions
  | SwitchAdvancedBackgroundProcessorBackgroundBlurOptions
  | SwitchAdvancedBackgroundProcessorVirtualBackgroundOptions

type BackgroundProcessorCommonOptions = ProcessorWrapperOptions & {
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: FrameProcessingStats) => void;
};

type BackgroundProcessorModeOptions = BackgroundProcessorCommonOptions & SwitchBackgroundProcessorOptions;
type BackgroundProcessorLegacyOptions = BackgroundProcessorCommonOptions & {
  mode?: never;
  blurRadius?: number;
  imagePath?: string;
};

export type BackgroundProcessorOptions =
  | BackgroundProcessorModeOptions
  | BackgroundProcessorLegacyOptions;

export class AdvancedBackgroundProcessorWrapper extends ProcessorWrapper<
  AdvancedBackgroundTransformerOptions,
  AdvancedBackgroundTransformer
> {
  get mode(): AdvancedBackgroundProcessorOptions['mode'] {
    const options = this.transformer.options;

    if (options.backgroundDisabled) {
      return 'disabled';
    }

    if (typeof options.imagePath === 'string' && typeof options.blurRadius === 'undefined') {
      return 'virtual-background';
    }

    return 'background-blur';
  }

  async switchTo(options: SwitchAdvancedBackgroundProcessorOptions) {
    switch (options.mode) {
      case 'background-blur':
        await this.updateTransformerOptions({
          imagePath: undefined,
          blurRadius: options.blurRadius ?? DEFAULT_ADVANCED_BLUR_RADIUS,
          backgroundDisabled: false,
        });
        break;
      case 'virtual-background':
        await this.updateTransformerOptions({
          imagePath: options.imagePath,
          blurRadius: undefined,
          backgroundDisabled: false,
        });
        break;
      case 'disabled':
        await this.updateTransformerOptions({
          imagePath: undefined,
          blurRadius: undefined,
          backgroundDisabled: true,
        });
        break;
    }
  }
}

export class JBFBackgroundProcessorWrapper extends ProcessorWrapper<
  JBFBackgroundTransformerOptions,
  JBFBackgroundTransformer
> {
  get mode(): JBFBackgroundProcessorOptions['mode'] {
    const options = this.transformer.options;

    if (options.backgroundDisabled) {
      return 'disabled';
    }

    if (typeof options.imagePath === 'string' && typeof options.blurRadius === 'undefined') {
      return 'virtual-background';
    }

    return 'background-blur';
  }

  async switchTo(options: SwitchJBFBackgroundProcessorOptions) {
    switch (options.mode) {
      case 'background-blur':
        await this.updateTransformerOptions({
          imagePath: undefined,
          blurRadius: options.blurRadius ?? DEFAULT_JBF_BLUR_RADIUS,
          backgroundDisabled: false,
        });
        break;
      case 'virtual-background':
        await this.updateTransformerOptions({
          imagePath: options.imagePath,
          blurRadius: undefined,
          backgroundDisabled: false,
        });
        break;
      case 'disabled':
        await this.updateTransformerOptions({
          imagePath: undefined,
          blurRadius: undefined,
          backgroundDisabled: true,
        });
        break;
    }
  }
}

/**
 * A {@link ProcessorWrapper} that supports applying effects to the background of a video track.
 *
 * For more info and for how to construct this object, see {@link BackgroundProcessor}.
 */
export class BackgroundProcessorWrapper extends ProcessorWrapper<BackgroundOptions, BackgroundTransformer> {
  get mode(): BackgroundProcessorModeOptions['mode'] | 'legacy' {
    const options = this.transformer.options;

    if (options.backgroundDisabled) {
      return 'disabled';
    }

    if (typeof options.imagePath === 'string' && typeof options.blurRadius === 'undefined') {
      return 'virtual-background';
    }

    if (typeof options.imagePath === 'undefined') {
      return 'background-blur';
    }

    return 'legacy';
  }

  async switchTo(options: SwitchBackgroundProcessorOptions) {
    switch (options.mode) {
      case 'background-blur':
        await this.updateTransformerOptions({
          imagePath: undefined,
          blurRadius: options.blurRadius ?? DEFAULT_BLUR_RADIUS,
          backgroundDisabled: false,
        });
        break;
      case 'virtual-background':
        await this.updateTransformerOptions({
          imagePath: options.imagePath,
          blurRadius: undefined,
          backgroundDisabled: false,
        });
        break;
      case 'disabled':
        await this.updateTransformerOptions({ imagePath: undefined, backgroundDisabled: true });
        break;
    }
  }
}

/**
 * Instantiates a background processor that supports blurring the background of a user's local
 * video or replacing the user's background with a virtual background image, and supports switching
 * the active mode later on the fly to avoid visual artifacts.
 *
 * @example
 * const camTrack = currentRoom.localParticipant.getTrackPublication(Track.Source.Camera)!.track as LocalVideoTrack;
 * const processor = BackgroundProcessor({ mode: 'background-blur', blurRadius: 10 });
 * camTrack.setProcessor(processor);
 *
 * // Change to background image:
 * processor.switchToVirtualBackground('path/to/image.png');
 * // Change back to background blur:
 * processor.switchToBackgroundBlur(10);
 */
export const BackgroundProcessor = (
  options: BackgroundProcessorOptions,
  name = 'background-processor',
) => {
  const isTransformerSupported = BackgroundTransformer.isSupported;
  const isProcessorSupported = ProcessorWrapper.isSupported;

  if (!isTransformerSupported) {
    throw new Error('Background transformer is not supported in this browser');
  }

  if (!isProcessorSupported) {
    throw new Error(
      'Neither MediaStreamTrackProcessor nor canvas.captureStream() fallback is supported in this browser',
    );
  }

  // Extract transformer-specific options and processor options
  let transformer, processorOpts;
  switch (options.mode) {
    case 'background-blur': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        blurRadius = DEFAULT_BLUR_RADIUS,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        blurRadius,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'virtual-background': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'disabled': {
      const {
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    default: {
      const {
        blurRadius,
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        blurRadius,
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }
  }

  const processor = new BackgroundProcessorWrapper(transformer, name, processorOpts);

  return processor;
};

export const AdvancedBackgroundProcessor = (
  options: AdvancedBackgroundProcessorOptions,
  name = 'advanced-background-processor',
) => {
  const isTransformerSupported = AdvancedBackgroundTransformer.isSupported;
  const isProcessorSupported = ProcessorWrapper.isSupported;

  if (!isTransformerSupported) {
    throw new Error('Advanced background transformer is not supported in this browser');
  }

  if (!isProcessorSupported) {
    throw new Error(
      'Neither MediaStreamTrackProcessor nor canvas.captureStream() fallback is supported in this browser',
    );
  }

  let transformer: AdvancedBackgroundTransformer;
  let processorOpts: ProcessorWrapperOptions;
  switch (options.mode) {
    case 'background-blur': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        blurRadius = DEFAULT_ADVANCED_BLUR_RADIUS,
        qualityProfile,
        postProcessing,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new AdvancedBackgroundTransformer({
        blurRadius,
        qualityProfile,
        postProcessing,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'virtual-background': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        imagePath,
        qualityProfile,
        postProcessing,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new AdvancedBackgroundTransformer({
        imagePath,
        qualityProfile,
        postProcessing,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'disabled': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        qualityProfile,
        postProcessing,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new AdvancedBackgroundTransformer({
        backgroundDisabled: true,
        qualityProfile,
        postProcessing,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }
  }

  return new AdvancedBackgroundProcessorWrapper(transformer, name, processorOpts);
};

export const JBFBackgroundProcessor = (
  options: JBFBackgroundProcessorOptions,
  name = 'jbf-background-processor',
) => {
  const isTransformerSupported = JBFBackgroundTransformer.isSupported;
  const isProcessorSupported = ProcessorWrapper.isSupported;

  if (!isTransformerSupported) {
    throw new Error('JBF background transformer is not supported in this browser');
  }

  if (!isProcessorSupported) {
    throw new Error(
      'Neither MediaStreamTrackProcessor nor canvas.captureStream() fallback is supported in this browser',
    );
  }

  let transformer: JBFBackgroundTransformer;
  let processorOpts: ProcessorWrapperOptions;
  switch (options.mode) {
    case 'background-blur': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        blurRadius = DEFAULT_JBF_BLUR_RADIUS,
        coverage,
        lightWrapping,
        blendMode,
        sigmaSpace,
        sigmaColor,
        jointBilateralFilterEnabled,
        dilationEnabled,
        dilationStrength,
        temporalMode,
        temporalAlpha,
        maskFeatheringEnabled,
        maskFeatheringStrength,
        hysteresisEnterThreshold,
        hysteresisExitThreshold,
        debugOutput,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new JBFBackgroundTransformer({
        blurRadius,
        coverage,
        lightWrapping,
        blendMode,
        sigmaSpace,
        sigmaColor,
        jointBilateralFilterEnabled,
        dilationEnabled,
        dilationStrength,
        temporalMode,
        temporalAlpha,
        maskFeatheringEnabled,
        maskFeatheringStrength,
        hysteresisEnterThreshold,
        hysteresisExitThreshold,
        debugOutput,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'virtual-background': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        imagePath,
        coverage,
        lightWrapping,
        blendMode,
        sigmaSpace,
        sigmaColor,
        jointBilateralFilterEnabled,
        dilationEnabled,
        dilationStrength,
        temporalMode,
        temporalAlpha,
        maskFeatheringEnabled,
        maskFeatheringStrength,
        hysteresisEnterThreshold,
        hysteresisExitThreshold,
        debugOutput,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new JBFBackgroundTransformer({
        imagePath,
        coverage,
        lightWrapping,
        blendMode,
        sigmaSpace,
        sigmaColor,
        jointBilateralFilterEnabled,
        dilationEnabled,
        dilationStrength,
        temporalMode,
        temporalAlpha,
        maskFeatheringEnabled,
        maskFeatheringStrength,
        hysteresisEnterThreshold,
        hysteresisExitThreshold,
        debugOutput,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'disabled': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        coverage,
        lightWrapping,
        blendMode,
        sigmaSpace,
        sigmaColor,
        jointBilateralFilterEnabled,
        dilationEnabled,
        dilationStrength,
        temporalMode,
        temporalAlpha,
        maskFeatheringEnabled,
        maskFeatheringStrength,
        hysteresisEnterThreshold,
        hysteresisExitThreshold,
        debugOutput,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new JBFBackgroundTransformer({
        backgroundDisabled: true,
        coverage,
        lightWrapping,
        blendMode,
        sigmaSpace,
        sigmaColor,
        jointBilateralFilterEnabled,
        dilationEnabled,
        dilationStrength,
        temporalMode,
        temporalAlpha,
        maskFeatheringEnabled,
        maskFeatheringStrength,
        hysteresisEnterThreshold,
        hysteresisExitThreshold,
        debugOutput,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }
  }

  return new JBFBackgroundProcessorWrapper(transformer, name, processorOpts);
};

/**
 * Instantiates a background processor that is configured in blur mode.
 * @deprecated Use `BackgroundProcessor({ mode: 'background-blur', blurRadius: 10,  ... })` instead.
 */
export const BackgroundBlur = (
  blurRadius: number = DEFAULT_BLUR_RADIUS,
  segmenterOptions?: SegmenterOptions,
  onFrameProcessed?: (stats: FrameProcessingStats) => void,
  processorOptions?: ProcessorWrapperOptions,
) => {
  return BackgroundProcessor(
    {
      blurRadius,
      segmenterOptions,
      onFrameProcessed,
      ...processorOptions,
    },
    'background-blur',
  );
};

/**
 * Instantiates a background processor that is configured in virtual background mode.
 * @deprecated Use `BackgroundProcessor({ mode: 'virtual-background', imagePath: '...', ... })` instead.
 */
export const VirtualBackground = (
  imagePath: string,
  segmenterOptions?: SegmenterOptions,
  onFrameProcessed?: (stats: FrameProcessingStats) => void,
  processorOptions?: ProcessorWrapperOptions,
) => {
  return BackgroundProcessor(
    {
      imagePath,
      segmenterOptions,
      onFrameProcessed,
      ...processorOptions,
    },
    'virtual-background',
  );
};

