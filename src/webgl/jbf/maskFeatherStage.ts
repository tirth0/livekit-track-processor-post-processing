import {
  bindPipelineStageAttributes,
  compileShader,
  createPiplelineStageProgram,
  glsl,
} from './helpers/webglHelper';

export type MaskFeatherStage = {
  render(): void;
  updateOptions(options: { enabled?: boolean; strength?: number }): void;
  cleanUp(): void;
};

export function buildMaskFeatherStage(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  positionBuffer: WebGLBuffer,
  texCoordBuffer: WebGLBuffer,
  inputTexture: WebGLTexture,
  outputTexture: WebGLTexture,
  canvas: OffscreenCanvas | HTMLCanvasElement,
): MaskFeatherStage {
  const fragmentShaderSource = glsl`#version 300 es

    precision highp float;

    uniform sampler2D u_mask;
    uniform vec2 u_texelSize;
    uniform bool u_enabled;
    uniform float u_strength;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      float center = texture(u_mask, v_texCoord).a;

      if (!u_enabled || u_strength <= 0.0) {
        outColor = vec4(0.0, 0.0, 0.0, center);
        return;
      }

      float blurred = center * 4.0;
      blurred += texture(u_mask, v_texCoord + vec2(-u_texelSize.x, 0.0)).a * 2.0;
      blurred += texture(u_mask, v_texCoord + vec2(u_texelSize.x, 0.0)).a * 2.0;
      blurred += texture(u_mask, v_texCoord + vec2(0.0, -u_texelSize.y)).a * 2.0;
      blurred += texture(u_mask, v_texCoord + vec2(0.0, u_texelSize.y)).a * 2.0;
      blurred += texture(u_mask, v_texCoord + vec2(-u_texelSize.x, -u_texelSize.y)).a;
      blurred += texture(u_mask, v_texCoord + vec2(u_texelSize.x, -u_texelSize.y)).a;
      blurred += texture(u_mask, v_texCoord + vec2(-u_texelSize.x, u_texelSize.y)).a;
      blurred += texture(u_mask, v_texCoord + vec2(u_texelSize.x, u_texelSize.y)).a;
      blurred /= 16.0;

      float mask = mix(center, blurred, clamp(u_strength, 0.0, 1.0));
      outColor = vec4(0.0, 0.0, 0.0, mask);
    }
  `;

  const { width: outputWidth, height: outputHeight } = canvas;
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
  const texelSizeLocation = gl.getUniformLocation(program, 'u_texelSize');
  const enabledLocation = gl.getUniformLocation(program, 'u_enabled');
  const strengthLocation = gl.getUniformLocation(program, 'u_strength');
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
  gl.uniform2f(texelSizeLocation, 1 / outputWidth, 1 / outputHeight);
  updateOptions({ enabled: true, strength: 0.35 });

  function render() {
    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.useProgram(program);
    bindPipelineStageAttributes(gl, program, positionBuffer, texCoordBuffer);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function updateOptions(options: { enabled?: boolean; strength?: number }) {
    gl.useProgram(program);
    if (typeof options.enabled === 'boolean') {
      gl.uniform1i(enabledLocation, options.enabled ? 1 : 0);
    }
    if (typeof options.strength === 'number') {
      gl.uniform1f(strengthLocation, options.strength);
    }
  }

  function cleanUp() {
    gl.deleteFramebuffer(frameBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(fragmentShader);
  }

  return { render, updateOptions, cleanUp };
}
