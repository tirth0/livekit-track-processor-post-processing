import {
  AdvancedGpuCapabilities,
  AdvancedQualityProfileName,
} from '../../transformers/AdvancedBackgroundOptions';

const hasExtension = (gl: WebGL2RenderingContext, extensionName: string) =>
  gl.getSupportedExtensions()?.includes(extensionName) ?? false;

export const detectAdvancedGpuCapabilities = (
  canvas: OffscreenCanvas | HTMLCanvasElement,
): AdvancedGpuCapabilities => {
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;

  if (!gl) {
    return {
      webgl2: false,
      maxTextureSize: 0,
      supportsFloatTextures: false,
      supportsHalfFloatTextures: false,
      supportsRenderableMaskTextures: false,
      supportsTimerQueries: false,
      fallbackReason: 'webgl2-unavailable',
    };
  }

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const supportsFloatTextures = hasExtension(gl, 'EXT_color_buffer_float');
  const supportsHalfFloatTextures =
    hasExtension(gl, 'EXT_color_buffer_float') || hasExtension(gl, 'EXT_color_buffer_half_float');
  const supportsTimerQueries = hasExtension(gl, 'EXT_disjoint_timer_query_webgl2');

  return {
    webgl2: true,
    maxTextureSize,
    supportsFloatTextures,
    supportsHalfFloatTextures,
    supportsRenderableMaskTextures: true,
    supportsTimerQueries,
    fallbackReason: maxTextureSize < 512 ? 'texture-size-too-small' : undefined,
  };
};

export const selectAdvancedQualityProfile = (
  capabilities: AdvancedGpuCapabilities,
  requestedProfile?: AdvancedQualityProfileName,
): Exclude<AdvancedQualityProfileName, 'auto'> => {
  if (requestedProfile === 'performance' || requestedProfile === 'balanced' || requestedProfile === 'quality') {
    return requestedProfile;
  }

  if (!capabilities.webgl2 || capabilities.fallbackReason || capabilities.maxTextureSize < 2048) {
    return 'performance';
  }

  if (!capabilities.supportsTimerQueries || capabilities.maxTextureSize < 4096) {
    return 'balanced';
  }

  return 'quality';
};
