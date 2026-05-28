import type {
  AdvancedBackgroundMode,
  AdvancedGpuCapabilities,
  AdvancedPostProcessingOptions,
  AdvancedQualityProfileName,
} from '../../transformers/AdvancedBackgroundOptions';

export type AdvancedRenderDimensions = {
  width: number;
  height: number;
};

export type AdvancedRenderGraphOptions = {
  mode: AdvancedBackgroundMode;
  blurRadius?: number;
  qualityProfile?: AdvancedQualityProfileName;
  postProcessing?: AdvancedPostProcessingOptions;
};

export type AdvancedRenderStageResources = {
  textures: WebGLTexture[];
  framebuffers: WebGLFramebuffer[];
  programs: WebGLProgram[];
  shaders: WebGLShader[];
  buffers: WebGLBuffer[];
};

export type AdvancedRenderStageState = {
  frameTexture?: WebGLTexture;
  rawMaskTexture?: WebGLTexture;
  lowResFrameTexture?: WebGLTexture;
  lowResMaskTexture?: WebGLTexture;
  refinedMaskTexture?: WebGLTexture;
  temporalMaskTexture?: WebGLTexture;
  backgroundImage?: ImageBitmap;
  backgroundImageSize?: AdvancedRenderDimensions;
  backgroundTexture?: WebGLTexture;
};

export type AdvancedRenderStageContext = {
  gl: WebGL2RenderingContext;
  output: AdvancedRenderDimensions;
  mask: AdvancedRenderDimensions;
  options: AdvancedRenderGraphOptions;
};

export type AdvancedRenderStageRenderOptions = {
  frame?: VideoFrame;
  mask?: WebGLTexture;
  state: AdvancedRenderStageState;
};

export type AdvancedRenderStage = {
  name: string;
  resources: AdvancedRenderStageResources;
  isEnabled(context: AdvancedRenderStageContext): boolean;
  resize(context: AdvancedRenderStageContext): void;
  render(context: AdvancedRenderStageContext, options: AdvancedRenderStageRenderOptions): void;
  cleanup(gl: WebGL2RenderingContext): void;
};

export type AdvancedRenderGraph = {
  renderFrame(frame: VideoFrame): void;
  updateMask(mask: WebGLTexture): void;
  updateOptions(options: Partial<AdvancedRenderGraphOptions>): void;
  setBackgroundImage(image: ImageBitmap | null): Promise<void>;
  resize(width: number, height: number): void;
  getOutputMask(): WebGLTexture | undefined;
  getCapabilities(): AdvancedGpuCapabilities;
  getResizeCount(): number;
  getStageTimings(): Record<string, number>;
  isContextLost(): boolean;
  cleanup(): void;
  getStages(): readonly AdvancedRenderStage[];
};
