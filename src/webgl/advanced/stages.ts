import { createProgram, createShader, glsl } from '../utils';
import type {
  AdvancedRenderDimensions,
  AdvancedRenderStage,
  AdvancedRenderStageContext,
  AdvancedRenderStageResources,
} from './types';

const createEmptyResources = (): AdvancedRenderStageResources => ({
  textures: [],
  framebuffers: [],
  programs: [],
  shaders: [],
  buffers: [],
});

const cleanupResources = (gl: WebGL2RenderingContext, resources: AdvancedRenderStageResources) => {
  resources.textures.forEach((texture) => gl.deleteTexture(texture));
  resources.framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
  resources.programs.forEach((program) => gl.deleteProgram(program));
  resources.shaders.forEach((shader) => gl.deleteShader(shader));
  resources.buffers.forEach((buffer) => gl.deleteBuffer(buffer));

  resources.textures = [];
  resources.framebuffers = [];
  resources.programs = [];
  resources.shaders = [];
  resources.buffers = [];
};

const createTexture = (
  gl: WebGL2RenderingContext,
  dimensions: AdvancedRenderDimensions,
): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Failed to create texture');
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    dimensions.width,
    dimensions.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return texture;
};

const createFramebuffer = (
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
): WebGLFramebuffer => {
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    throw new Error('Failed to create framebuffer');
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer not complete');
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
};

const createVertexBuffer = (gl: WebGL2RenderingContext): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('Failed to create vertex buffer');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]),
    gl.STATIC_DRAW,
  );

  return buffer;
};

const vertexShaderSource = glsl`#version 300 es
  in vec2 position;
  out vec2 texCoords;

  void main() {
    texCoords = (position + 1.0) * 0.5;
    texCoords.y = texCoords.y;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const outputVertexShaderSource = glsl`#version 300 es
  in vec2 position;
  out vec2 texCoords;

  void main() {
    texCoords = (position + 1.0) * 0.5;
    gl_Position = vec4(position * vec2(1.0, -1.0), 0.0, 1.0);
  }
`;

const copyFragmentShaderSource = glsl`#version 300 es
  precision highp float;

  in vec2 texCoords;
  uniform sampler2D u_texture;
  uniform bool u_maskMode;
  out vec4 fragColor;

  void main() {
    vec4 value = texture(u_texture, texCoords);
    vec2 segmentation = value.rg;
    float shift = max(segmentation.r, segmentation.g);
    float backgroundExp = exp(segmentation.r - shift);
    float personExp = exp(segmentation.g - shift);
    float personMask = personExp / (backgroundExp + personExp);
    fragColor = u_maskMode ? vec4(vec3(0.0), personMask) : value;
  }
`;

const jointBilateralFragmentShaderSource = glsl`#version 300 es
  precision highp float;

  in vec2 texCoords;
  uniform sampler2D u_frame;
  uniform sampler2D u_mask;
  uniform vec2 u_texelSize;
  uniform float u_step;
  uniform float u_radius;
  uniform float u_offset;
  uniform float u_sigmaTexel;
  uniform float u_sigmaColor;
  uniform bool u_enabled;
  out vec4 fragColor;

  float gaussian(float x, float sigma) {
    float coeff = -0.5 / (sigma * sigma * 4.0 + 1.0e-6);
    return exp((x * x) * coeff);
  }

  void main() {
    if (!u_enabled) {
      float mask = texture(u_mask, texCoords).a;
      fragColor = vec4(vec3(mask), mask);
      return;
    }

    vec2 centerCoord = texCoords;
    vec3 centerColor = texture(u_frame, texCoords).rgb;
    float newVal = 0.0;

    float spaceWeight = 0.0;
    float colorWeight = 0.0;
    float totalWeight = 0.0;

    // Subsample kernel space.
    for (float i = -u_radius + u_offset; i <= u_radius; i += u_step) {
      for (float j = -u_radius + u_offset; j <= u_radius; j += u_step) {
        vec2 shift = vec2(j, i) * u_texelSize;
        vec2 coord = vec2(centerCoord + shift);
        vec3 frameColor = texture(u_frame, coord).rgb;
        float outVal = texture(u_mask, coord).a;

        spaceWeight = gaussian(distance(centerCoord, coord), u_sigmaTexel);
        colorWeight = gaussian(distance(centerColor, frameColor), u_sigmaColor);
        totalWeight += spaceWeight * colorWeight;

        newVal += spaceWeight * colorWeight * outVal;
      }
    }
    newVal /= max(totalWeight, 0.0001);

    fragColor = vec4(vec3(newVal), newVal);
  }
`;

const temporalFragmentShaderSource = glsl`#version 300 es
  precision mediump float;

  in vec2 texCoords;
  uniform sampler2D u_currentMask;
  uniform sampler2D u_previousMask;
  uniform float u_smoothingStrength;
  uniform bool u_hasHistory;
  out vec4 fragColor;

  void main() {
    float current = texture(u_currentMask, texCoords).a;

    if (!u_hasHistory || u_smoothingStrength <= 0.0) {
      fragColor = vec4(vec3(current), current);
      return;
    }

    float previous = texture(u_previousMask, texCoords).a;
    float uncertainty = 1.0 - abs(current - 0.5) * 2.0;
    float adaptiveAlpha = mix(0.85, 0.35, uncertainty);
    float delta = abs(current - previous);
    float motionAlpha = mix(adaptiveAlpha, 0.85, smoothstep(0.15, 0.5, delta));
    float alpha = mix(1.0, motionAlpha, clamp(u_smoothingStrength, 0.0, 1.0));
    float smoothed = mix(previous, current, alpha);
    fragColor = vec4(vec3(smoothed), smoothed);
  }
`;

const blurFragmentShaderSource = glsl`#version 300 es
  precision highp float;

  in vec2 texCoords;
  uniform sampler2D u_texture;
  uniform sampler2D u_personMask;
  uniform vec2 u_texelSize;
  uniform vec2 u_direction;
  uniform float u_radius;
  out vec4 fragColor;

  void main() {
    const int MAX_RADIUS = 12;
    float sigma = max(u_radius, 1.0);
    float twoSigmaSq = 2.0 * sigma * sigma;

    vec4 centerColor = texture(u_texture, texCoords);
    float centerPersonMask = texture(u_personMask, texCoords).a;
    float centerWeight = 1.0;

    vec4 frameColor = centerColor * centerWeight * (1.0 - centerPersonMask);
    float totalWeight = centerWeight;

    for (int i = 1; i <= MAX_RADIUS; i++) {
      float offset = float(i);
      if (offset > u_radius) continue;

      float weight = exp(-(offset * offset) / twoSigmaSq);
      vec2 step = u_direction * u_texelSize * offset;

      vec2 coordPos = texCoords + step;
      frameColor += texture(u_texture, coordPos) * weight *
        (1.0 - texture(u_personMask, coordPos).a);

      vec2 coordNeg = texCoords - step;
      frameColor += texture(u_texture, coordNeg) * weight *
        (1.0 - texture(u_personMask, coordNeg).a);

      totalWeight += 2.0 * weight;
    }

    vec4 normalized = frameColor / max(totalWeight, 0.0001);
    fragColor = vec4(normalized.rgb + (1.0 - normalized.a) * centerColor.rgb, 1.0);
  }
`;

const compositeFragmentShaderSource = glsl`#version 300 es
  precision highp float;

  in vec2 texCoords;
  uniform sampler2D u_frame;
  uniform sampler2D u_background;
  uniform sampler2D u_mask;
  uniform vec2 u_coverage;
  uniform vec2 u_outputSize;
  uniform vec2 u_backgroundSize;
  uniform float u_lightWrapping;
  uniform float u_blendMode;
  uniform bool u_hasBackground;
  uniform bool u_coverBackground;
  out vec4 fragColor;

  vec3 screen(vec3 a, vec3 b) {
    return 1.0 - (1.0 - a) * (1.0 - b);
  }

  vec3 linearDodge(vec3 a, vec3 b) {
    return a + b;
  }

  vec2 coverTexCoords(vec2 uv) {
    float outputAspect = u_outputSize.x / max(u_outputSize.y, 1.0);
    float backgroundAspect = u_backgroundSize.x / max(u_backgroundSize.y, 1.0);
    vec2 scale = vec2(1.0);

    if (backgroundAspect > outputAspect) {
      scale.x = outputAspect / backgroundAspect;
    } else {
      scale.y = backgroundAspect / outputAspect;
    }

    return (uv - 0.5) * scale + 0.5;
  }

  void main() {
    vec3 frameColor = texture(u_frame, texCoords).rgb;
    vec2 backgroundCoords = u_coverBackground ? coverTexCoords(texCoords) : texCoords;
    vec3 backgroundColor = u_hasBackground ? texture(u_background, backgroundCoords).rgb : frameColor;
    float personMask = texture(u_mask, texCoords).a;
    float lightWrapMask = 1.0 - max(0.0, personMask - u_coverage.y) / max(1.0 - u_coverage.y, 0.0001);
    vec3 lightWrap = clamp(u_lightWrapping, 0.0, 1.0) * clamp(lightWrapMask, 0.0, 1.0) * backgroundColor;
    frameColor = u_blendMode * linearDodge(frameColor, lightWrap) +
      (1.0 - u_blendMode) * screen(frameColor, lightWrap);
    personMask = smoothstep(u_coverage.x, u_coverage.y, personMask);
    fragColor = vec4(frameColor * personMask + backgroundColor * (1.0 - personMask), 1.0);
  }
`;

const createShaderProgram = (
  gl: WebGL2RenderingContext,
  resources: AdvancedRenderStageResources,
  fragmentShaderSource: string,
  vertexSource = vertexShaderSource,
) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = createProgram(gl, vertexShader, fragmentShader);
  const position = gl.getAttribLocation(program, 'position');

  resources.shaders.push(vertexShader, fragmentShader);
  resources.programs.push(program);

  return { program, position };
};

const bindFullscreenQuad = (
  gl: WebGL2RenderingContext,
  positionLocation: number,
  vertexBuffer: WebGLBuffer,
) => {
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(positionLocation);
};

type StagePredicate = (context: AdvancedRenderStageContext) => boolean;

const alwaysEnabled: StagePredicate = () => true;

export const createFrameUploadStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let frameTexture: WebGLTexture | undefined;

  return {
    name: 'FrameUploadStage',
    resources,
    isEnabled: alwaysEnabled,
    resize(context) {
      cleanupResources(context.gl, resources);
      frameTexture = createTexture(context.gl, context.output);
      resources.textures.push(frameTexture);
    },
    render(context, options) {
      if (!options.frame || !frameTexture) return;

      const { gl } = context;
      gl.bindTexture(gl.TEXTURE_2D, frameTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, options.frame);
      options.state.frameTexture = frameTexture;
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      frameTexture = undefined;
    },
  };
};

export const createMaskDownsampleStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let vertexBuffer: WebGLBuffer | undefined;
  let program: WebGLProgram | undefined;
  let positionLocation = -1;
  let textureLocation: WebGLUniformLocation | null = null;
  let maskModeLocation: WebGLUniformLocation | null = null;
  let lowResFrameTexture: WebGLTexture | undefined;
  let lowResMaskTexture: WebGLTexture | undefined;
  let lowResFrameFramebuffer: WebGLFramebuffer | undefined;
  let lowResMaskFramebuffer: WebGLFramebuffer | undefined;

  const ensureProgram = (gl: WebGL2RenderingContext) => {
    if (program && vertexBuffer) return;

    const shaderProgram = createShaderProgram(gl, resources, copyFragmentShaderSource);
    program = shaderProgram.program;
    positionLocation = shaderProgram.position;
    textureLocation = gl.getUniformLocation(program, 'u_texture');
    maskModeLocation = gl.getUniformLocation(program, 'u_maskMode');
    vertexBuffer = createVertexBuffer(gl);
    resources.buffers.push(vertexBuffer);
  };

  const drawCopy = (
    context: AdvancedRenderStageContext,
    inputTexture: WebGLTexture,
    framebuffer: WebGLFramebuffer,
    maskMode: boolean,
  ) => {
    if (!program || !vertexBuffer) return;

    const { gl, mask } = context;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, mask.width, mask.height);
    bindFullscreenQuad(gl, positionLocation, vertexBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(textureLocation, 0);
    gl.uniform1i(maskModeLocation, maskMode ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  return {
    name: 'MaskDownsampleStage',
    resources,
    isEnabled: alwaysEnabled,
    resize(context) {
      cleanupResources(context.gl, resources);
      vertexBuffer = undefined;
      program = undefined;
      ensureProgram(context.gl);
      lowResFrameTexture = createTexture(context.gl, context.mask);
      lowResMaskTexture = createTexture(context.gl, context.mask);
      lowResFrameFramebuffer = createFramebuffer(context.gl, lowResFrameTexture);
      lowResMaskFramebuffer = createFramebuffer(context.gl, lowResMaskTexture);
      resources.textures.push(lowResFrameTexture, lowResMaskTexture);
      resources.framebuffers.push(lowResFrameFramebuffer, lowResMaskFramebuffer);
    },
    render(context, options) {
      if (!lowResFrameFramebuffer || !lowResMaskFramebuffer) return;

      if (options.state.frameTexture) {
        drawCopy(context, options.state.frameTexture, lowResFrameFramebuffer, false);
        options.state.lowResFrameTexture = lowResFrameTexture;
      }

      const rawMaskTexture = options.mask ?? options.state.rawMaskTexture;
      if (rawMaskTexture) {
        drawCopy(context, rawMaskTexture, lowResMaskFramebuffer, true);
        options.state.lowResMaskTexture = lowResMaskTexture;
      }
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      vertexBuffer = undefined;
      program = undefined;
      lowResFrameTexture = undefined;
      lowResMaskTexture = undefined;
      lowResFrameFramebuffer = undefined;
      lowResMaskFramebuffer = undefined;
    },
  };
};

export const createMaskRefinementStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let vertexBuffer: WebGLBuffer | undefined;
  let refinedTexture: WebGLTexture | undefined;
  let refinedFramebuffer: WebGLFramebuffer | undefined;
  let program: WebGLProgram | undefined;
  let positionLocation = -1;
  let frameLocation: WebGLUniformLocation | null = null;
  let maskLocation: WebGLUniformLocation | null = null;
  let texelSizeLocation: WebGLUniformLocation | null = null;
  let stepLocation: WebGLUniformLocation | null = null;
  let radiusLocation: WebGLUniformLocation | null = null;
  let offsetLocation: WebGLUniformLocation | null = null;
  let sigmaTexelLocation: WebGLUniformLocation | null = null;
  let sigmaColorLocation: WebGLUniformLocation | null = null;
  let enabledLocation: WebGLUniformLocation | null = null;

  const ensureProgram = (gl: WebGL2RenderingContext) => {
    if (program && vertexBuffer) return;

    const shaderProgram = createShaderProgram(gl, resources, jointBilateralFragmentShaderSource);
    program = shaderProgram.program;
    positionLocation = shaderProgram.position;
    frameLocation = gl.getUniformLocation(program, 'u_frame');
    maskLocation = gl.getUniformLocation(program, 'u_mask');
    texelSizeLocation = gl.getUniformLocation(program, 'u_texelSize');
    stepLocation = gl.getUniformLocation(program, 'u_step');
    radiusLocation = gl.getUniformLocation(program, 'u_radius');
    offsetLocation = gl.getUniformLocation(program, 'u_offset');
    sigmaTexelLocation = gl.getUniformLocation(program, 'u_sigmaTexel');
    sigmaColorLocation = gl.getUniformLocation(program, 'u_sigmaColor');
    enabledLocation = gl.getUniformLocation(program, 'u_enabled');
    vertexBuffer = createVertexBuffer(gl);
    resources.buffers.push(vertexBuffer);
  };

  return {
    name: 'MaskRefinementStage',
    resources,
    isEnabled: alwaysEnabled,
    resize(context) {
      cleanupResources(context.gl, resources);
      vertexBuffer = undefined;
      program = undefined;
      ensureProgram(context.gl);
      refinedTexture = createTexture(context.gl, context.mask);
      refinedFramebuffer = createFramebuffer(context.gl, refinedTexture);
      resources.textures.push(refinedTexture);
      resources.framebuffers.push(refinedFramebuffer);
    },
    render(context, options) {
      if (
        !program ||
        !vertexBuffer ||
        !refinedFramebuffer ||
        !refinedTexture ||
        !options.state.lowResFrameTexture ||
        !options.state.lowResMaskTexture
      ) {
        return;
      }

      const { gl, mask } = context;
      const bilateral = context.options.postProcessing?.jointBilateralFilter;
      const sigmaSpace = Math.max(bilateral?.sigmaSpace ?? 1, 0);
      const sparsity = Math.max(1, Math.sqrt(sigmaSpace) * 0.66);
      const step = sparsity;
      const radius = sigmaSpace;
      const offset = step > 1 ? step * 0.5 : 0;
      const sigmaTexel = Math.max(1 / mask.width, 1 / mask.height) * sigmaSpace;
      gl.useProgram(program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, refinedFramebuffer);
      gl.viewport(0, 0, mask.width, mask.height);
      bindFullscreenQuad(gl, positionLocation, vertexBuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, options.state.lowResFrameTexture);
      gl.uniform1i(frameLocation, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, options.state.lowResMaskTexture);
      gl.uniform1i(maskLocation, 1);
      gl.uniform2f(texelSizeLocation, 1 / mask.width, 1 / mask.height);
      gl.uniform1f(stepLocation, step);
      gl.uniform1f(radiusLocation, radius);
      gl.uniform1f(offsetLocation, offset);
      gl.uniform1f(sigmaTexelLocation, sigmaTexel);
      gl.uniform1f(sigmaColorLocation, bilateral?.sigmaColor ?? 0.1);
      gl.uniform1i(enabledLocation, bilateral?.enabled === false ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      options.state.refinedMaskTexture = refinedTexture;
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      vertexBuffer = undefined;
      refinedTexture = undefined;
      refinedFramebuffer = undefined;
      program = undefined;
    },
  };
};

export const createTemporalStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let vertexBuffer: WebGLBuffer | undefined;
  let program: WebGLProgram | undefined;
  let positionLocation = -1;
  let currentMaskLocation: WebGLUniformLocation | null = null;
  let previousMaskLocation: WebGLUniformLocation | null = null;
  let smoothingStrengthLocation: WebGLUniformLocation | null = null;
  let hasHistoryLocation: WebGLUniformLocation | null = null;
  let temporalTextures: WebGLTexture[] = [];
  let temporalFramebuffers: WebGLFramebuffer[] = [];
  let readIndex = 0;
  let writeIndex = 1;
  let hasHistory = false;

  const ensureProgram = (gl: WebGL2RenderingContext) => {
    if (program && vertexBuffer) return;

    const shaderProgram = createShaderProgram(gl, resources, temporalFragmentShaderSource);
    program = shaderProgram.program;
    positionLocation = shaderProgram.position;
    currentMaskLocation = gl.getUniformLocation(program, 'u_currentMask');
    previousMaskLocation = gl.getUniformLocation(program, 'u_previousMask');
    smoothingStrengthLocation = gl.getUniformLocation(program, 'u_smoothingStrength');
    hasHistoryLocation = gl.getUniformLocation(program, 'u_hasHistory');
    vertexBuffer = createVertexBuffer(gl);
    resources.buffers.push(vertexBuffer);
  };

  return {
    name: 'TemporalStage',
    resources,
    isEnabled: (context) => (context.options.postProcessing?.temporalSmoothing ?? 0) > 0,
    resize(context) {
      cleanupResources(context.gl, resources);
      vertexBuffer = undefined;
      program = undefined;
      ensureProgram(context.gl);
      temporalTextures = [createTexture(context.gl, context.mask), createTexture(context.gl, context.mask)];
      temporalFramebuffers = temporalTextures.map((texture) => createFramebuffer(context.gl, texture));
      resources.textures.push(...temporalTextures);
      resources.framebuffers.push(...temporalFramebuffers);
      readIndex = 0;
      writeIndex = 1;
      hasHistory = false;
    },
    render(context, options) {
      if (
        !program ||
        !vertexBuffer ||
        !options.state.refinedMaskTexture ||
        temporalTextures.length !== 2 ||
        temporalFramebuffers.length !== 2
      ) {
        options.state.temporalMaskTexture = options.state.refinedMaskTexture;
        return;
      }

      const { gl, mask } = context;
      gl.useProgram(program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, temporalFramebuffers[writeIndex]);
      gl.viewport(0, 0, mask.width, mask.height);
      bindFullscreenQuad(gl, positionLocation, vertexBuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, options.state.refinedMaskTexture);
      gl.uniform1i(currentMaskLocation, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, temporalTextures[readIndex]);
      gl.uniform1i(previousMaskLocation, 1);
      gl.uniform1f(smoothingStrengthLocation, context.options.postProcessing?.temporalSmoothing ?? 0);
      gl.uniform1i(hasHistoryLocation, hasHistory ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      options.state.temporalMaskTexture = temporalTextures[writeIndex];
      hasHistory = true;
      readIndex = writeIndex;
      writeIndex = 1 - writeIndex;
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      vertexBuffer = undefined;
      program = undefined;
      temporalTextures = [];
      temporalFramebuffers = [];
      hasHistory = false;
    },
  };
};

export const createBackgroundBlurStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let vertexBuffer: WebGLBuffer | undefined;
  let copyProgram: WebGLProgram | undefined;
  let blurProgram: WebGLProgram | undefined;
  let copyPositionLocation = -1;
  let blurPositionLocation = -1;
  let copyTextureLocation: WebGLUniformLocation | null = null;
  let copyMaskModeLocation: WebGLUniformLocation | null = null;
  let blurTextureLocation: WebGLUniformLocation | null = null;
  let blurPersonMaskLocation: WebGLUniformLocation | null = null;
  let blurTexelSizeLocation: WebGLUniformLocation | null = null;
  let blurDirectionLocation: WebGLUniformLocation | null = null;
  let blurRadiusLocation: WebGLUniformLocation | null = null;
  let blurTextures: WebGLTexture[] = [];
  let blurFramebuffers: WebGLFramebuffer[] = [];

  const ensurePrograms = (gl: WebGL2RenderingContext) => {
    if (copyProgram && blurProgram && vertexBuffer) return;

    const copyShaderProgram = createShaderProgram(gl, resources, copyFragmentShaderSource);
    copyProgram = copyShaderProgram.program;
    copyPositionLocation = copyShaderProgram.position;
    copyTextureLocation = gl.getUniformLocation(copyProgram, 'u_texture');
    copyMaskModeLocation = gl.getUniformLocation(copyProgram, 'u_maskMode');

    const blurShaderProgram = createShaderProgram(gl, resources, blurFragmentShaderSource);
    blurProgram = blurShaderProgram.program;
    blurPositionLocation = blurShaderProgram.position;
    blurTextureLocation = gl.getUniformLocation(blurProgram, 'u_texture');
    blurPersonMaskLocation = gl.getUniformLocation(blurProgram, 'u_personMask');
    blurTexelSizeLocation = gl.getUniformLocation(blurProgram, 'u_texelSize');
    blurDirectionLocation = gl.getUniformLocation(blurProgram, 'u_direction');
    blurRadiusLocation = gl.getUniformLocation(blurProgram, 'u_radius');

    vertexBuffer = createVertexBuffer(gl);
    resources.buffers.push(vertexBuffer);
  };

  const drawCopy = (
    context: AdvancedRenderStageContext,
    inputTexture: WebGLTexture,
    framebuffer: WebGLFramebuffer,
  ) => {
    if (!copyProgram || !vertexBuffer) return;

    const { gl, mask } = context;
    gl.useProgram(copyProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, mask.width, mask.height);
    bindFullscreenQuad(gl, copyPositionLocation, vertexBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(copyTextureLocation, 0);
    gl.uniform1i(copyMaskModeLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const drawBlurPass = (
    context: AdvancedRenderStageContext,
    inputTexture: WebGLTexture,
    personMaskTexture: WebGLTexture,
    framebuffer: WebGLFramebuffer,
    direction: [number, number],
  ) => {
    if (!blurProgram || !vertexBuffer) return;

    const { gl, mask } = context;
    const radius = Math.max(1, Math.floor((context.options.blurRadius ?? 10) / 4));
    gl.useProgram(blurProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, mask.width, mask.height);
    bindFullscreenQuad(gl, blurPositionLocation, vertexBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(blurTextureLocation, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, personMaskTexture);
    gl.uniform1i(blurPersonMaskLocation, 1);
    gl.uniform2f(blurTexelSizeLocation, 1 / mask.width, 1 / mask.height);
    gl.uniform2f(blurDirectionLocation, direction[0], direction[1]);
    gl.uniform1f(blurRadiusLocation, radius);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  return {
    name: 'BackgroundBlurStage',
    resources,
    isEnabled: (context) => context.options.mode === 'background-blur',
    resize(context) {
      cleanupResources(context.gl, resources);
      vertexBuffer = undefined;
      copyProgram = undefined;
      blurProgram = undefined;
      ensurePrograms(context.gl);
      blurTextures = [createTexture(context.gl, context.mask), createTexture(context.gl, context.mask)];
      blurFramebuffers = blurTextures.map((texture) => createFramebuffer(context.gl, texture));
      resources.textures.push(...blurTextures);
      resources.framebuffers.push(...blurFramebuffers);
    },
    render(context, options) {
      const personMaskTexture =
        options.state.temporalMaskTexture ??
        options.state.refinedMaskTexture ??
        options.state.lowResMaskTexture;

      if (
        !options.state.frameTexture ||
        !personMaskTexture ||
        blurTextures.length !== 2 ||
        blurFramebuffers.length !== 2
      ) {
        return;
      }

      drawCopy(context, options.state.frameTexture, blurFramebuffers[0]);
      drawBlurPass(context, blurTextures[0], personMaskTexture, blurFramebuffers[1], [1, 0]);
      drawBlurPass(context, blurTextures[1], personMaskTexture, blurFramebuffers[0], [0, 1]);
      context.gl.bindFramebuffer(context.gl.FRAMEBUFFER, null);
      options.state.backgroundTexture = blurTextures[0];
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      vertexBuffer = undefined;
      copyProgram = undefined;
      blurProgram = undefined;
      blurTextures = [];
      blurFramebuffers = [];
    },
  };
};

export const createBackgroundImageStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let backgroundTexture: WebGLTexture | undefined;
  let uploadedImage: ImageBitmap | undefined;

  return {
    name: 'BackgroundImageStage',
    resources,
    isEnabled: (context) => context.options.mode === 'virtual-background',
    resize(context) {
      cleanupResources(context.gl, resources);
      backgroundTexture = createTexture(context.gl, context.output);
      resources.textures.push(backgroundTexture);
      uploadedImage = undefined;
    },
    render(context, options) {
      if (!backgroundTexture || !options.state.backgroundImage) {
        return;
      }

      const { gl } = context;
      if (uploadedImage !== options.state.backgroundImage) {
        gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          options.state.backgroundImage,
        );
        uploadedImage = options.state.backgroundImage;
      }

      options.state.backgroundTexture = backgroundTexture;
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      backgroundTexture = undefined;
      uploadedImage = undefined;
    },
  };
};

export const createCompositeStage = (): AdvancedRenderStage => {
  const resources = createEmptyResources();
  let vertexBuffer: WebGLBuffer | undefined;
  let program: WebGLProgram | undefined;
  let positionLocation = -1;
  let frameLocation: WebGLUniformLocation | null = null;
  let backgroundLocation: WebGLUniformLocation | null = null;
  let maskLocation: WebGLUniformLocation | null = null;
  let coverageLocation: WebGLUniformLocation | null = null;
  let outputSizeLocation: WebGLUniformLocation | null = null;
  let backgroundSizeLocation: WebGLUniformLocation | null = null;
  let lightWrappingLocation: WebGLUniformLocation | null = null;
  let blendModeLocation: WebGLUniformLocation | null = null;
  let hasBackgroundLocation: WebGLUniformLocation | null = null;
  let coverBackgroundLocation: WebGLUniformLocation | null = null;

  const ensureProgram = (gl: WebGL2RenderingContext) => {
    if (program && vertexBuffer) return;

    const shaderProgram = createShaderProgram(gl, resources, compositeFragmentShaderSource, outputVertexShaderSource);
    program = shaderProgram.program;
    positionLocation = shaderProgram.position;
    frameLocation = gl.getUniformLocation(program, 'u_frame');
    backgroundLocation = gl.getUniformLocation(program, 'u_background');
    maskLocation = gl.getUniformLocation(program, 'u_mask');
    coverageLocation = gl.getUniformLocation(program, 'u_coverage');
    outputSizeLocation = gl.getUniformLocation(program, 'u_outputSize');
    backgroundSizeLocation = gl.getUniformLocation(program, 'u_backgroundSize');
    lightWrappingLocation = gl.getUniformLocation(program, 'u_lightWrapping');
    blendModeLocation = gl.getUniformLocation(program, 'u_blendMode');
    hasBackgroundLocation = gl.getUniformLocation(program, 'u_hasBackground');
    coverBackgroundLocation = gl.getUniformLocation(program, 'u_coverBackground');
    vertexBuffer = createVertexBuffer(gl);
    resources.buffers.push(vertexBuffer);
  };

  return {
    name: 'CompositeStage',
    resources,
    isEnabled: alwaysEnabled,
    resize(context) {
      cleanupResources(context.gl, resources);
      vertexBuffer = undefined;
      program = undefined;
      ensureProgram(context.gl);
    },
    render(context, options) {
      const outputMask =
        options.state.temporalMaskTexture ?? options.state.refinedMaskTexture ?? options.state.lowResMaskTexture;
      if (!program || !vertexBuffer || !options.state.frameTexture || !outputMask) {
        return;
      }

      const { gl, output } = context;
      const coverage = context.options.postProcessing?.coverage ?? [0.68, 0.83];
      const backgroundTexture = options.state.backgroundTexture ?? options.state.frameTexture;
      const backgroundSize = options.state.backgroundImageSize ?? output;
      const coverBackground = context.options.mode === 'virtual-background' && !!options.state.backgroundImageSize;
      const blendMode = context.options.postProcessing?.blendMode === 'linear-dodge' ? 1 : 0;
      gl.useProgram(program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, output.width, output.height);
      bindFullscreenQuad(gl, positionLocation, vertexBuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, options.state.frameTexture);
      gl.uniform1i(frameLocation, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
      gl.uniform1i(backgroundLocation, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, outputMask);
      gl.uniform1i(maskLocation, 2);
      gl.uniform2f(coverageLocation, coverage[0], coverage[1]);
      gl.uniform2f(outputSizeLocation, output.width, output.height);
      gl.uniform2f(backgroundSizeLocation, backgroundSize.width, backgroundSize.height);
      gl.uniform1f(lightWrappingLocation, context.options.postProcessing?.lightWrapping ?? 0);
      gl.uniform1f(blendModeLocation, blendMode);
      gl.uniform1i(hasBackgroundLocation, options.state.backgroundTexture ? 1 : 0);
      gl.uniform1i(coverBackgroundLocation, coverBackground ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    cleanup(gl) {
      cleanupResources(gl, resources);
      vertexBuffer = undefined;
      program = undefined;
    },
  };
};
