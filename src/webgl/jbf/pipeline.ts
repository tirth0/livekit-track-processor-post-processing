import { buildBackgroundBlurStage } from './backgroundBlurStage';
import {
  buildBackgroundImageStage,
  type JBFBlendMode,
} from './backgroundImageStage';
import {
  bindPipelineStageAttributes,
  compileShader,
  createPiplelineStageProgram,
  createTexture,
  glsl,
} from './helpers/webglHelper';
import { buildJointBilateralFilterStage } from './jointBilateralFilterStage';
import { buildMaskDebugStage } from './maskDebugStage';
import { buildMaskDilationStage } from './maskDilationStage';
import { buildMaskFeatherStage } from './maskFeatherStage';
import {
  buildTemporalMaskStage,
  type TemporalMaskMode,
} from './temporalMaskStage';

export type JBFBackgroundMode = 'background-blur' | 'virtual-background' | 'disabled';

export type JBFWebGLOptions = {
  mode: JBFBackgroundMode;
  coverage?: [number, number];
  lightWrapping?: number;
  blendMode?: JBFBlendMode;
  sigmaSpace?: number;
  sigmaColor?: number;
  jointBilateralFilterEnabled?: boolean;
  dilationEnabled?: boolean;
  dilationStrength?: number;
  temporalMode?: TemporalMaskMode;
  temporalAlpha?: number;
  maskFeatheringEnabled?: boolean;
  maskFeatheringStrength?: number;
  hysteresisEnterThreshold?: number;
  hysteresisExitThreshold?: number;
  debugOutput?:
  | 'none'
  | 'raw-mask'
  | 'dilated-mask'
  | 'jbf-mask'
  | 'temporal-mask'
  | 'coverage-mask';
};

const DEFAULT_COVERAGE: [number, number] = [0.68, 0.83];
const DEFAULT_LIGHT_WRAPPING = 0.3;
const DEFAULT_JOINT_BILATERAL_FILTER_ENABLED = true;
const DEFAULT_DILATION_ENABLED = false;
const DEFAULT_DILATION_STRENGTH = 0.7;
const DEFAULT_TEMPORAL_MODE: TemporalMaskMode = 'temporal';
const DEFAULT_TEMPORAL_ALPHA = 0.5;
const DEFAULT_MASK_FEATHERING_ENABLED = true;
const DEFAULT_MASK_FEATHERING_STRENGTH = 0.35;
const DEFAULT_HYSTERESIS_ENTER_THRESHOLD = 0.45;
const DEFAULT_HYSTERESIS_EXIT_THRESHOLD = 0.25;

export const setupJBFWebGL = (
  canvas: OffscreenCanvas | HTMLCanvasElement,
  initialOptions: JBFWebGLOptions,
) => {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: true,
  }) as WebGL2RenderingContext;

  if (!gl) {
    return undefined;
  }

  const vertexShaderSource = glsl`#version 300 es

    in vec2 a_position;
    in vec2 a_texCoord;

    out vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);

  const positionBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]),
    gl.STATIC_DRAW,
  );

  const texCoordBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0]),
    gl.STATIC_DRAW,
  );

  const inputFrameTexture = createMutableTexture(gl);
  const segmentationTexture = createTexture(gl, gl.RGBA8, canvas.width, canvas.height);
  const dilatedMaskTexture = createTexture(gl, gl.RGBA8, canvas.width, canvas.height);
  const jbfMaskTexture = createTexture(gl, gl.RGBA8, canvas.width, canvas.height);
  const personMaskTexture = createTexture(gl, gl.RGBA8, canvas.width, canvas.height);
  const featheredMaskTexture = createTexture(gl, gl.RGBA8, canvas.width, canvas.height);

  const maskBridge = buildMaskBridgeStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    segmentationTexture,
    canvas,
  );
  const passthroughStage = buildPassthroughStage(
    gl,
    positionBuffer,
    texCoordBuffer,
    canvas,
  );
  const maskDilationStage = buildMaskDilationStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    segmentationTexture,
    dilatedMaskTexture,
    canvas,
  );
  const jointBilateralFilterStage = buildJointBilateralFilterStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    dilatedMaskTexture,
    jbfMaskTexture,
    canvas,
  );
  const maskCopyStage = buildMaskCopyStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    dilatedMaskTexture,
    jbfMaskTexture,
    canvas,
  );
  const temporalMaskStage = buildTemporalMaskStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    jbfMaskTexture,
    personMaskTexture,
    canvas,
  );
  const maskFeatherStage = buildMaskFeatherStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    personMaskTexture,
    featheredMaskTexture,
    canvas,
  );
  const maskDebugStage = buildMaskDebugStage(
    gl,
    positionBuffer,
    texCoordBuffer,
    canvas,
  );
  const backgroundBlurStage = buildBackgroundBlurStage(
    gl,
    vertexShader,
    positionBuffer,
    texCoordBuffer,
    featheredMaskTexture,
    canvas,
  );
  const backgroundImageStage = buildBackgroundImageStage(
    gl,
    positionBuffer,
    texCoordBuffer,
    featheredMaskTexture,
    null,
    canvas,
  );

  let options: JBFWebGLOptions = { ...initialOptions };
  let hasMask = false;

  applyOptions(options);

  function bindInputFrame(frame: VideoFrame) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputFrameTexture);
    // Match the source virtual-background pipeline: mutable texImage2D is
    // reliable for VideoFrame uploads across browsers.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      frame,
    );
  }

  function applyOptions(nextOptions: Partial<JBFWebGLOptions>) {
    options = { ...options, ...nextOptions };
    const coverage = options.coverage ?? DEFAULT_COVERAGE;
    backgroundBlurStage.updateCoverage(coverage);
    backgroundImageStage.updateCoverage(coverage);
    backgroundImageStage.updateLightWrapping(options.lightWrapping ?? DEFAULT_LIGHT_WRAPPING);
    backgroundImageStage.updateBlendMode(options.blendMode ?? 'screen');
    jointBilateralFilterStage.updateSigmaSpace(options.sigmaSpace ?? 0);
    jointBilateralFilterStage.updateSigmaColor(options.sigmaColor ?? 0);
    maskDilationStage.updateOptions({
      enabled: options.dilationEnabled ?? DEFAULT_DILATION_ENABLED,
      strength: options.dilationStrength ?? DEFAULT_DILATION_STRENGTH,
    });
    temporalMaskStage.updateOptions({
      mode: options.temporalMode ?? DEFAULT_TEMPORAL_MODE,
      alpha: options.temporalAlpha ?? DEFAULT_TEMPORAL_ALPHA,
      enterThreshold: options.hysteresisEnterThreshold ?? DEFAULT_HYSTERESIS_ENTER_THRESHOLD,
      exitThreshold: options.hysteresisExitThreshold ?? DEFAULT_HYSTERESIS_EXIT_THRESHOLD,
    });
    maskFeatherStage.updateOptions({
      enabled: options.maskFeatheringEnabled ?? DEFAULT_MASK_FEATHERING_ENABLED,
      strength: options.maskFeatheringStrength ?? DEFAULT_MASK_FEATHERING_STRENGTH,
    });
  }

  function cleanup() {
    maskBridge.cleanUp();
    passthroughStage.cleanUp();
    maskDilationStage.cleanUp();
    jointBilateralFilterStage.cleanUp();
    maskCopyStage.cleanUp();
    temporalMaskStage.cleanUp();
    maskFeatherStage.cleanUp();
    maskDebugStage.cleanUp();
    backgroundBlurStage.cleanUp();
    backgroundImageStage.cleanUp();
    gl.deleteShader(vertexShader);
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(texCoordBuffer);
    gl.deleteTexture(inputFrameTexture);
    gl.deleteTexture(segmentationTexture);
    gl.deleteTexture(dilatedMaskTexture);
    gl.deleteTexture(jbfMaskTexture);
    gl.deleteTexture(personMaskTexture);
    gl.deleteTexture(featheredMaskTexture);
  }

  return {
    renderFrame(frame: VideoFrame) {
      bindInputFrame(frame);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputFrameTexture);

      if (!hasMask || options.mode === 'disabled') {
        passthroughStage.render();
        return;
      }

      if (options.debugOutput === 'raw-mask') {
        maskDebugStage.render(segmentationTexture);
        return;
      }

      maskDilationStage.render();
      if (options.debugOutput === 'dilated-mask') {
        maskDebugStage.render(dilatedMaskTexture);
        return;
      }

      if (options.jointBilateralFilterEnabled ?? DEFAULT_JOINT_BILATERAL_FILTER_ENABLED) {
        jointBilateralFilterStage.render();
      } else {
        maskCopyStage.render();
      }
      if (options.debugOutput === 'jbf-mask') {
        maskDebugStage.render(jbfMaskTexture);
        return;
      }

      temporalMaskStage.render();
      if (options.debugOutput === 'temporal-mask') {
        maskDebugStage.render(personMaskTexture);
        return;
      }
      maskFeatherStage.render();
      if (options.debugOutput === 'coverage-mask') {
        maskDebugStage.render(featheredMaskTexture, options.coverage ?? DEFAULT_COVERAGE);
        return;
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputFrameTexture);

      if (options.mode === 'virtual-background') {
        backgroundImageStage.render();
      } else {
        backgroundBlurStage.render();
      }
    },
    updateMask(mask: WebGLTexture) {
      maskBridge.render(mask);
      hasMask = true;
    },
    updateOptions(nextOptions: Partial<JBFWebGLOptions>) {
      applyOptions(nextOptions);
    },
    setBackgroundImage(image: HTMLImageElement | null) {
      if (image) {
        backgroundImageStage.updateBackgroundImage(image);
        applyOptions({ mode: 'virtual-background' });
      } else if (options.mode === 'virtual-background') {
        applyOptions({ mode: 'disabled' });
      }
    },
    setBlurRadius(_radius: number | null) {
      applyOptions({ mode: _radius ? 'background-blur' : 'disabled' });
    },
    setBackgroundDisabled(disabled: boolean) {
      if (disabled) {
        applyOptions({ mode: 'disabled' });
      }
    },
    cleanup,
    isContextLost() {
      return gl.isContextLost();
    },
  };
};

function createMutableTexture(gl: WebGL2RenderingContext) {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Could not create WebGL texture');
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function buildMaskCopyStage(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  positionBuffer: WebGLBuffer,
  texCoordBuffer: WebGLBuffer,
  inputTexture: WebGLTexture,
  outputTexture: WebGLTexture,
  canvas: OffscreenCanvas | HTMLCanvasElement,
) {
  const fragmentShaderSource = glsl`#version 300 es

    precision highp float;

    uniform sampler2D u_mask;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      outColor = texture(u_mask, v_texCoord);
    }
  `;

  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );
  const program = createPiplelineStageProgram(
    gl,
    vertexShader,
    fragmentShader,
    positionBuffer,
    texCoordBuffer,
  );
  const maskLocation = gl.getUniformLocation(program, 'u_mask');
  const frameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    outputTexture,
    0,
  );
  gl.useProgram(program);
  gl.uniform1i(maskLocation, 1);

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    bindPipelineStageAttributes(gl, program, positionBuffer, texCoordBuffer);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function cleanUp() {
    gl.deleteFramebuffer(frameBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(fragmentShader);
  }

  return { render, cleanUp };
}

function buildMaskBridgeStage(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  positionBuffer: WebGLBuffer,
  texCoordBuffer: WebGLBuffer,
  outputTexture: WebGLTexture,
  canvas: OffscreenCanvas | HTMLCanvasElement,
) {
  const fragmentShaderSource = glsl`#version 300 es

    precision highp float;

    uniform sampler2D u_mediapipeMask;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      float rawMask = texture(u_mediapipeMask, v_texCoord).r;
      outColor = vec4(0.0, 0.0, 0.0, rawMask);
    }
  `;

  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );
  const program = createPiplelineStageProgram(
    gl,
    vertexShader,
    fragmentShader,
    positionBuffer,
    texCoordBuffer,
  );
  const maskLocation = gl.getUniformLocation(program, 'u_mediapipeMask');
  const frameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    outputTexture,
    0,
  );
  gl.useProgram(program);
  gl.uniform1i(maskLocation, 0);

  function render(mask: WebGLTexture) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    bindPipelineStageAttributes(gl, program, positionBuffer, texCoordBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mask);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function cleanUp() {
    gl.deleteFramebuffer(frameBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(fragmentShader);
  }

  return { render, cleanUp };
}

function buildPassthroughStage(
  gl: WebGL2RenderingContext,
  positionBuffer: WebGLBuffer,
  texCoordBuffer: WebGLBuffer,
  canvas: OffscreenCanvas | HTMLCanvasElement,
) {
  const vertexShaderSource = glsl`#version 300 es

    in vec2 a_position;
    in vec2 a_texCoord;

    out vec2 v_texCoord;

    void main() {
      // Flipping Y is required when rendering to canvas
      gl_Position = vec4(a_position * vec2(1.0, -1.0), 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentShaderSource = glsl`#version 300 es

    precision highp float;

    uniform sampler2D u_inputFrame;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      outColor = texture(u_inputFrame, v_texCoord);
    }
  `;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );
  const program = createPiplelineStageProgram(
    gl,
    vertexShader,
    fragmentShader,
    positionBuffer,
    texCoordBuffer,
  );
  const inputFrameLocation = gl.getUniformLocation(program, 'u_inputFrame');
  gl.useProgram(program);
  gl.uniform1i(inputFrameLocation, 0);

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    bindPipelineStageAttributes(gl, program, positionBuffer, texCoordBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function cleanUp() {
    gl.deleteProgram(program);
    gl.deleteShader(fragmentShader);
    gl.deleteShader(vertexShader);
  }

  return { render, cleanUp };
}
