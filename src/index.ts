import ProcessorWrapper, { ProcessorWrapperOptions } from './ProcessorWrapper';
import {
  DEFAULT_JBF_BLUR_RADIUS,
  JBFBackgroundProcessorOptions,
  JBFBackgroundTransformerOptions,
  SwitchJBFBackgroundProcessorOptions,
} from './transformers/JBFBackgroundOptions';
import JBFBackgroundTransformer from './transformers/JBFBackgroundTransformer';

export * from './transformers/types';
export * from './transformers/shared';
export { default as VideoTransformer } from './transformers/VideoTransformer';
export {
  JBFBackgroundTransformer,
  ProcessorWrapper,
  type JBFBackgroundProcessorOptions,
  type JBFBackgroundTransformerOptions,
  type SwitchJBFBackgroundProcessorOptions,
  type ProcessorWrapperOptions,
};
export * from './logger';

/**
 * Determines if the current browser supports the JBF background processor.
 */
export const supportsJBFBackgroundProcessors = () =>
  JBFBackgroundTransformer.isSupported && ProcessorWrapper.isSupported;

/**
 * Determines if the current browser supports modern processor APIs, which yield better performance.
 */
export const supportsModernJBFBackgroundProcessors = () =>
  JBFBackgroundTransformer.isSupported && ProcessorWrapper.hasModernApiSupport;

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
