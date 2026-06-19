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

See [processor-docs/video-processors.md](processor-docs/video-processors.md) for browser support checks, tuning options, and the sample app workflow.

## Running The Sample App

This repository includes a small [Vite](https://vitejs.dev/) example app that demonstrates the JBF background processor with a LiveKit room.

```sh
# install pnpm: https://pnpm.io/installation
pnpm install
pnpm sample
```
