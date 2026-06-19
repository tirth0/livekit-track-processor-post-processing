import * as vision from '@mediapipe/tasks-vision';
import { dependencies } from '../../package.json';
import { LoggerNames, getLogger } from '../logger';
import { setupJBFWebGL } from '../webgl/jbf/pipeline';
import {
  DEFAULT_JBF_COVERAGE,
  DEFAULT_JBF_DEBUG_OUTPUT,
  DEFAULT_JBF_DILATION_ENABLED,
  DEFAULT_JBF_DILATION_STRENGTH,
  DEFAULT_JBF_HYSTERESIS_ENTER_THRESHOLD,
  DEFAULT_JBF_HYSTERESIS_EXIT_THRESHOLD,
  DEFAULT_JBF_JOINT_BILATERAL_FILTER_ENABLED,
  DEFAULT_JBF_MASK_FEATHERING_ENABLED,
  DEFAULT_JBF_MASK_FEATHERING_STRENGTH,
  DEFAULT_JBF_SIGMA_COLOR,
  DEFAULT_JBF_SIGMA_SPACE,
  DEFAULT_JBF_TEMPORAL_ALPHA,
  DEFAULT_JBF_TEMPORAL_MODE,
  type JBFBackgroundMode,
  type JBFBackgroundTransformerOptions,
} from './JBFBackgroundOptions';
import VideoTransformer from './VideoTransformer';
import { TrackTransformerDestroyOptions, VideoTransformerInitOptions } from './types';

const DEFAULT_SEGMENTER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const resolveMode = (options: JBFBackgroundTransformerOptions): JBFBackgroundMode => {
  if (options.backgroundDisabled) {
    return 'disabled';
  }

  if (typeof options.imagePath === 'string' && typeof options.blurRadius === 'undefined') {
    return 'virtual-background';
  }

  return 'background-blur';
};

export default class JBFBackgroundTransformer extends VideoTransformer<JBFBackgroundTransformerOptions> {
  static get isSupported() {
    return (
      typeof OffscreenCanvas !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      !!document.createElement('canvas').getContext('webgl2')
    );
  }

  imageSegmenter?: vision.ImageSegmenter;

  backgroundImageAndPath: { imageData: HTMLImageElement; path: string } | null = null;

  options: JBFBackgroundTransformerOptions;

  segmentationTimeMs = 0;

  isFirstFrame = true;

  private renderer?: ReturnType<typeof setupJBFWebGL>;

  private log = getLogger(LoggerNames.ProcessorWrapper);

  constructor(opts: JBFBackgroundTransformerOptions) {
    super();
    this.options = opts;
    this.update(opts);
  }

  async init({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
    await super.init({ outputCanvas, inputElement: inputVideo });
    try {
      this.recreateRenderer();

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
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });

      if (this.options.imagePath) {
        await this.loadAndSetBackground(this.options.imagePath).catch((err) =>
          this.log.error('Error while loading processor background image: ', err),
        );
      }

      if (typeof this.options.blurRadius === 'number') {
        this.renderer?.setBlurRadius(this.options.blurRadius);
      }
    } catch (error) {
      this.renderer?.cleanup();
      this.renderer = undefined;
      await this.imageSegmenter?.close();
      this.imageSegmenter = undefined;
      await super.destroy();
      throw error;
    }
  }

  async destroy(options?: TrackTransformerDestroyOptions) {
    this.renderer?.cleanup();
    this.renderer = undefined;
    await super.destroy();
    await this.imageSegmenter?.close();
    this.imageSegmenter = undefined;
    this.backgroundImageAndPath = null;

    if (!options?.willProcessorRestart) {
      this.isFirstFrame = true;
    }
  }

  async restart(options: VideoTransformerInitOptions) {
    this.renderer?.cleanup();
    this.renderer = undefined;
    await this.imageSegmenter?.close();
    this.imageSegmenter = undefined;
    await super.destroy();
    await this.init(options);
  }

  async loadAndSetBackground(path: string) {
    if (!this.backgroundImageAndPath || this.backgroundImageAndPath.path !== path) {
      const img = new Image();

      await new Promise((resolve, reject) => {
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          img.onload = null;
          img.onerror = null;
          resolve(img);
        };
        img.onerror = (err) => {
          img.onload = null;
          img.onerror = null;
          reject(err);
        };
        img.src = path;
      });

      this.backgroundImageAndPath = { imageData: img, path };
    }

    this.renderer?.setBackgroundImage(this.backgroundImageAndPath.imageData);
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    let enqueuedFrame = false;
    try {
      if (!(frame instanceof VideoFrame) || frame.codedWidth === 0 || frame.codedHeight === 0) {
        this.log.debug('empty frame detected, ignoring');
        return;
      }

      let skipProcessingFrame = this.isDisabled ?? this.options.backgroundDisabled ?? false;
      if (
        typeof this.options.blurRadius !== 'number' &&
        typeof this.options.imagePath !== 'string'
      ) {
        skipProcessingFrame = true;
      }

      if (skipProcessingFrame || !this.renderer || this.renderer.isContextLost()) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        return;
      }

      const frameTimeMs = Date.now();
      if (!this.canvas) {
        throw TypeError('Canvas needs to be initialized first');
      }
      if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
        this.canvas.width = frame.displayWidth;
        this.canvas.height = frame.displayHeight;
        this.recreateRenderer();
        if (this.backgroundImageAndPath) {
          this.renderer?.setBackgroundImage(this.backgroundImageAndPath.imageData);
        }
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

      const filterStartTimeMs = performance.now();
      const rendererForFrame = this.renderer;

      const segmentationPromise = new Promise<void>((resolve, reject) => {
        try {
          const imageSegmenter = this.imageSegmenter;
          if (!imageSegmenter) {
            resolve();
            return;
          }

          const segmentationStartTimeMs = performance.now();
          imageSegmenter.segmentForVideo(frame, segmentationStartTimeMs, (result) => {
            this.segmentationTimeMs = performance.now() - segmentationStartTimeMs;
            const mask = result.confidenceMasks?.[0];
            if (rendererForFrame === this.renderer && mask) {
              rendererForFrame?.updateMask(mask.getAsWebGLTexture());
            }
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
        const filterTimeMs = performance.now() - filterStartTimeMs;
        this.options.onFrameProcessed?.({
          processingTimeMs: this.segmentationTimeMs + filterTimeMs,
          segmentationTimeMs: this.segmentationTimeMs,
          filterTimeMs,
        });
      } else {
        controller.enqueue(frame);
        enqueuedFrame = true;
      }
      await segmentationPromise;
    } catch (e) {
      this.log.error('Error while processing frame: ', e);
    } finally {
      if (!enqueuedFrame) {
        frame.close();
      }
    }
  }

  async update(opts: JBFBackgroundTransformerOptions) {
    this.options = { ...this.options, ...opts };

    this.renderer?.updateOptions({
      mode: resolveMode(this.options),
      coverage: this.options.coverage ?? DEFAULT_JBF_COVERAGE,
      lightWrapping: this.options.lightWrapping,
      blendMode: this.options.blendMode,
      sigmaSpace: this.options.sigmaSpace ?? DEFAULT_JBF_SIGMA_SPACE,
      sigmaColor: this.options.sigmaColor ?? DEFAULT_JBF_SIGMA_COLOR,
      jointBilateralFilterEnabled:
        this.options.jointBilateralFilterEnabled ?? DEFAULT_JBF_JOINT_BILATERAL_FILTER_ENABLED,
      dilationEnabled: this.options.dilationEnabled ?? DEFAULT_JBF_DILATION_ENABLED,
      dilationStrength: this.options.dilationStrength ?? DEFAULT_JBF_DILATION_STRENGTH,
      temporalMode: this.options.temporalMode ?? DEFAULT_JBF_TEMPORAL_MODE,
      temporalAlpha: this.options.temporalAlpha ?? DEFAULT_JBF_TEMPORAL_ALPHA,
      maskFeatheringEnabled:
        this.options.maskFeatheringEnabled ?? DEFAULT_JBF_MASK_FEATHERING_ENABLED,
      maskFeatheringStrength:
        this.options.maskFeatheringStrength ?? DEFAULT_JBF_MASK_FEATHERING_STRENGTH,
      hysteresisEnterThreshold:
        this.options.hysteresisEnterThreshold ?? DEFAULT_JBF_HYSTERESIS_ENTER_THRESHOLD,
      hysteresisExitThreshold:
        this.options.hysteresisExitThreshold ?? DEFAULT_JBF_HYSTERESIS_EXIT_THRESHOLD,
      debugOutput: this.options.debugOutput ?? DEFAULT_JBF_DEBUG_OUTPUT,
    });

    if (opts.imagePath) {
      await this.loadAndSetBackground(opts.imagePath);
    } else if ('imagePath' in opts) {
      this.backgroundImageAndPath = null;
      this.renderer?.setBackgroundImage(null);
    }

    if (typeof opts.blurRadius === 'number') {
      this.renderer?.setBlurRadius(opts.blurRadius);
    }

    this.renderer?.setBackgroundDisabled(opts.backgroundDisabled ?? false);
  }

  private drawFrame(frame: VideoFrame) {
    this.renderer?.renderFrame(frame);
  }

  private recreateRenderer() {
    if (!this.canvas) {
      return;
    }

    this.renderer?.cleanup();
    this.renderer = setupJBFWebGL(this.canvas, {
      mode: resolveMode(this.options),
      coverage: this.options.coverage ?? DEFAULT_JBF_COVERAGE,
      lightWrapping: this.options.lightWrapping,
      blendMode: this.options.blendMode,
      sigmaSpace: this.options.sigmaSpace ?? DEFAULT_JBF_SIGMA_SPACE,
      sigmaColor: this.options.sigmaColor ?? DEFAULT_JBF_SIGMA_COLOR,
      jointBilateralFilterEnabled:
        this.options.jointBilateralFilterEnabled ?? DEFAULT_JBF_JOINT_BILATERAL_FILTER_ENABLED,
      dilationEnabled: this.options.dilationEnabled ?? DEFAULT_JBF_DILATION_ENABLED,
      dilationStrength: this.options.dilationStrength ?? DEFAULT_JBF_DILATION_STRENGTH,
      temporalMode: this.options.temporalMode ?? DEFAULT_JBF_TEMPORAL_MODE,
      temporalAlpha: this.options.temporalAlpha ?? DEFAULT_JBF_TEMPORAL_ALPHA,
      maskFeatheringEnabled:
        this.options.maskFeatheringEnabled ?? DEFAULT_JBF_MASK_FEATHERING_ENABLED,
      maskFeatheringStrength:
        this.options.maskFeatheringStrength ?? DEFAULT_JBF_MASK_FEATHERING_STRENGTH,
      hysteresisEnterThreshold:
        this.options.hysteresisEnterThreshold ?? DEFAULT_JBF_HYSTERESIS_ENTER_THRESHOLD,
      hysteresisExitThreshold:
        this.options.hysteresisExitThreshold ?? DEFAULT_JBF_HYSTERESIS_EXIT_THRESHOLD,
      debugOutput: this.options.debugOutput ?? DEFAULT_JBF_DEBUG_OUTPUT,
    });
  }
}
