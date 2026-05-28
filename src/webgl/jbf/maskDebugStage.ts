import {
  bindPipelineStageAttributes,
  compileShader,
  createPiplelineStageProgram,
  glsl,
} from './helpers/webglHelper';

export type MaskDebugStage = {
  render(maskTexture: WebGLTexture, coverage?: [number, number]): void;
  cleanUp(): void;
};

export function buildMaskDebugStage(
  gl: WebGL2RenderingContext,
  positionBuffer: WebGLBuffer,
  texCoordBuffer: WebGLBuffer,
  canvas: OffscreenCanvas | HTMLCanvasElement,
): MaskDebugStage {
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

    uniform sampler2D u_mask;
    uniform vec2 u_coverage;
    uniform bool u_applyCoverage;

    in vec2 v_texCoord;

    out vec4 outColor;

    void main() {
      float mask = texture(u_mask, v_texCoord).a;
      if (u_applyCoverage) {
        mask = smoothstep(u_coverage.x, u_coverage.y, mask);
      }
      outColor = vec4(vec3(mask), 1.0);
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
  const maskLocation = gl.getUniformLocation(program, 'u_mask');
  const coverageLocation = gl.getUniformLocation(program, 'u_coverage');
  const applyCoverageLocation = gl.getUniformLocation(program, 'u_applyCoverage');
  gl.useProgram(program);
  gl.uniform1i(maskLocation, 0);
  gl.uniform2f(coverageLocation, 0.68, 0.83);
  gl.uniform1i(applyCoverageLocation, 0);

  function render(maskTexture: WebGLTexture, coverage?: [number, number]) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    bindPipelineStageAttributes(gl, program, positionBuffer, texCoordBuffer);
    gl.uniform1i(applyCoverageLocation, coverage ? 1 : 0);
    if (coverage) {
      gl.uniform2f(coverageLocation, coverage[0], coverage[1]);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
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
