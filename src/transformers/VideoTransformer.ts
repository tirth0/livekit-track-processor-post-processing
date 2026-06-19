import { VideoTrackTransformer, VideoTransformerInitOptions } from './types';

export default abstract class VideoTransformer<Options extends Record<string, unknown>>
  implements VideoTrackTransformer<Options>
{
  transformer?: TransformStream;

  canvas?: OffscreenCanvas | HTMLCanvasElement;

  // ctx?: OffscreenCanvasRenderingContext2D;

  inputVideo?: HTMLVideoElement;

  protected isDisabled?: boolean = false;

  async init({
    outputCanvas,
    inputElement: inputVideo,
  }: VideoTransformerInitOptions): Promise<void> {
    if (!(inputVideo instanceof HTMLVideoElement)) {
      throw TypeError('Video transformer needs a HTMLVideoElement as input');
    }

    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.canvas = outputCanvas || null;
    this.inputVideo = inputVideo;
    this.isDisabled = false;
  }

  async restart({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
    this.canvas = outputCanvas || null;
    this.inputVideo = inputVideo;
    this.isDisabled = false;
  }

  async destroy() {
    this.isDisabled = true;
    this.canvas = undefined;
  }

  abstract transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ): void;

  abstract update(options: Options): void;
}
