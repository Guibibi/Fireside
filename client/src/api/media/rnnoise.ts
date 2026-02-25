import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

export { RnnoiseWorkletNode };

let cachedWasmBinary: ArrayBuffer | null = null;
const registeredContexts = new WeakSet<AudioContext>();

export async function createRnnoiseNode(audioContext: AudioContext): Promise<RnnoiseWorkletNode | null> {
  try {
    if (!cachedWasmBinary) {
      cachedWasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseWasmSimdUrl });
    }

    if (!registeredContexts.has(audioContext)) {
      await audioContext.audioWorklet.addModule(rnnoiseWorkletUrl);
      registeredContexts.add(audioContext);
    }

    return new RnnoiseWorkletNode(audioContext, { maxChannels: 1, wasmBinary: cachedWasmBinary });
  } catch (error) {
    console.warn("[rnnoise] Failed to create RNNoise node, falling back to no suppression:", error);
    return null;
  }
}

export function destroyRnnoiseNode(node: RnnoiseWorkletNode): void {
  try {
    node.disconnect();
    node.destroy();
  } catch {
    // best effort
  }
}
