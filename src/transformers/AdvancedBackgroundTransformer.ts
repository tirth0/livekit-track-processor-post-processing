import * as vision from '@mediapipe/tasks-vision';
import { dependencies } from '../../package.json';
import { getLogger, LoggerNames } from '../logger';
import {
  createAdvancedRenderGraph,
  detectAdvancedGpuCapabilities,
  selectAdvancedQualityProfile,
  type AdvancedRenderGraph,
} from '../webgl/advanced';
import {
  AdvancedBackgroundMode,
  AdvancedBackgroundTransformerOptions,
  AdvancedFrameProcessingStats,
  AdvancedGpuCapabilities,
  AdvancedQualityProfileName,
  ADVANCED_QUALITY_PROFILES,
} from './AdvancedBackgroundOptions';
import VideoTransformer from './VideoTransformer';
import { TrackTransformerDestroyOptions, VideoTransformerInitOptions } from './types';

const DEFAULT_SEGMENTER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const resolveQualityProfile = (
  qualityProfile?: AdvancedQualityProfileName,
): Exclude<AdvancedQualityProfileName, 'auto'> => {
  if (qualityProfile === 'performance' || qualityProfile === 'quality') {
    return qualityProfile;
  }

  return 'balanced';
};

const resolveMode = (options: AdvancedBackgroundTransformerOptions): AdvancedBackgroundMode => {
  if (options.backgroundDisabled) {
    return 'disabled';
  }

  if (typeof options.imagePath === 'string' && typeof options.blurRadius === 'undefined') {
    return 'virtual-background';
  }

  return 'background-blur';
};

const resolvePostProcessingOptions = (
  qualityProfile: Exclude<AdvancedQualityProfileName, 'auto'>,
  options: AdvancedBackgroundTransformerOptions,
) => ({
  ...ADVANCED_QUALITY_PROFILES[qualityProfile],
  ...options.postProcessing,
  jointBilateralFilter: {
    ...ADVANCED_QUALITY_PROFILES[qualityProfile].jointBilateralFilter,
    ...options.postProcessing?.jointBilateralFilter,
  },
});

export default class AdvancedBackgroundTransformer extends VideoTransformer<AdvancedBackgroundTransformerOptions> {
  static get isSupported() {
    return (
      typeof OffscreenCanvas !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof createImageBitmap !== 'undefined' &&
      !!document.createElement('canvas').getContext('webgl2')
    );
  }

  imageSegmenter?: vision.ImageSegmenter;

  backgroundImageAndPath: { imageData: ImageBitmap; path: string } | null = null;

  options: AdvancedBackgroundTransformerOptions;

  segmentationTimeMs = 0;

  isFirstFrame = true;

  private droppedFrames = 0;

  private skippedFrames = 0;

  private renderer?: AdvancedRenderGraph;

  private capabilities?: AdvancedGpuCapabilities;

  private selectedQualityProfile: Exclude<AdvancedQualityProfileName, 'auto'> = 'balanced';

  private contextLost = false;

  private contextLossCount = 0;

  private contextRestoreCount = 0;

  private resizeCount = 0;

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.contextLossCount += 1;
    this.renderer = undefined;
    this.log.warn('Advanced background processor WebGL context lost, falling back to passthrough');
  };

  private handleContextRestored = () => {
    this.contextLost = false;
    this.contextRestoreCount += 1;
    this.log.warn('Advanced background processor WebGL context restored, rebuilding renderer');
    this.recreateRenderer().catch((err) =>
      this.log.error('Error while restoring advanced background renderer: ', err),
    );
  };

  private log = getLogger(LoggerNames.ProcessorWrapper);

  constructor(opts: AdvancedBackgroundTransformerOptions) {
    super();
    this.options = opts;
    this.update(opts);
  }

  async init({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
    await super.init({ outputCanvas, inputElement: inputVideo });
    this.gl?.cleanup();
    this.gl = undefined;

    this.attachContextListeners();
    await this.recreateRenderer();

    const fileSet = await vision.FilesetResolver.forVisionTasks(
      this.options.assetPaths?.tasksVisionFileSet ??
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${dependencies['@mediapipe/tasks-vision']}/wasm`,
    );

    this.imageSegmenter = await vision.ImageSegmenter.createFromOptions(fileSet, {
      baseOptions: {
        modelAssetPath: this.options.assetPaths?.modelAssetPath ?? DEFAULT_SEGMENTER_MODEL,
        delegate: 'GPU',
        ...this.options.segmenterOptions,
      },
      canvas: this.canvas,
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    if (this.options.imagePath) {
      await this.loadAndSetBackground(this.options.imagePath).catch((err) =>
        this.log.error('Error while loading processor background image: ', err),
      );
    }

    if (typeof this.options.blurRadius === 'number') {
      this.renderer?.updateOptions({ blurRadius: this.options.blurRadius });
    }
  }

  async destroy(options?: TrackTransformerDestroyOptions) {
    this.detachContextListeners();
    this.renderer?.cleanup();
    this.renderer = undefined;
    await super.destroy();
    await this.imageSegmenter?.close();
    this.backgroundImageAndPath = null;

    if (!options?.willProcessorRestart) {
      this.isFirstFrame = true;
      this.droppedFrames = 0;
      this.skippedFrames = 0;
      this.contextLossCount = 0;
      this.contextRestoreCount = 0;
      this.resizeCount = 0;
    }
  }

  async loadAndSetBackground(path: string) {
    if (!this.backgroundImageAndPath || this.backgroundImageAndPath.path !== path) {
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = path;
      });

      const imageData = await createImageBitmap(img);
      this.backgroundImageAndPath = { imageData, path };
    }

    await this.renderer?.setBackgroundImage(this.backgroundImageAndPath.imageData);
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    let enqueuedFrame = false;
    try {
      if (!(frame instanceof VideoFrame) || frame.codedWidth === 0 || frame.codedHeight === 0) {
        this.log.debug('empty frame detected, ignoring');
        this.skippedFrames += 1;
        return;
      }

      let skipProcessingFrame = this.isDisabled ?? this.options.backgroundDisabled ?? false;
      if (typeof this.options.blurRadius !== 'number' && typeof this.options.imagePath !== 'string') {
        skipProcessingFrame = true;
      }

      if (skipProcessingFrame) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        return;
      }

      if (this.contextLost || !this.renderer) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        this.skippedFrames += 1;
        return;
      }

      const frameTimeMs = Date.now();
      if (!this.canvas) {
        throw TypeError('Canvas needs to be initialized first');
      }
      if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
        this.canvas.width = frame.displayWidth;
        this.canvas.height = frame.displayHeight;
        this.renderer?.resize(frame.displayWidth, frame.displayHeight);
        this.resizeCount = this.renderer?.getResizeCount() ?? this.resizeCount + 1;
      }

      if (this.isFirstFrame) {
        controller.enqueue(frame.clone());

        if (this.inputVideo) {
          await new Promise((resolve) => {
            this.inputVideo!.requestVideoFrameCallback((_now, e) => {
              const durationUntilFrameRenderedInMs = e.expectedDisplayTime - e.presentationTime;
              setTimeout(resolve, durationUntilFrameRenderedInMs);
            });
          });
        }
      }
      this.isFirstFrame = false;

      const renderStartTimeMs = performance.now();

      const segmentationPromise = new Promise<void>((resolve, reject) => {
        try {
          const segmentationStartTimeMs = performance.now();
          this.imageSegmenter?.segmentForVideo(frame, segmentationStartTimeMs, (result) => {
            this.segmentationTimeMs = performance.now() - segmentationStartTimeMs;
            this.updateMask(result.categoryMask);
            result.close();
            resolve();
          });
        } catch (e) {
          reject(e);
        }
      });

      this.drawFrame(frame);
      if (this.canvas && this.canvas.width > 0 && this.canvas.height > 0) {
        const newFrame = new VideoFrame(this.canvas, {
          timestamp: frame.timestamp || frameTimeMs,
        });
        controller.enqueue(newFrame);

        const renderTimeMs = performance.now() - renderStartTimeMs;
        this.options.onFrameProcessed?.(this.buildFrameStats(renderTimeMs));
      } else {
        controller.enqueue(frame);
        enqueuedFrame = true;
      }

      await segmentationPromise;
    } catch (e) {
      this.droppedFrames += 1;
      this.log.error('Error while processing frame: ', e);
    } finally {
      if (!enqueuedFrame) {
        frame.close();
      }
    }
  }

  async update(opts: AdvancedBackgroundTransformerOptions) {
    this.options = { ...this.options, ...opts };
    this.selectedQualityProfile = this.capabilities
      ? selectAdvancedQualityProfile(this.capabilities, this.options.qualityProfile)
      : resolveQualityProfile(this.options.qualityProfile);

    this.renderer?.updateOptions({
      mode: resolveMode(this.options),
      blurRadius: this.options.blurRadius,
      qualityProfile: this.selectedQualityProfile,
      postProcessing: resolvePostProcessingOptions(this.selectedQualityProfile, this.options),
    });
    if (opts.imagePath) {
      await this.loadAndSetBackground(opts.imagePath);
    } else {
      await this.renderer?.setBackgroundImage(null);
    }
  }

  private drawFrame(frame: VideoFrame) {
    this.renderer?.renderFrame(frame);
  }

  private updateMask(mask: vision.MPMask | undefined) {
    if (!mask) return;
    this.renderer?.updateMask(mask.getAsWebGLTexture());
  }

  private buildFrameStats(renderTimeMs: number): AdvancedFrameProcessingStats {
    const postProcessing = resolvePostProcessingOptions(this.selectedQualityProfile, this.options);
    const stageTimings = this.renderer?.getStageTimings();
    const maskProcessingTimeMs = stageTimings
      ? ['MaskDownsampleStage', 'MaskRefinementStage', 'TemporalStage'].reduce(
        (total, stageName) => total + (stageTimings[stageName] ?? 0),
        0,
      )
      : 0;

    return {
      processingTimeMs: this.segmentationTimeMs + renderTimeMs,
      segmentationTimeMs: this.segmentationTimeMs,
      filterTimeMs: renderTimeMs,
      renderTimeMs,
      maskProcessingTimeMs,
      droppedFrames: this.droppedFrames,
      skippedFrames: this.skippedFrames,
      qualityProfile: this.selectedQualityProfile,
      maskResolution: postProcessing.maskResolution,
      contextLossCount: this.contextLossCount,
      contextRestoreCount: this.contextRestoreCount,
      resizeCount: this.resizeCount,
      gpuStageTimingsMs: stageTimings,
    };
  }

  private async recreateRenderer() {
    if (!this.canvas) {
      return;
    }

    this.renderer?.cleanup();
    this.capabilities = detectAdvancedGpuCapabilities(this.canvas);
    this.selectedQualityProfile = selectAdvancedQualityProfile(
      this.capabilities,
      this.options.qualityProfile,
    );

    if (!this.capabilities.webgl2 || this.capabilities.fallbackReason) {
      this.renderer = undefined;
      this.log.warn(
        `Advanced background renderer unavailable, falling back to passthrough: ${this.capabilities.fallbackReason}`,
      );
      return;
    }

    this.renderer = createAdvancedRenderGraph(this.canvas, {
      mode: resolveMode(this.options),
      blurRadius: this.options.blurRadius,
      qualityProfile: this.selectedQualityProfile,
      postProcessing: resolvePostProcessingOptions(this.selectedQualityProfile, this.options),
    });

    if (!this.renderer) {
      this.log.warn('Advanced background renderer creation failed, falling back to passthrough');
      return;
    }

    if (this.backgroundImageAndPath) {
      await this.renderer.setBackgroundImage(this.backgroundImageAndPath.imageData);
    }
  }

  private attachContextListeners() {
    if (!this.canvas || !('addEventListener' in this.canvas)) {
      return;
    }

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private detachContextListeners() {
    if (!this.canvas || !('removeEventListener' in this.canvas)) {
      return;
    }

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
  }
}
