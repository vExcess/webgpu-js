# webgpu-js
All development of this fork of webgpu-js was done by Grok 4.6

A [WebGPU](https://gpuweb.github.io/gpuweb/) polyfill on **WebGL 2**. Use it where the browser exposes `navigator.gpu` but cannot create an adapter (common on Linux), or to force a GL backend for debugging.

```html
<script src="webgpu.js"></script>
```

The script wraps `navigator.gpu`. If the native `requestAdapter()` returns `null`, the WebGL 2 implementation is used automatically.

Force the polyfill even when native WebGPU works:

- URL query: `?webgpu_js=1`
- or `localStorage.setItem('webgpu_js', '1')`

`getPreferredCanvasFormat()` is `'rgba8unorm'`.

## Examples

Serve the directory over HTTP (or open the HTML files directly) and open:

| Page | What it shows |
|------|----------------|
| [hello-green.html](hello-green.html) | Clear the canvas |
| [hello-triangle.html](hello-triangle.html) | WGSL triangle |
| [hello-blend.html](hello-blend.html) | Indexed draw + blending |
| [hello-bind-groups.html](hello-bind-groups.html) | Texture, sampler, dynamic UBO |
| [hello-validation.html](hello-validation.html) | Error scopes + device.lost |
| [hello-cube.html](hello-cube.html) | Depth-tested textured cube |
| [hello-compute.html](hello-compute.html) | Compute dispatch emulated with a fragment pass |

## What works

- Modern canvas: `getContext('webgpu')`, `configure()`, `getCurrentTexture()`
- Buffers: `createBuffer`, `mappedAtCreation`, `mapAsync` / `getMappedRange` / `unmap`, `queue.writeBuffer`
- Textures, samplers, `queue.writeTexture`, copies
- WGSL vertex/fragment modules (subset → GLSL ES 3.00)
- Render pipelines (`layout: 'auto'` or explicit layouts), bind groups, blending, depth/stencil
- Compute pipelines: `beginComputePass`, `dispatchWorkgroups` — **emulated** with a fullscreen triangle and storage textures (not native compute)

## Compute emulation limits

WebGL 2 has no compute stage. Dispatches run as fragment-shader passes:

- `@builtin(global_invocation_id)` is derived from the storage-texture pixel
- `var<workgroup>` and `workgroupBarrier()` are not shared-memory equivalents
- Atomics are not generally available
- Read–write storage uses a ping-pong texture; races within one dispatch are not GPU-compute accurate
- Expect higher CPU/GPU cost than native WebGPU compute

Unsupported or rejected features fail with `GPUValidationError` where we can detect them.

## Requirements

WebGL 2 (and `EXT_color_buffer_float` for some float render targets).
