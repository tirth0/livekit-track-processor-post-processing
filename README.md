# LiveKit JBF background processor

Joint bilateral filter background processor for [LiveKit](https://livekit.io) video tracks. The processor implements the [`TrackProcessor`](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackProcessor.html) interface from `livekit-client` and can blur the background, replace it with an image, or run in disabled passthrough mode.

## Install

```sh
npm add @tirth0/livekit-track-processor-jbf
```

## Usage

```ts
import { JBFBackgroundProcessor } from '@tirth0/livekit-track-processor-jbf';

const processor = JBFBackgroundProcessor({
  mode: 'background-blur',
  blurRadius: 10,
});

await videoTrack.setProcessor(processor);
```

Available modes:

- `background-blur` uses the current frame as the background and applies blur behind the person.
- `virtual-background` composites the person over an image from `imagePath`.
- `disabled` keeps the processor attached while passing frames through unchanged.

Switch modes without detaching the processor:

```ts
await processor.switchTo({ mode: 'virtual-background', imagePath: '/background.jpg' });
await processor.switchTo({ mode: 'background-blur', blurRadius: 12 });
await processor.switchTo({ mode: 'disabled' });
```

## JBF Options

Pass shared JBF tuning options directly to `JBFBackgroundProcessor()` in any mode:

```ts
const processor = JBFBackgroundProcessor({
  mode: 'background-blur',
  blurRadius: 10,
  coverage: [0.68, 0.83],
  jointBilateralFilterEnabled: true,
  sigmaSpace: 1,
  sigmaColor: 0.1,
  temporalMode: 'temporal',
  temporalAlpha: 0.5,
  maskFeatheringEnabled: true,
  maskFeatheringStrength: 0.35,
});
```

Update tuning while the processor is attached with `updateTransformerOptions()`:

```ts
await processor.updateTransformerOptions({
  temporalMode: 'hysteresis',
  hysteresisEnterThreshold: 0.45,
  hysteresisExitThreshold: 0.25,
});
```

Available options:

- `mode`: required. Accepts `background-blur`, `virtual-background`, or `disabled`.
- `blurRadius`: default `10` for `background-blur`. Controls background blur strength.
- `imagePath`: required for `virtual-background`; no default. URL or path for the replacement image.
- `coverage`: default `[0.68, 0.83]`. Mask confidence range used for foreground compositing.
- `lightWrapping`: default `0.3`. Blends background light around foreground edges in virtual-background mode.
- `blendMode`: default `screen`. Accepts `screen` or `linearDodge` for light wrapping.
- `jointBilateralFilterEnabled`: default `true`. Enables edge-aware mask refinement.
- `sigmaSpace`: default `1`. Spatial radius for the joint bilateral filter.
- `sigmaColor`: default `0.1`. Color-similarity threshold for preserving edges during filtering.
- `dilationEnabled`: default `false`. Expands the mask before filtering.
- `dilationStrength`: default `0.7`. Strength of mask expansion when dilation is enabled.
- `temporalMode`: default `temporal`. Accepts `off`, `temporal`, or `hysteresis`.
- `temporalAlpha`: default `0.5`. Smoothing factor for temporal mask updates.
- `hysteresisEnterThreshold`: default `0.45`. Foreground entry threshold for hysteresis mode.
- `hysteresisExitThreshold`: default `0.25`. Foreground exit threshold for hysteresis mode.
- `maskFeatheringEnabled`: default `true`. Softens mask edges after refinement.
- `maskFeatheringStrength`: default `0.35`. Strength of edge feathering.
- `debugOutput`: default `none`. Accepts `none`, `raw-mask`, `dilated-mask`, `jbf-mask`, `temporal-mask`, or `coverage-mask`.
- `segmenterOptions`: default `{}`. Extra MediaPipe image segmenter base options.
- `assetPaths.tasksVisionFileSet`: default `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@<installed-version>/wasm`. Override to self-host WASM assets.
- `assetPaths.modelAssetPath`: default `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`. Override to self-host the model.
- `onFrameProcessed`: default `undefined`. Receives per-frame processing, segmentation, and filter timings.
- `maxFps`: default `30`. Maximum frame rate for the canvas `captureStream()` fallback.

See [processor-docs/video-processors.md](processor-docs/video-processors.md) for browser support checks, tuning options, and the sample app workflow.

## Running The Sample App

This repository includes a small [Vite](https://vitejs.dev/) example app that demonstrates the JBF background processor with a LiveKit room.

```sh
# install pnpm: https://pnpm.io/installation
pnpm install
pnpm sample
```
