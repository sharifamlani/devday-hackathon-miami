/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable -- lifted from google-gemini/live-api-web-console as-is (see NOTICE) */

export type GetAudioContextOptions = AudioContextOptions & {
  id?: string;
};

const map: Map<string, AudioContext> = new Map();

// Modified (see NOTICE): the original first played a silent clip to probe the
// autoplay policy and waited for a pointer/key event if that failed. Donor Desk
// always starts recording from a click, so the context is created directly
// (the probe cost ~40 ms at the start of every recording).
export const audioContext: (
  options?: GetAudioContextOptions
) => Promise<AudioContext> = async (options?: GetAudioContextOptions) => {
  if (options?.id && map.has(options.id)) {
    const ctx = map.get(options.id);
    if (ctx) {
      return ctx;
    }
  }
  const ctx = new AudioContext(options);
  if (options?.id) {
    map.set(options.id, ctx);
  }
  return ctx;
};

export function base64ToArrayBuffer(base64: string) {
  var binaryString = atob(base64);
  var bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
