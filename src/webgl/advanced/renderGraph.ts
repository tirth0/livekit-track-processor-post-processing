import {
  ADVANCED_QUALITY_PROFILES,
  DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS,
} from '../../transformers/AdvancedBackgroundOptions';
import { detectAdvancedGpuCapabilities } from './capabilities';
import {
  createBackgroundBlurStage,
  createBackgroundImageStage,
  createCompositeStage,
  createFrameUploadStage,
  createMaskDownsampleStage,
  createMaskRefinementStage,
  createTemporalStage,
} from './stages';
import type {
  AdvancedRenderDimensions,
  AdvancedRenderGraph,
  AdvancedRenderGraphOptions,
  AdvancedRenderStage,
  AdvancedRenderStageContext,
  AdvancedRenderStageState,
} from './types';

const resolveMaskDimensions = (
  output: AdvancedRenderDimensions,
  options: AdvancedRenderGraphOptions,
): AdvancedRenderDimensions => {
  if (options.postProcessing?.maskResolution) {
    return options.postProcessing.maskResolution;
  }

  if (options.postProcessing?.maskDownsampleFactor) {
    const factor = Math.max(1, options.postProcessing.maskDownsampleFactor);
    return {
      width: Math.max(1, Math.floor(output.width / factor)),
      height: Math.max(1, Math.floor(output.height / factor)),
    };
  }

  const qualityProfile = options.qualityProfile === 'performance' || options.qualityProfile === 'quality'
    ? options.qualityProfile
    : 'balanced';

  return ADVANCED_QUALITY_PROFILES[qualityProfile].maskResolution;
};

const createStages = (): AdvancedRenderStage[] => [
  createFrameUploadStage(),
  createMaskDownsampleStage(),
  createMaskRefinementStage(),
  createTemporalStage(),
  createBackgroundBlurStage(),
  createBackgroundImageStage(),
  createCompositeStage(),
];

export const createAdvancedRenderGraph = (
  canvas: OffscreenCanvas | HTMLCanvasElement,
  initialOptions: AdvancedRenderGraphOptions,
): AdvancedRenderGraph | undefined => {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: true,
  }) as WebGL2RenderingContext | null;

  if (!gl) {
    return undefined;
  }

  const stages = createStages();
  const state: AdvancedRenderStageState = {};
  let options: AdvancedRenderGraphOptions = {
    ...initialOptions,
    postProcessing: {
      ...DEFAULT_ADVANCED_POST_PROCESSING_OPTIONS,
      ...initialOptions.postProcessing,
    },
  };
  let outputDimensions: AdvancedRenderDimensions = {
    width: canvas.width,
    height: canvas.height,
  };
  let maskDimensions = resolveMaskDimensions(outputDimensions, options);
  let backgroundImage: ImageBitmap | null = null;
  let resizeCount = 0;
  let lastStageTimings: Record<string, number> = {};
  const capabilities = detectAdvancedGpuCapabilities(canvas);

  const getContext = (): AdvancedRenderStageContext => ({
    gl,
    output: outputDimensions,
    mask: maskDimensions,
    options,
  });

  const resizeStages = () => {
    if (gl.isContextLost()) {
      return;
    }

    const context = getContext();
    stages.forEach((stage) => stage.resize(context));
  };

  const renderEnabledStages = (frame?: VideoFrame, mask?: WebGLTexture) => {
    if (gl.isContextLost()) {
      return;
    }

    const context = getContext();
    const stageTimings: Record<string, number> = {};
    stages.forEach((stage) => {
      if (stage.isEnabled(context)) {
        const stageStart = performance.now();
        stage.render(context, { frame, mask, state });
        stageTimings[stage.name] = performance.now() - stageStart;
      }
    });
    lastStageTimings = stageTimings;
  };

  resizeStages();

  return {
    renderFrame(frame: VideoFrame) {
      renderEnabledStages(frame);
    },
    updateMask(mask: WebGLTexture) {
      state.rawMaskTexture = mask;
      renderEnabledStages(undefined, mask);
    },
    updateOptions(nextOptions: Partial<AdvancedRenderGraphOptions>) {
      options = {
        ...options,
        ...nextOptions,
        postProcessing: {
          ...options.postProcessing,
          ...nextOptions.postProcessing,
        },
      };
      maskDimensions = resolveMaskDimensions(outputDimensions, options);
      resizeStages();
    },
    async setBackgroundImage(image: ImageBitmap | null) {
      backgroundImage = image;
      state.backgroundImage = image ?? undefined;
      state.backgroundImageSize = image ? { width: image.width, height: image.height } : undefined;
      if (!backgroundImage) {
        state.backgroundTexture = undefined;
      }
    },
    resize(width: number, height: number) {
      if (outputDimensions.width === width && outputDimensions.height === height) {
        return;
      }

      outputDimensions = { width, height };
      maskDimensions = resolveMaskDimensions(outputDimensions, options);
      state.rawMaskTexture = undefined;
      state.lowResFrameTexture = undefined;
      state.lowResMaskTexture = undefined;
      state.refinedMaskTexture = undefined;
      state.temporalMaskTexture = undefined;
      state.backgroundTexture = undefined;
      resizeCount += 1;
      resizeStages();
    },
    getOutputMask() {
      return state.temporalMaskTexture ?? state.refinedMaskTexture ?? state.lowResMaskTexture;
    },
    getCapabilities() {
      return capabilities;
    },
    getResizeCount() {
      return resizeCount;
    },
    getStageTimings() {
      return lastStageTimings;
    },
    isContextLost() {
      return gl.isContextLost();
    },
    cleanup() {
      if (!gl.isContextLost()) {
        stages.forEach((stage) => stage.cleanup(gl));
      }
      backgroundImage = null;
    },
    getStages() {
      return stages;
    },
  };
};
