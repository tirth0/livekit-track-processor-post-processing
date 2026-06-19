import {
  bindPipelineStageAttributes,
  compileShader,
  createPiplelineStageProgram,
  createTexture,
  glsl,
} from './helpers/webglHelper';

export type TemporalMaskMode = 'off' | 'temporal' | 'hysteresis';

export type TemporalMaskStage = {
  render(): void;
  updateOptions(options: {
    mode?: TemporalMaskMode;
    alpha?: number;
    enterThreshold?: number;
    exitThreshold?: number;
  }): void;
  cleanUp(): void;
};

export function buildTemporalMaskStage(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  positionBuffer: WebGLBuffer,
  texCoordBuffer: WebGLBuffer,
  inputTexture: WebGLTexture,
  outputTexture: WebGLTexture,
  canvas: OffscreenCanvas | HTMLCanvasElement,
): TemporalMaskStage {
  const temporalFragmentShaderSource = glsl`#version 300 es

    precision highp float;

    uniform sampler2D u_currentMask;
    uniform sampler2D u_previousMask;
    uniform int u_mode;
    uniform bool u_hasHistory;
    uniform float u_alpha;
    uniform float u_enterThreshold;
    uniform float u_exitThreshold;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      float current = texture(u_currentMask, v_texCoord).a;

      if (!u_hasHistory || u_mode == 0) {
        outColor = vec4(0.0, 0.0, 0.0, current);
        return;
      }

      float previous = texture(u_previousMask, v_texCoord).a;
      float mask = current;

      if (u_mode == 1) {
        mask = mix(previous, current, clamp(u_alpha, 0.0, 1.0));
      } else if (u_mode == 2) {
        float wasForeground = step(0.5, previous);
        float enterMask = step(u_enterThreshold, current);
        float stayMask = step(u_exitThreshold, current);
        float hysteresisMask = mix(enterMask, stayMask, wasForeground);
        mask = max(current, hysteresisMask);
      }

      outColor = vec4(0.0, 0.0, 0.0, mask);
    }
  `;

  const copyFragmentShaderSource = glsl`#version 300 es

    precision highp float;

    uniform sampler2D u_mask;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      outColor = texture(u_mask, v_texCoord);
    }
  `;

  const { width: outputWidth, height: outputHeight } = canvas;
  const cleanupCallbacks: Array<() => void> = [];

  try {
    const temporalFragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      temporalFragmentShaderSource,
    );
    cleanupCallbacks.push(() => gl.deleteShader(temporalFragmentShader));
    const temporalProgram = createPiplelineStageProgram(
      gl,
      vertexShader,
      temporalFragmentShader,
      positionBuffer,
      texCoordBuffer,
    );
    cleanupCallbacks.push(() => gl.deleteProgram(temporalProgram));
    const copyFragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, copyFragmentShaderSource);
    cleanupCallbacks.push(() => gl.deleteShader(copyFragmentShader));
    const copyProgram = createPiplelineStageProgram(
      gl,
      vertexShader,
      copyFragmentShader,
      positionBuffer,
      texCoordBuffer,
    );
    cleanupCallbacks.push(() => gl.deleteProgram(copyProgram));
    const previousTexture = createTexture(gl, gl.RGBA8, outputWidth, outputHeight);
    cleanupCallbacks.push(() => gl.deleteTexture(previousTexture));
    const outputFramebuffer = gl.createFramebuffer();
    cleanupCallbacks.push(() => gl.deleteFramebuffer(outputFramebuffer));
    gl.bindFramebuffer(gl.FRAMEBUFFER, outputFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
    const previousFramebuffer = gl.createFramebuffer();
    cleanupCallbacks.push(() => gl.deleteFramebuffer(previousFramebuffer));
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      previousTexture,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const currentMaskLocation = gl.getUniformLocation(temporalProgram, 'u_currentMask');
    const previousMaskLocation = gl.getUniformLocation(temporalProgram, 'u_previousMask');
    const modeLocation = gl.getUniformLocation(temporalProgram, 'u_mode');
    const hasHistoryLocation = gl.getUniformLocation(temporalProgram, 'u_hasHistory');
    const alphaLocation = gl.getUniformLocation(temporalProgram, 'u_alpha');
    const enterThresholdLocation = gl.getUniformLocation(temporalProgram, 'u_enterThreshold');
    const exitThresholdLocation = gl.getUniformLocation(temporalProgram, 'u_exitThreshold');
    const copyMaskLocation = gl.getUniformLocation(copyProgram, 'u_mask');
    let mode: TemporalMaskMode = 'off';
    let hasHistory = false;

    gl.useProgram(temporalProgram);
    gl.uniform1i(currentMaskLocation, 1);
    gl.uniform1i(previousMaskLocation, 2);
    updateOptions({
      mode: 'temporal',
      alpha: 0.5,
      enterThreshold: 0.45,
      exitThreshold: 0.25,
    });

    gl.useProgram(copyProgram);
    gl.uniform1i(copyMaskLocation, 1);

    function render() {
      gl.viewport(0, 0, outputWidth, outputHeight);
      gl.useProgram(temporalProgram);
      bindPipelineStageAttributes(gl, temporalProgram, positionBuffer, texCoordBuffer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.uniform1i(hasHistoryLocation, hasHistory ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, outputFramebuffer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(copyProgram);
      bindPipelineStageAttributes(gl, copyProgram, positionBuffer, texCoordBuffer);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, outputTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      hasHistory = true;
    }

    function updateOptions(options: {
      mode?: TemporalMaskMode;
      alpha?: number;
      enterThreshold?: number;
      exitThreshold?: number;
    }) {
      gl.useProgram(temporalProgram);
      if (options.mode) {
        mode = options.mode;
        gl.uniform1i(modeLocation, mode === 'temporal' ? 1 : mode === 'hysteresis' ? 2 : 0);
      }
      if (typeof options.alpha === 'number') {
        gl.uniform1f(alphaLocation, options.alpha);
      }
      if (typeof options.enterThreshold === 'number') {
        gl.uniform1f(enterThresholdLocation, options.enterThreshold);
      }
      if (typeof options.exitThreshold === 'number') {
        gl.uniform1f(exitThresholdLocation, options.exitThreshold);
      }
    }

    function cleanUp() {
      runCleanupCallbacks(cleanupCallbacks);
    }

    return { render, updateOptions, cleanUp };
  } catch (error) {
    runCleanupCallbacks(cleanupCallbacks);
    throw error;
  }
}

function runCleanupCallbacks(cleanupCallbacks: Array<() => void>) {
  const callbacks = cleanupCallbacks.splice(0).reverse();
  for (const cleanup of callbacks) {
    try {
      cleanup();
    } catch {
      // Continue releasing remaining WebGL resources.
    }
  }
}
