/* WebGPU on WebGL 2 — modern spec façade (polyfill). */
(function (global) {
   'use strict';

   const GL = (typeof WebGL2RenderingContext !== 'undefined') ? WebGL2RenderingContext : {};
   const ORIG_GET_CONTEXT = HTMLCanvasElement.prototype.getContext;

   // ---------------------------------------------------------------------------
   // Spec constants
   // ---------------------------------------------------------------------------

   function defineConst(name, obj) {
      if (global[name] === undefined) {
         global[name] = Object.freeze(obj);
      }
      return global[name];
   }

   const GPUBufferUsage = defineConst('GPUBufferUsage', {
      MAP_READ: 0x0001,
      MAP_WRITE: 0x0002,
      COPY_SRC: 0x0004,
      COPY_DST: 0x0008,
      INDEX: 0x0010,
      VERTEX: 0x0020,
      UNIFORM: 0x0040,
      STORAGE: 0x0080,
      INDIRECT: 0x0100,
      QUERY_RESOLVE: 0x0200,
   });

   const GPUTextureUsage = defineConst('GPUTextureUsage', {
      COPY_SRC: 0x01,
      COPY_DST: 0x02,
      TEXTURE_BINDING: 0x04,
      STORAGE_BINDING: 0x08,
      RENDER_ATTACHMENT: 0x10,
      SAMPLED: 0x04,
      STORAGE: 0x08,
      OUTPUT_ATTACHMENT: 0x10,
   });

   const GPUShaderStage = defineConst('GPUShaderStage', {
      VERTEX: 0x1,
      FRAGMENT: 0x2,
      COMPUTE: 0x4,
   });
   defineConst('GPUShaderStageBit', GPUShaderStage);

   const GPUMapMode = defineConst('GPUMapMode', {
      READ: 0x0001,
      WRITE: 0x0002,
   });

   const GPUColorWrite = defineConst('GPUColorWrite', {
      RED: 0x1,
      GREEN: 0x2,
      BLUE: 0x4,
      ALPHA: 0x8,
      ALL: 0xF,
   });
   defineConst('GPUColorWriteBits', GPUColorWrite);

   // ---------------------------------------------------------------------------
   // Errors
   // ---------------------------------------------------------------------------

   if (global.GPUOutOfMemoryError === undefined) {
      global.GPUOutOfMemoryError = class GPUOutOfMemoryError extends Error {
         constructor(message) {
            super(message || '<GPUOutOfMemoryError>');
            this.name = 'GPUOutOfMemoryError';
         }
      };
   }
   if (global.GPUValidationError === undefined) {
      global.GPUValidationError = class GPUValidationError extends Error {
         constructor(message) {
            super(message || '<GPUValidationError>');
            this.name = 'GPUValidationError';
         }
      };
   }
   if (global.GPUInternalError === undefined) {
      global.GPUInternalError = class GPUInternalError extends Error {
         constructor(message) {
            super(message || '<GPUInternalError>');
            this.name = 'GPUInternalError';
         }
      };
   }
   if (global.GPUUncapturedErrorEvent === undefined) {
      global.GPUUncapturedErrorEvent = class GPUUncapturedErrorEvent extends Event {
         constructor(type, init) {
            super(type, init);
            this.error = init && init.error;
         }
      };
   }

   const IS_GPU_ERROR = {
      GPUOutOfMemoryError: true,
      GPUValidationError: true,
      GPUInternalError: true,
   };

   class PolyfillValidationError extends Error {
      constructor(message) {
         super(message || '<GPUValidationError>');
         this.name = 'GPUValidationError';
      }
   }
   class PolyfillOOMError extends Error {
      constructor(message) {
         super(message || '<GPUOutOfMemoryError>');
         this.name = 'GPUOutOfMemoryError';
      }
   }

   function ASSERT(val, info) {
      if (!val) throw new Error('ASSERT: ' + info);
   }
   function VALIDATE(ok, message) {
      if (!ok) throw new PolyfillValidationError(message);
   }

   // ---------------------------------------------------------------------------
   // Descriptor helpers
   // ---------------------------------------------------------------------------

   function asColor(c) {
      if (!c) return { r: 0, g: 0, b: 0, a: 1 };
      if (c.length !== undefined) return { r: c[0], g: c[1], b: c[2], a: c[3] };
      return { r: c.r, g: c.g, b: c.b, a: c.a };
   }

   function asExtent3D(e) {
      if (!e) return { width: 1, height: 1, depthOrArrayLayers: 1 };
      if (e.length !== undefined) {
         return {
            width: e[0],
            height: e[1] !== undefined ? e[1] : 1,
            depthOrArrayLayers: e[2] !== undefined ? e[2] : 1,
         };
      }
      return {
         width: e.width,
         height: e.height !== undefined ? e.height : 1,
         depthOrArrayLayers: e.depthOrArrayLayers !== undefined ? e.depthOrArrayLayers : (e.depth !== undefined ? e.depth : 1),
      };
   }

   function asOrigin3D(o) {
      if (!o) return { x: 0, y: 0, z: 0 };
      if (o.length !== undefined) return { x: o[0] || 0, y: o[1] || 0, z: o[2] || 0 };
      return { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
   }

   const GL_TYPE_CTOR = {};
   GL_TYPE_CTOR[GL.UNSIGNED_BYTE] = Uint8Array;
   GL_TYPE_CTOR[GL.BYTE] = Int8Array;
   GL_TYPE_CTOR[GL.UNSIGNED_SHORT] = Uint16Array;
   GL_TYPE_CTOR[GL.SHORT] = Int16Array;
   GL_TYPE_CTOR[GL.UNSIGNED_INT] = Uint32Array;
   GL_TYPE_CTOR[GL.INT] = Int32Array;
   GL_TYPE_CTOR[GL.FLOAT] = Float32Array;
   GL_TYPE_CTOR[GL.HALF_FLOAT] = Uint16Array;
   GL_TYPE_CTOR[GL.UNSIGNED_INT_2_10_10_10_REV] = Uint32Array;
   GL_TYPE_CTOR[GL.UNSIGNED_INT_10F_11F_11F_REV] = Uint32Array;
   GL_TYPE_CTOR[GL.UNSIGNED_INT_24_8] = Uint32Array;

   function typedViewForTexel(glType, data, byteOffset, byteLength) {
      const Ctor = GL_TYPE_CTOR[glType] || Uint8Array;
      const elem = Ctor.BYTES_PER_ELEMENT || 1;
      const extra = byteOffset || 0;
      let buf, off, len;
      if (data instanceof ArrayBuffer) {
         buf = data;
         off = extra;
         len = byteLength !== undefined ? byteLength : (data.byteLength - off);
      } else if (data && data.buffer) {
         buf = data.buffer;
         off = (data.byteOffset || 0) + extra;
         len = byteLength !== undefined ? byteLength : (data.byteLength - extra);
      } else {
         return data instanceof Ctor ? data : new Ctor(data);
      }
      if ((off % elem) === 0) return new Ctor(buf, off, Math.floor(len / elem));
      const copy = new Uint8Array(len);
      copy.set(new Uint8Array(buf, off, len));
      return new Ctor(copy.buffer);
   }

   const GLSL_RESERVED = {
      in: 1, out: 1, uniform: 1, attribute: 1, varying: 1, layout: 1, precision: 1,
      centroid: 1, flat: 1, smooth: 1, invariant: 1, highp: 1, mediump: 1, lowp: 1,
      discard: 1, common: 1, input: 1, output: 1, filter: 1, texture: 1,
      half: 1, fixed: 1, superp: 1, packed: 1, double: 1, long: 1, short: 1,
      unsigned: 1, active: 1, asm: 1, class: 1, union: 1, enum: 1, typedef: 1,
      template: 1, this: 1, goto: 1, inline: 1, noinline: 1, volatile: 1,
      public: 1, static: 1, extern: 1, external: 1, interface: 1, partition: 1,
      sampler1D: 1, sampler2D: 1, sampler3D: 1, samplerCube: 1,
   };

   function safeGlslIdent(name) {
      return GLSL_RESERVED[name] ? 'webgpu_id_' + name : name;
   }

   const SAMPLER_UNIFORM_TYPES = {};
   [
      'SAMPLER_2D', 'SAMPLER_3D', 'SAMPLER_CUBE', 'SAMPLER_2D_SHADOW',
      'SAMPLER_2D_ARRAY', 'SAMPLER_2D_ARRAY_SHADOW', 'SAMPLER_CUBE_SHADOW',
      'INT_SAMPLER_2D', 'INT_SAMPLER_3D', 'INT_SAMPLER_CUBE', 'INT_SAMPLER_2D_ARRAY',
      'UNSIGNED_INT_SAMPLER_2D', 'UNSIGNED_INT_SAMPLER_3D', 'UNSIGNED_INT_SAMPLER_CUBE',
      'UNSIGNED_INT_SAMPLER_2D_ARRAY',
   ].forEach(k => { if (GL[k] !== undefined) SAMPLER_UNIFORM_TYPES[GL[k]] = true; });

   function forcePolyfill() {
      try {
         if (typeof location !== 'undefined' && /(?:\?|&)webgpu_js=1(?:&|$)/.test(location.search))
            return true;
         if (typeof localStorage !== 'undefined' && localStorage.getItem('webgpu_js') === '1')
            return true;
      } catch (e) {}
      return false;
   }

   // ---------------------------------------------------------------------------
   // Format tables
   // ---------------------------------------------------------------------------

   const TEX_FORMAT_INFO = {
      'r8unorm':             { format: GL.R8, unpack: GL.RED, type: GL.UNSIGNED_BYTE, float: true, bpp: 1 },
      'r8snorm':             { format: GL.R8_SNORM, unpack: GL.RED, type: GL.BYTE, float: true, bpp: 1 },
      'r8uint':              { format: GL.R8UI, unpack: GL.RED_INTEGER, type: GL.UNSIGNED_BYTE, float: false, bpp: 1 },
      'r8sint':              { format: GL.R8I, unpack: GL.RED_INTEGER, type: GL.BYTE, float: false, bpp: 1 },
      'r16uint':             { format: GL.R16UI, unpack: GL.RED_INTEGER, type: GL.UNSIGNED_SHORT, float: false, bpp: 2 },
      'r16sint':             { format: GL.R16I, unpack: GL.RED_INTEGER, type: GL.SHORT, float: false, bpp: 2 },
      'r16float':            { format: GL.R16F, unpack: GL.RED, type: GL.HALF_FLOAT, float: true, bpp: 2 },
      'rg8unorm':            { format: GL.RG8, unpack: GL.RG, type: GL.UNSIGNED_BYTE, float: true, bpp: 2 },
      'rg8snorm':            { format: GL.RG8_SNORM, unpack: GL.RG, type: GL.BYTE, float: true, bpp: 2 },
      'rg8uint':             { format: GL.RG8UI, unpack: GL.RG_INTEGER, type: GL.UNSIGNED_BYTE, float: false, bpp: 2 },
      'rg8sint':             { format: GL.RG8I, unpack: GL.RG_INTEGER, type: GL.BYTE, float: false, bpp: 2 },
      'r32uint':             { format: GL.R32UI, unpack: GL.RED_INTEGER, type: GL.UNSIGNED_INT, float: false, bpp: 4 },
      'r32sint':             { format: GL.R32I, unpack: GL.RED_INTEGER, type: GL.INT, float: false, bpp: 4 },
      'r32float':            { format: GL.R32F, unpack: GL.RED, type: GL.FLOAT, float: true, bpp: 4 },
      'rg16uint':            { format: GL.RG16UI, unpack: GL.RG_INTEGER, type: GL.UNSIGNED_SHORT, float: false, bpp: 4 },
      'rg16sint':            { format: GL.RG16I, unpack: GL.RG_INTEGER, type: GL.SHORT, float: false, bpp: 4 },
      'rg16float':           { format: GL.RG16F, unpack: GL.RG, type: GL.HALF_FLOAT, float: true, bpp: 4 },
      'rgba8unorm':          { format: GL.RGBA8, unpack: GL.RGBA, type: GL.UNSIGNED_BYTE, float: true, bpp: 4 },
      'rgba8unorm-srgb':     { format: GL.SRGB8_ALPHA8, unpack: GL.RGBA, type: GL.UNSIGNED_BYTE, float: true, bpp: 4 },
      'rgba8snorm':          { format: GL.RGBA8_SNORM, unpack: GL.RGBA, type: GL.BYTE, float: true, bpp: 4 },
      'rgba8uint':           { format: GL.RGBA8UI, unpack: GL.RGBA_INTEGER, type: GL.UNSIGNED_BYTE, float: false, bpp: 4 },
      'rgba8sint':           { format: GL.RGBA8I, unpack: GL.RGBA_INTEGER, type: GL.BYTE, float: false, bpp: 4 },
      'bgra8unorm':          { format: GL.RGBA8, unpack: GL.RGBA, type: GL.UNSIGNED_BYTE, float: true, bpp: 4, swizzle: 'bgra' },
      'bgra8unorm-srgb':     { format: GL.SRGB8_ALPHA8, unpack: GL.RGBA, type: GL.UNSIGNED_BYTE, float: true, bpp: 4, swizzle: 'bgra' },
      'rgb10a2unorm':        { format: GL.RGB10_A2, unpack: GL.RGBA, type: GL.UNSIGNED_INT_2_10_10_10_REV, float: true, bpp: 4 },
      'rg11b10ufloat':       { format: GL.R11F_G11F_B10F, unpack: GL.RGB, type: GL.UNSIGNED_INT_10F_11F_11F_REV, float: true, bpp: 4 },
      'rg32uint':            { format: GL.RG32UI, unpack: GL.RG_INTEGER, type: GL.UNSIGNED_INT, float: false, bpp: 8 },
      'rg32sint':            { format: GL.RG32I, unpack: GL.RG_INTEGER, type: GL.INT, float: false, bpp: 8 },
      'rg32float':           { format: GL.RG32F, unpack: GL.RG, type: GL.FLOAT, float: true, bpp: 8 },
      'rgba16uint':          { format: GL.RGBA16UI, unpack: GL.RGBA_INTEGER, type: GL.UNSIGNED_SHORT, float: false, bpp: 8 },
      'rgba16sint':          { format: GL.RGBA16I, unpack: GL.RGBA_INTEGER, type: GL.SHORT, float: false, bpp: 8 },
      'rgba16float':         { format: GL.RGBA16F, unpack: GL.RGBA, type: GL.HALF_FLOAT, float: true, bpp: 8 },
      'rgba32uint':          { format: GL.RGBA32UI, unpack: GL.RGBA_INTEGER, type: GL.UNSIGNED_INT, float: false, bpp: 16 },
      'rgba32sint':          { format: GL.RGBA32I, unpack: GL.RGBA_INTEGER, type: GL.INT, float: false, bpp: 16 },
      'rgba32float':         { format: GL.RGBA32F, unpack: GL.RGBA, type: GL.FLOAT, float: true, bpp: 16 },
      'depth32float':        { format: GL.DEPTH_COMPONENT32F, unpack: GL.DEPTH_COMPONENT, type: GL.FLOAT, float: true, bpp: 4, depth: true },
      'depth24plus':         { format: GL.DEPTH_COMPONENT24, unpack: GL.DEPTH_COMPONENT, type: GL.UNSIGNED_INT, float: true, bpp: 4, depth: true },
      'depth24plus-stencil8':{ format: GL.DEPTH24_STENCIL8, unpack: GL.DEPTH_STENCIL, type: GL.UNSIGNED_INT_24_8, float: true, bpp: 4, depth: true, stencil: true },
      'depth32float-stencil8':{ format: GL.DEPTH24_STENCIL8, unpack: GL.DEPTH_STENCIL, type: GL.UNSIGNED_INT_24_8, float: true, bpp: 4, depth: true, stencil: true },
   };

   const DEFAULT_RENDERABLE = {};
   ['R8','RG8','RGB8','RGB565','RGBA4','RGB5_A1','RGBA8','RGB10_A2','RGB10_A2UI','SRGB8_ALPHA8',
    'R8I','R8UI','R16I','R16UI','R32I','R32UI','RG8I','RG8UI','RG16I','RG16UI','RG32I','RG32UI',
    'RGBA8I','RGBA8UI','RGBA16I','RGBA16UI','RGBA32I','RGBA32UI'].forEach(k => {
      if (GL[k] !== undefined) DEFAULT_RENDERABLE[GL[k]] = true;
   });
   const FLOAT_RENDERABLE = {};
   ['R16F','R32F','RG16F','RG32F','RGBA16F','RGBA32F','R11F_G11F_B10F'].forEach(k => {
      if (GL[k] !== undefined) FLOAT_RENDERABLE[GL[k]] = true;
   });

   const VERTEX_FORMAT = {
      uint8x2: { channels: 2, size: 2, type: GL.UNSIGNED_BYTE, norm: false, float: false },
      uint8x4: { channels: 4, size: 4, type: GL.UNSIGNED_BYTE, norm: false, float: false },
      sint8x2: { channels: 2, size: 2, type: GL.BYTE, norm: false, float: false },
      sint8x4: { channels: 4, size: 4, type: GL.BYTE, norm: false, float: false },
      unorm8x2: { channels: 2, size: 2, type: GL.UNSIGNED_BYTE, norm: true, float: true },
      unorm8x4: { channels: 4, size: 4, type: GL.UNSIGNED_BYTE, norm: true, float: true },
      snorm8x2: { channels: 2, size: 2, type: GL.BYTE, norm: true, float: true },
      snorm8x4: { channels: 4, size: 4, type: GL.BYTE, norm: true, float: true },
      uint16x2: { channels: 2, size: 4, type: GL.UNSIGNED_SHORT, norm: false, float: false },
      uint16x4: { channels: 4, size: 8, type: GL.UNSIGNED_SHORT, norm: false, float: false },
      sint16x2: { channels: 2, size: 4, type: GL.SHORT, norm: false, float: false },
      sint16x4: { channels: 4, size: 8, type: GL.SHORT, norm: false, float: false },
      unorm16x2: { channels: 2, size: 4, type: GL.UNSIGNED_SHORT, norm: true, float: true },
      unorm16x4: { channels: 4, size: 8, type: GL.UNSIGNED_SHORT, norm: true, float: true },
      snorm16x2: { channels: 2, size: 4, type: GL.SHORT, norm: true, float: true },
      snorm16x4: { channels: 4, size: 8, type: GL.SHORT, norm: true, float: true },
      float16x2: { channels: 2, size: 4, type: GL.HALF_FLOAT, norm: false, float: true },
      float16x4: { channels: 4, size: 8, type: GL.HALF_FLOAT, norm: false, float: true },
      float32: { channels: 1, size: 4, type: GL.FLOAT, norm: false, float: true },
      float32x2: { channels: 2, size: 8, type: GL.FLOAT, norm: false, float: true },
      float32x3: { channels: 3, size: 12, type: GL.FLOAT, norm: false, float: true },
      float32x4: { channels: 4, size: 16, type: GL.FLOAT, norm: false, float: true },
      uint32: { channels: 1, size: 4, type: GL.UNSIGNED_INT, norm: false, float: false },
      uint32x2: { channels: 2, size: 8, type: GL.UNSIGNED_INT, norm: false, float: false },
      uint32x3: { channels: 3, size: 12, type: GL.UNSIGNED_INT, norm: false, float: false },
      uint32x4: { channels: 4, size: 16, type: GL.UNSIGNED_INT, norm: false, float: false },
      sint32: { channels: 1, size: 4, type: GL.INT, norm: false, float: false },
      sint32x2: { channels: 2, size: 8, type: GL.INT, norm: false, float: false },
      sint32x3: { channels: 3, size: 12, type: GL.INT, norm: false, float: false },
      sint32x4: { channels: 4, size: 16, type: GL.INT, norm: false, float: false },
      float2: { channels: 2, size: 8, type: GL.FLOAT, norm: false, float: true },
      float3: { channels: 3, size: 12, type: GL.FLOAT, norm: false, float: true },
      float4: { channels: 4, size: 16, type: GL.FLOAT, norm: false, float: true },
      uchar4norm: { channels: 4, size: 4, type: GL.UNSIGNED_BYTE, norm: true, float: true },
      unorm8x4: { channels: 4, size: 4, type: GL.UNSIGNED_BYTE, norm: true, float: true },
   };

   const PRIM_TOPO = {
      'point-list': GL.POINTS,
      'line-list': GL.LINES,
      'line-strip': GL.LINE_STRIP,
      'triangle-list': GL.TRIANGLES,
      'triangle-strip': GL.TRIANGLE_STRIP,
   };
   const BLEND_EQUATION = {
      add: GL.FUNC_ADD, subtract: GL.FUNC_SUBTRACT, 'reverse-subtract': GL.FUNC_REVERSE_SUBTRACT,
      min: GL.MIN, max: GL.MAX,
   };
   const BLEND_FUNC = {
      zero: GL.ZERO, one: GL.ONE,
      'src-color': GL.SRC_COLOR, 'one-minus-src-color': GL.ONE_MINUS_SRC_COLOR,
      'src-alpha': GL.SRC_ALPHA, 'one-minus-src-alpha': GL.ONE_MINUS_SRC_ALPHA,
      'dst-color': GL.DST_COLOR, 'one-minus-dst-color': GL.ONE_MINUS_DST_COLOR,
      'dst-alpha': GL.DST_ALPHA, 'one-minus-dst-alpha': GL.ONE_MINUS_DST_ALPHA,
      'src-alpha-saturated': GL.SRC_ALPHA_SATURATE,
      constant: GL.CONSTANT_COLOR, 'one-minus-constant': GL.ONE_MINUS_CONSTANT_COLOR,
      'blend-color': GL.CONSTANT_COLOR, 'one-minus-blend-color': GL.ONE_MINUS_CONSTANT_COLOR,
   };
   const COMPARE_FUNC = {
      never: GL.NEVER, less: GL.LESS, equal: GL.EQUAL, 'less-equal': GL.LEQUAL,
      greater: GL.GREATER, 'not-equal': GL.NOTEQUAL, 'greater-equal': GL.GEQUAL, always: GL.ALWAYS,
   };
   const STENCIL_OP = {
      keep: GL.KEEP, zero: GL.ZERO, replace: GL.REPLACE, invert: GL.INVERT,
      'increment-clamp': GL.INCR, 'decrement-clamp': GL.DECR,
      'increment-wrap': GL.INCR_WRAP, 'decrement-wrap': GL.DECR_WRAP,
   };
   const WRAP_MODE = {
      'clamp-to-edge': GL.CLAMP_TO_EDGE, repeat: GL.REPEAT, 'mirror-repeat': GL.MIRRORED_REPEAT,
   };
   const FILTER_MODE = { nearest: GL.NEAREST, linear: GL.LINEAR };
   const INDEX_FORMAT = {
      uint16: { type: GL.UNSIGNED_SHORT, size: 2 },
      uint32: { type: GL.UNSIGNED_INT, size: 4 },
   };

   // ---------------------------------------------------------------------------
   // WGSL → GLSL ES 3.00
   // ---------------------------------------------------------------------------

   const WGSL_TO_GLSL_TYPE = {
      f32: 'float', i32: 'int', u32: 'uint', bool: 'bool',
      vec2f: 'vec2', vec3f: 'vec3', vec4f: 'vec4',
      vec2i: 'ivec2', vec3i: 'ivec3', vec4i: 'ivec4',
      vec2u: 'uvec2', vec3u: 'uvec3', vec4u: 'uvec4',
      vec2h: 'vec2', vec3h: 'vec3', vec4h: 'vec4',
      mat2x2f: 'mat2', mat3x3f: 'mat3', mat4x4f: 'mat4',
      mat2x2: 'mat2', mat3x3: 'mat3', mat4x4: 'mat4',
      'vec2<f32>': 'vec2', 'vec3<f32>': 'vec3', 'vec4<f32>': 'vec4',
      'vec2<i32>': 'ivec2', 'vec3<i32>': 'ivec3', 'vec4<i32>': 'ivec4',
      'vec2<u32>': 'uvec2', 'vec3<u32>': 'uvec3', 'vec4<u32>': 'uvec4',
      'mat2x2<f32>': 'mat2', 'mat3x3<f32>': 'mat3', 'mat4x4<f32>': 'mat4',
      'mat4x3<f32>': 'mat4x3', 'mat3x4<f32>': 'mat3x4',
   };

   function stripWgslComments(src) {
      return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
   }

   function arrayElemType(t) {
      t = (t || '').replace(/\s+/g, '');
      const fixed = t.match(/^array<(.+),(\d+)>$/);
      if (fixed) return { elem: fixed[1], count: parseInt(fixed[2], 10) };
      const run = t.match(/^array<(.+)>$/);
      if (run) return { elem: run[1], count: 0 };
      return { elem: t, count: 0 };
   }

   function mapWgslType(t) {
      if (!t) return 'float';
      t = t.replace(/\s+/g, '');
      if (WGSL_TO_GLSL_TYPE[t]) return WGSL_TO_GLSL_TYPE[t];
      const arr = t.match(/^array<(.+),(\d+)>$/);
      if (arr) return mapWgslType(arr[1]) + '[' + arr[2] + ']';
      const arrU = t.match(/^array<(.+)>$/);
      if (arrU) return mapWgslType(arrU[1]);
      const tex = t.match(/^texture_2d<(\w+)>$/);
      if (tex) return 'sampler2D';
      if (t === 'sampler' || t === 'sampler_comparison') return 'sampler';
      if (t === 'texture_cube<f32>') return 'samplerCube';
      if (t === 'texture_3d<f32>') return 'sampler3D';
      if (t === 'texture_2d_array<f32>') return 'sampler2DArray';
      if (t === 'texture_depth_2d' || t.indexOf('texture_depth') === 0) return 'sampler2D';
      return t;
   }

   function glslDecl(glType, name) {
      const m = String(glType || '').match(/^(.+)\[(\d+)\]$/);
      if (m) return m[1] + ' ' + name + '[' + m[2] + ']';
      return glType + ' ' + name;
   }

   function matchPair(s, i, open, close) {
      if (s[i] !== open) return -1;
      let d = 0;
      for (let j = i; j < s.length; j++) {
         if (s[j] === open) d++;
         else if (s[j] === close) {
            d--;
            if (d === 0) return j;
         }
      }
      return -1;
   }

   function splitCallArgs(src) {
      const parts = [];
      let cur = '', depth = 0;
      for (let i = 0; i < src.length; i++) {
         const ch = src[i];
         if (ch === '(' || ch === '[' || ch === '{') depth++;
         else if (ch === ')' || ch === ']' || ch === '}') depth--;
         if (ch === ',' && depth === 0) {
            if (cur.trim()) parts.push(cur.trim());
            cur = '';
         } else cur += ch;
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
   }

   function rewriteNamedCalls(s, name, fn) {
      let out = '', i = 0;
      while (i < s.length) {
         if ((i === 0 || !/\w/.test(s[i - 1])) && s.startsWith(name, i)) {
            let k = i + name.length;
            while (k < s.length && /\s/.test(s[k])) k++;
            if (s[k] === '(') {
               const end = matchPair(s, k, '(', ')');
               if (end > 0) {
                  out += fn(splitCallArgs(s.slice(k + 1, end)).map(a => a.trim()));
                  i = end + 1;
                  continue;
               }
            }
         }
         out += s[i++];
      }
      return out;
   }

   function rewriteGenericCtor(s, name, fn) {
      let out = '', i = 0;
      while (i < s.length) {
         if ((i === 0 || !/\w/.test(s[i - 1])) && s.startsWith(name, i)) {
            let k = i + name.length;
            while (k < s.length && /\s/.test(s[k])) k++;
            if (s[k] === '<') {
               const aend = matchPair(s, k, '<', '>');
               if (aend > 0) {
                  let p = aend + 1;
                  while (p < s.length && /\s/.test(s[p])) p++;
                  if (s[p] === '(') {
                     const pend = matchPair(s, p, '(', ')');
                     if (pend > 0) {
                        out += fn(s.slice(k + 1, aend), s.slice(p + 1, pend));
                        i = pend + 1;
                        continue;
                     }
                  }
               }
            }
         }
         out += s[i++];
      }
      return out;
   }

   function emitBitcast(target, args) {
      const gl = mapWgslType(target);
      if (gl === 'uint' || gl.indexOf('uvec') === 0) return 'floatBitsToUint(' + args + ')';
      if (gl === 'int' || gl.indexOf('ivec') === 0) return 'floatBitsToInt(' + args + ')';
      if (gl === 'float' || /^vec[234]$/.test(gl)) return 'uintBitsToFloat(' + args + ')';
      return 'uintBitsToFloat(' + args + ')';
   }

   function looksVectorExpr(e) {
      e = String(e || '').trim();
      return /^(vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|mix|clamp|normalize|cross|min|max|abs|floor|ceil|fract)\s*\(/.test(e)
         || /^(?:equal|notEqual|lessThan|greaterThan|lessThanEqual|greaterThanEqual)\s*\(/.test(e)
         || /^bvec/.test(e);
   }

   function emitSelect(f, t, c) {
      const cond = String(c || '').trim();
      const bvecFn = /^bvec/.test(cond)
         || /^(equal|notEqual|lessThan|greaterThan|lessThanEqual|greaterThanEqual)\s*\(/.test(cond);
      let bvecCmp = false;
      const cmp = cond.match(/^(.*?)(==|!=|<=|>=|<|>)(.*)$/);
      if (cmp && (isVectorish(cmp[1], null) || isVectorish(cmp[3], null))) bvecCmp = true;
      if (bvecFn || bvecCmp) {
         return 'mix((' + f + '), (' + t + '), (' + cond + '))';
      }
      return '((' + cond + ') ? (' + t + ') : (' + f + '))';
   }

   // emitSelect wraps each arm: ((cond) ? (t) : (f)). A regex cannot see past
   // nested calls like clamp(c, vec3(0.0), ...), so this walks matching parens.
   function parseEmittedSelect(s, i) {
      if (s[i] !== '(' || s[i + 1] !== '(') return null;
      const condClose = matchPair(s, i + 1, '(', ')');
      if (condClose < 0) return null;
      let k = condClose + 1;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] !== '?') return null;
      k++;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] !== '(') return null;
      const tClose = matchPair(s, k, '(', ')');
      if (tClose < 0) return null;
      let p = tClose + 1;
      while (p < s.length && /\s/.test(s[p])) p++;
      if (s[p] !== ':') return null;
      p++;
      while (p < s.length && /\s/.test(s[p])) p++;
      if (s[p] !== '(') return null;
      const fClose = matchPair(s, p, '(', ')');
      if (fClose < 0 || s[fClose + 1] !== ')') return null;
      return {
         cond: s.slice(i + 2, condClose),
         t: s.slice(k + 1, tClose),
         f: s.slice(p + 1, fClose),
         end: fClose + 2,
      };
   }

   function rewriteBvecTernaries(s, env) {
      let out = '', i = 0;
      while (i < s.length) {
         if (s[i] === '(' && s[i + 1] === '(') {
            const parsed = parseEmittedSelect(s, i);
            if (parsed) {
               const cond = rewriteBvecTernaries(parsed.cond, env);
               const t = rewriteBvecTernaries(parsed.t, env);
               const f = rewriteBvecTernaries(parsed.f, env);
               const condTy = inferExprType(cond, env);
               if (/^bvec/.test(condTy || '')) {
                  out += 'mix((' + f + '), (' + t + '), (' + cond + '))';
               } else {
                  out += '((' + cond + ') ? (' + t + ') : (' + f + '))';
               }
               i = parsed.end;
               continue;
            }
         }
         out += s[i++];
      }
      return out;
   }

   function emitTextureCompare(args) {
      const tex = args[0] || 'webgpu_missing_tex';
      const uv = args[2] || 'vec2(0.0)';
      if (args.length >= 5) {
         return 'texture(' + tex + ', vec4(' + uv + ', float(' + args[3] + '), ' + args[4] + '))';
      }
      return 'texture(' + tex + ', vec3(' + uv + ', ' + (args[3] || '0.0') + '))';
   }

   function mapTextureUniform(wgslType, compare) {
      const t = (wgslType || '').replace(/\s+/g, '');
      if (compare) {
         if (t.indexOf('array') >= 0) return 'sampler2DArrayShadow';
         if (t.indexOf('cube') >= 0) return 'samplerCubeShadow';
         return 'sampler2DShadow';
      }
      if (t === 'texture_2d_array<f32>' || t === 'texture_depth_2d_array') return 'sampler2DArray';
      if (t === 'texture_cube<f32>' || t === 'texture_depth_cube') return 'samplerCube';
      if (t === 'texture_3d<f32>') return 'sampler3D';
      return 'sampler2D';
   }

   function parseAttrs(prefix) {
      const attrs = {};
      if (!prefix) return attrs;
      const re = /@(\w+)(?:\(([^)]*)\))?/g;
      let m;
      while ((m = re.exec(prefix))) {
         const name = m[1];
         const args = m[2] === undefined ? [] : m[2].split(',').map(s => s.trim());
         attrs[name] = args;
      }
      return attrs;
   }

   function matchBraces(src, openIdx) {
      let depth = 0;
      for (let i = openIdx; i < src.length; i++) {
         if (src[i] === '{') depth++;
         else if (src[i] === '}') {
            depth--;
            if (depth === 0) return i;
         }
      }
      return -1;
   }

   function rewriteWgslExpr(s) {
      s = s.replace(/\bvec([234])<f32>\s*\(/g, 'vec$1(');
      s = s.replace(/\bvec([234])<i32>\s*\(/g, 'ivec$1(');
      s = s.replace(/\bvec([234])<u32>\s*\(/g, 'uvec$1(');
      s = s.replace(/\bmat([234])x\1<f32>\s*\(/g, 'mat$1(');
      s = s.replace(/\bmat4x4f\s*\(/g, 'mat4(');
      s = s.replace(/\bmat3x3f\s*\(/g, 'mat3(');
      s = s.replace(/\bmat2x2f\s*\(/g, 'mat2(');
      s = s.replace(/\bvec([234])f\s*\(/g, 'vec$1(');
      s = s.replace(/\bvec([234])i\s*\(/g, 'ivec$1(');
      s = s.replace(/\bvec([234])u\s*\(/g, 'uvec$1(');
      s = s.replace(/\bf32\s*\(/g, 'float(');
      s = s.replace(/\bi32\s*\(/g, 'int(');
      s = s.replace(/\bu32\s*\(/g, 'uint(');
      s = s.replace(/\bbool\s*\(/g, 'bool(');
      s = s.replace(/\b(\d+)i\b/g, '$1');
      s = s.replace(/\binverseSqrt\s*\(/g, 'inversesqrt(');
      s = s.replace(/\bdpdx\s*\(/g, 'dFdx(');
      s = s.replace(/\bdpdy\s*\(/g, 'dFdy(');
      s = s.replace(/\batan2\s*\(/g, 'atan(');
      s = s.replace(/\bworkgroupBarrier\s*\(\s*\)/g, '/*workgroupBarrier*/');
      s = s.replace(/\bstorageBarrier\s*\(\s*\)/g, '/*storageBarrier*/');
      s = s.replace(/\btextureBarrier\s*\(\s*\)/g, '/*textureBarrier*/');
      s = s.replace(/\s+as\s+f32\b/g, '');
      s = s.replace(/\s+as\s+i32\b/g, '');
      s = s.replace(/\s+as\s+u32\b/g, '');
      s = rewriteGenericCtor(s, 'bitcast', (inner, args) => emitBitcast(inner, args));
      s = rewriteGenericCtor(s, 'array', (inner, args) => {
         const parts = splitTopLevel(inner, ',');
         const n = (parts[parts.length - 1] || '1').trim();
         const elem = parts.slice(0, -1).join(',');
         return mapWgslType(elem.trim()) + '[' + n + '](' + args + ')';
      });
      s = rewriteNamedCalls(s, 'select', args => emitSelect(args[0] || '0.0', args[1] || '0.0', args[2] || 'false'));
      s = rewriteNamedCalls(s, 'saturate', args => 'clamp(' + (args[0] || '0.0') + ', 0.0, 1.0)');
      s = rewriteNamedCalls(s, 'textureDimensions', args => {
         const tex = args[0] || 'webgpu_missing_tex';
         const lod = args[1] !== undefined && args[1] !== '' ? 'int(' + args[1] + ')' : '0';
         return 'uvec2(textureSize(' + tex + ', ' + lod + '))';
      });
      s = rewriteNamedCalls(s, 'textureSampleCompareLevel', args => emitTextureCompare(args));
      s = rewriteNamedCalls(s, 'textureSampleCompare', args => emitTextureCompare(args));
      s = s.replace(/\btextureSample\s*\(\s*([A-Za-z_]\w*)\s*,\s*[A-Za-z_]\w*\s*,/g, 'texture($1,');
      s = s.replace(/\btextureSampleLevel\s*\(\s*([A-Za-z_]\w*)\s*,\s*[A-Za-z_]\w*\s*,/g, 'textureLod($1,');
      s = s.replace(/\btextureSampleGrad\s*\(\s*([A-Za-z_]\w*)\s*,\s*[A-Za-z_]\w*\s*,/g, 'textureGrad($1,');
      s = s.replace(/\btextureLoad\s*\(\s*([A-Za-z_]\w*)\s*,/g, 'texelFetch($1,');
      return s;
   }

   function unwrapParens(e) {
      e = (e || '').trim();
      while (e.length >= 2 && e[0] === '(') {
         const close = matchPair(e, 0, '(', ')');
         if (close !== e.length - 1) break;
         e = e.slice(1, -1).trim();
      }
      return e;
   }

   function widerGlType(a, b) {
      const rank = {
         bool: 1, int: 2, uint: 2, float: 3,
         bvec2: 4, ivec2: 5, uvec2: 5, vec2: 6,
         bvec3: 7, ivec3: 8, uvec3: 8, vec3: 9,
         bvec4: 10, ivec4: 11, uvec4: 11, vec4: 12,
         mat2: 13, mat3: 14, mat4: 15,
      };
      if (!a) return b;
      if (!b) return a;
      return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
   }

   function combineArithTypes(a, b) {
      if (!a) return b;
      if (!b) return a;
      if (/^mat/.test(a) && /^vec/.test(b)) return b;
      if (/^vec/.test(a) && /^mat/.test(b)) return a;
      return widerGlType(a, b);
   }

   function indexElemType(t) {
      t = String(t || '');
      const am = t.match(/^(.+)\[(\d+)\]$/);
      if (am) return am[1];
      if (t === 'vec2' || t === 'vec3' || t === 'vec4') return 'float';
      if (t === 'ivec2' || t === 'ivec3' || t === 'ivec4') return 'int';
      if (t === 'uvec2' || t === 'uvec3' || t === 'uvec4') return 'uint';
      if (t === 'bvec2' || t === 'bvec3' || t === 'bvec4') return 'bool';
      if (t === 'mat2') return 'vec2';
      if (t === 'mat3') return 'vec3';
      if (t === 'mat4') return 'vec4';
      return t;
   }

   function splitTopArith(e) {
      const terms = [];
      let cur = '', depth = 0;
      for (let i = 0; i < e.length; i++) {
         const ch = e[i];
         if (ch === '(' || ch === '[') depth++;
         else if (ch === ')' || ch === ']') depth--;
         const sci = (ch === '+' || ch === '-') && i > 0 && /[eE]/.test(e[i - 1]) && /[0-9.]/.test(e[i + 1] || '');
         if (depth === 0 && !sci && /[+\-*/]/.test(ch)) {
            const prev = cur.trim();
            if (prev) terms.push(prev);
            cur = '';
            continue;
         }
         cur += ch;
      }
      if (cur.trim()) terms.push(cur.trim());
      return terms;
   }

   function isVectorish(e, env) {
      e = unwrapParens(e);
      if (/^(?:[iub]?vec[234]|mat[234])\s*[\[(]/.test(e)) return true;
      const sw = e.match(/\.([xyzwrgba]{1,4})\s*$/);
      if (sw && /^[A-Za-z_]\w*\.[xyzwrgba]{1,4}$/.test(e)) return sw[1].length >= 2;
      if (/^(?:floatBitsToUint|floatBitsToInt|uintBitsToFloat|intBitsToFloat|equal|notEqual|lessThan|greaterThan|lessThanEqual|greaterThanEqual)\s*\(/.test(e)) return true;
      const types = env && env.types;
      const id = e.match(/^([A-Za-z_]\w*)$/);
      if (id && types && /^(?:[iub]?vec[234]|mat)/.test(types[id[1]] || '')) return true;
      const call = e.match(/^([A-Za-z_]\w*)\s*\(/);
      if (call && env && env.fnRets && /^(?:[iub]?vec[234]|mat)/.test(env.fnRets[call[1]] || '')) return true;
      return false;
   }

   function inferFieldType(e, env) {
      if (!env || !env.structs || !env.types) return null;
      if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(e)) return null;
      const parts = e.split('.');
      let ty = env.types[parts[0]];
      if (!ty) return null;
      for (let i = 1; i < parts.length; i++) {
         const part = parts[i];
         if (/^[xyzwrgba]{1,4}$/.test(part) && /^(?:[iub]?vec[234]|float)$/.test(ty)) {
            const n = part.length;
            if (ty[0] === 'i') return n === 1 ? 'int' : 'ivec' + n;
            if (ty[0] === 'u') return n === 1 ? 'uint' : 'uvec' + n;
            if (ty[0] === 'b') return n === 1 ? 'bool' : 'bvec' + n;
            return n === 1 ? 'float' : 'vec' + n;
         }
         const st = env.structs[ty];
         if (!st) return null;
         let field = null;
         for (let f = 0; f < st.fields.length; f++) {
            if (st.fields[f].name === part) { field = st.fields[f]; break; }
         }
         if (!field) return null;
         ty = mapWgslType(field.type);
      }
      return ty;
   }

   function takeLeftOperand(out) {
      let i = out.length - 1;
      while (i >= 0 && /\s/.test(out[i])) i--;
      const end = i + 1;
      let depth = 0;
      while (i >= 0) {
         const ch = out[i];
         if (ch === ')' || ch === ']') { depth++; i--; continue; }
         if (ch === '(' || ch === '[') {
            if (depth === 0) break;
            depth--;
            i--;
            continue;
         }
         if (depth === 0 && !/[A-Za-z0-9_.]/.test(ch)) break;
         i--;
      }
      let start = i + 1;
      let j = start - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      if (j >= 0 && /\w/.test(out[j])) {
         while (j >= 0 && /\w/.test(out[j])) j--;
         start = j + 1;
      }
      return { text: out.slice(start, end), start: start };
   }

   function takeRightOperand(s, i) {
      while (i < s.length && /\s/.test(s[i])) i++;
      const start = i;
      let depth = 0;
      while (i < s.length) {
         const ch = s[i];
         if (ch === '(' || ch === '[') { depth++; i++; continue; }
         if (ch === ')' || ch === ']') {
            if (depth === 0) break;
            depth--;
            i++;
            continue;
         }
         if (depth === 0) {
            if (s.startsWith('==', i) || s.startsWith('!=', i) || s.startsWith('<=', i) || s.startsWith('>=', i)) break;
            if (s.startsWith('<<', i) || s.startsWith('>>', i)) { i += 2; continue; }
            if (/[+\-*/,;?:|&^<>]/.test(ch)) break;
         }
         i++;
      }
      return { text: s.slice(start, i), end: i };
   }

   function rewriteVectorCompares(s, env) {
      const ops = [
         ['==', 'equal'], ['!=', 'notEqual'],
         ['<=', 'lessThanEqual'], ['>=', 'greaterThanEqual'],
         ['<', 'lessThan'], ['>', 'greaterThan'],
      ];
      let out = '';
      let i = 0;
      while (i < s.length) {
         if (s.startsWith('<<', i) || s.startsWith('>>', i)) {
            out += s.slice(i, i + 2);
            i += 2;
            continue;
         }
         let hit = null;
         for (let o = 0; o < ops.length; o++) {
            if (s.startsWith(ops[o][0], i)) { hit = ops[o]; break; }
         }
         if (!hit) { out += s[i++]; continue; }
         const left = takeLeftOperand(out);
         const right = takeRightOperand(s, i + hit[0].length);
         if (left.text && right.text && (isVectorish(left.text, env) || isVectorish(right.text, env))) {
            const fnCall = hit[1] + '(' + left.text.trim() + ', ' + right.text.trim() + ')';
            const before = out.slice(0, left.start).replace(/\s+$/, '');
            const asBool = /(?:\bif|\bwhile|\bfor)\s*\(\s*$/.test(before) || /(?:&&|\|\||!)\s*$/.test(before);
            out = out.slice(0, left.start) + (asBool ? 'all(' + fnCall + ')' : fnCall);
            i = right.end;
            continue;
         }
         out += hit[0];
         i += hit[0].length;
      }
      return out;
   }

   function coerceToType(expr, glType) {
      const e = String(expr || '').trim();
      if (glType === 'float' && /^-?\d+$/.test(e)) return e + '.0';
      if (glType === 'uint' && /^-?\d+$/.test(e)) return e + 'u';
      if ((glType === 'vec2' || glType === 'vec3' || glType === 'vec4') && /^-?\d+$/.test(e)) return glType + '(' + e + '.0)';
      return expr;
   }

   function inferExprType(rhs, env) {
      const e0 = unwrapParens(rhs);
      const types = env && env.types;
      if (/^-?\d+u$/.test(e0) || /^0x[0-9a-fA-F]+u$/.test(e0)) return 'uint';
      if (/^-?\d+$/.test(e0) || /^0x[0-9a-fA-F]+$/.test(e0)) return 'int';
      if (/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(e0)) return 'float';
      if (/^[-+][A-Za-z_(]/.test(e0)) return inferExprType(e0.slice(1), env);
      const fieldTy = inferFieldType(e0, env);
      if (fieldTy) return fieldTy;
      const terms = splitTopArith(e0);
      if (terms.length > 1) {
         let best = null;
         for (let t = 0; t < terms.length; t++) best = combineArithTypes(best, inferExprType(terms[t], env));
         return best;
      }
      const e = e0;
      const load = e.match(/^(\w+)_load\s*\(/);
      if (load && env && env.loaders && env.loaders[load[1]]) return env.loaders[load[1]];
      if (/\.model\b/.test(e) && /model\s*$/.test(e)) return 'mat4';
      const arrCtor = e.match(/^(vec[234]|ivec[234]|uvec[234]|float|int|uint|bool)\[\d+\]\s*\(/);
      if (arrCtor) return e.match(/^(vec[234]|ivec[234]|uvec[234]|float|int|uint|bool)\[\d+\]/)[0].replace(/\s+$/, '');
      const sw = e.match(/\.([xyzwrgba]{1,4})\s*$/);
      if (sw && !/floatBitsTo|uintBitsTo|intBitsTo/.test(e)) {
         const n = sw[1].length;
         return n === 1 ? 'float' : n === 2 ? 'vec2' : n === 3 ? 'vec3' : 'vec4';
      }
      const ctor = e.match(/^(vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|float|int|uint|bool)\s*\(/);
      if (ctor) return ctor[1];
      if (/[&|^]/.test(e) && !/&&|\|\|/.test(e)) {
         return inferExprType(e.split(/[&|^]/)[0].trim(), env) || 'uint';
      }
      if (/^(equal|notEqual|lessThan|greaterThan|lessThanEqual|greaterThanEqual)\s*\(/.test(e)) {
         const open = e.indexOf('(');
         const first = splitTopLevel(e.slice(open + 1, matchPair(e, open, '(', ')')), ',')[0];
         const lt = inferExprType((first || '').trim(), env);
         if (lt === 'vec2' || lt === 'uvec2' || lt === 'ivec2') return 'bvec2';
         if (lt === 'vec3' || lt === 'uvec3' || lt === 'ivec3') return 'bvec3';
         if (lt === 'vec4' || lt === 'uvec4' || lt === 'ivec4') return 'bvec4';
         return 'bool';
      }
      if (/(==|!=|<=|>=|<|>)/.test(e) && e.indexOf('?') < 0) {
         const left = e.split(/==|!=|<=|>=|<|>/)[0].trim();
         const lt = inferExprType(left, env);
         if (lt === 'vec2' || lt === 'uvec2' || lt === 'ivec2') return 'bvec2';
         if (lt === 'vec3' || lt === 'uvec3' || lt === 'ivec3') return 'bvec3';
         if (lt === 'vec4' || lt === 'uvec4' || lt === 'ivec4') return 'bvec4';
         return 'bool';
      }
      if (/^floatBitsToUint\s*\(/.test(e)) {
         const open = e.indexOf('(');
         const it = inferExprType(e.slice(open + 1, matchPair(e, open, '(', ')')), env);
         if (it === 'float') return 'uint';
         if (it === 'vec2') return 'uvec2';
         if (it === 'vec3') return 'uvec3';
         if (it === 'vec4') return 'uvec4';
         return 'uint';
      }
      if (/^floatBitsToInt\s*\(/.test(e)) {
         const open = e.indexOf('(');
         const it = inferExprType(e.slice(open + 1, matchPair(e, open, '(', ')')), env);
         if (it === 'float') return 'int';
         if (it === 'vec2') return 'ivec2';
         if (it === 'vec3') return 'ivec3';
         if (it === 'vec4') return 'ivec4';
         return 'int';
      }
      if (/^uintBitsToFloat\s*\(/.test(e) || /^intBitsToFloat\s*\(/.test(e)) {
         const open = e.indexOf('(');
         const it = inferExprType(e.slice(open + 1, matchPair(e, open, '(', ')')), env);
         if (it === 'uint' || it === 'int') return 'float';
         if (it === 'uvec2' || it === 'ivec2') return 'vec2';
         if (it === 'uvec3' || it === 'ivec3') return 'vec3';
         if (it === 'uvec4' || it === 'ivec4') return 'vec4';
         return 'float';
      }
      if (/^texelFetch\s*\(/.test(e) || /^texture\s*\(/.test(e) || /^textureLod\s*\(/.test(e) || /^textureGrad\s*\(/.test(e)) return 'vec4';
      const call = e.match(/^([A-Za-z_]\w*)\s*\(/);
      if (call && env && env.fnRets && env.fnRets[call[1]]) return env.fnRets[call[1]];
      const idxm = e.match(/^([A-Za-z_]\w*)\s*\[/);
      if (idxm && types && types[idxm[1]]) {
         return indexElemType(types[idxm[1]]);
      }
      const fieldIdx = e.match(/^((?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+))\s*\[/);
      if (fieldIdx) {
         const ft = inferFieldType(fieldIdx[1], env);
         if (ft) return indexElemType(ft);
      }
      const id = e.match(/^([A-Za-z_]\w*)$/);
      if (id && types && types[id[1]]) return types[id[1]];
      if (/^(distance|dot|length)\s*\(/.test(e))
         return 'float';
      if (/^mix\s*\(/.test(e)) {
         const open = e.indexOf('(');
         const close = matchPair(e, open, '(', ')');
         if (close > 0) {
            const args = splitTopLevel(e.slice(open + 1, close), ',');
            return widerGlType(inferExprType((args[0] || '').trim(), env), inferExprType((args[1] || '').trim(), env));
         }
      }
      if (/^(normalize|cross|reflect|refract|clamp|min|max|abs|floor|ceil|fract|sign|step|smoothstep|pow|sin|cos|tan|atan|asin|acos|log|exp|inversesqrt|sqrt|fwidth|dFdx|dFdy)\s*\(/.test(e)) {
         const open = e.indexOf('(');
         const close = matchPair(e, open, '(', ')');
         if (close > 0) {
            const first = splitTopLevel(e.slice(open + 1, close), ',')[0];
            const ft = inferExprType((first || '').trim(), env);
            if (ft) return ft;
         }
         return /^(normalize|cross|reflect|refract)\s*\(/.test(e) ? 'vec3' : 'float';
      }
      const firstId = e.match(/^([A-Za-z_]\w*)/);
      if (firstId && types && types[firstId[1]] && !/^\w+\s*\(/.test(e)) return types[firstId[1]];
      if (firstId && types && types[firstId[1]] && /^[A-Za-z_]\w*\s*[+\-*/]/.test(e)) return types[firstId[1]];
      return null;
   }

   function rewriteWgslBody(body, structs, io, env) {
      env = env || {};
      if (!env.types) env.types = {};
      let s = rewriteVectorCompares(rewriteWgslExpr(body), env);
      s = s.replace(/\[(\s*)([A-Za-z_]\w*)(\s*)\]/g, (m, a, name, b) => {
         const t = env.types && env.types[name];
         if (t === 'uint') return '[' + a + 'int(' + name + ')' + b + ']';
         return m;
      });
      if (env.scalarTex) {
         const wrapScalar = name => args => {
            const call = name + '(' + args.join(', ') + ')';
            return env.scalarTex[args[0]] ? call + '.r' : call;
         };
         s = rewriteNamedCalls(s, 'texelFetch', wrapScalar('texelFetch'));
         s = rewriteNamedCalls(s, 'textureLod', wrapScalar('textureLod'));
         s = rewriteNamedCalls(s, 'texture', wrapScalar('texture'));
      }
      const renames = [];
      s = s.replace(/\b(let|var|const)\s+(\w+)\s*:\s*([^=;\n]+)\s*=\s*([^;]+);/g, (_, k, name, typ, rhs) => {
         const gt = mapWgslType(typ.trim());
         const safe = safeGlslIdent(name);
         env.types[safe] = gt;
         if (safe !== name) renames.push([name, safe]);
         const prefix = k === 'const' ? 'const ' : '';
         return prefix + glslDecl(gt, safe) + ' = ' + coerceToType(rhs.trim(), gt) + ';';
      });
      s = s.replace(/\b(let|var|const)\s+(\w+)\s*:\s*([^=;\n]+)\s*;/g, (_, k, name, typ) => {
         const gt = mapWgslType(typ.trim());
         const safe = safeGlslIdent(name);
         env.types[safe] = gt;
         if (safe !== name) renames.push([name, safe]);
         const prefix = k === 'const' ? 'const ' : '';
         return prefix + glslDecl(gt, safe) + ';';
      });
      s = s.replace(/\b(let|var|const)\s+(\w+)\s*=\s*([^;]+);/g, (_, k, name, rhs) => {
         const inferred = inferExprType(rhs, env) || 'float';
         const safe = safeGlslIdent(name);
         env.types[safe] = inferred;
         if (safe !== name) renames.push([name, safe]);
         const prefix = k === 'const' ? 'const ' : '';
         return prefix + glslDecl(inferred, safe) + ' = ' + coerceToType(rhs.trim(), inferred) + ';';
      });
      for (let i = 0; i < renames.length; i++) {
         s = s.replace(new RegExp('\\b' + renames[i][0] + '\\b', 'g'), renames[i][1]);
      }
      s = rewriteVectorCompares(s, env);
      s = rewriteBvecTernaries(s, env);
      s = s.replace(/\b((?:const\s+)?float)\s+(\w+)\s*=\s*(-?\d+)\s*;/g, '$1 $2 = $3.0;');
      s = s.replace(/\bfor\s*\(\s*float\s+(\w+)\s*=\s*(-?\d+)\s*;/g, 'for (float $1 = $2.0;');
      s = s.replace(/\b([A-Za-z_]\w*)\s*=\s*\1\s*([+\-*/])\s*(-?\d+)(?![\d.eEuU])/g, (m, name, op, n) => {
         if ((env.types[name] || '') === 'float') return name + ' = ' + name + ' ' + op + ' ' + n + '.0';
         return m;
      });
      s = s.replace(/\b([A-Za-z_]\w*)\s*\+=\s*(-?\d+)(?![\d.eEuU])/g, (m, name, n) => {
         if ((env.types[name] || '') === 'float') return name + ' += ' + n + '.0';
         return m;
      });

      if (io && io.returnMode === 'position') {
         s = s.replace(/\breturn\s+([^;]+);/g, '{ vec4 webgpu_clip = $1; gl_Position = vec4(webgpu_clip.x, webgpu_clip.y * webgpu_flip_y, webgpu_clip.z * 2.0 - webgpu_clip.w, webgpu_clip.w); } return;');
      } else if (io && io.returnMode === 'frag') {
         s = s.replace(/\breturn\s+([^;]+);/g, io.fragOutName + ' = $1; return;');
      } else if (io && io.returnMode === 'struct' && io.returnStruct) {
         const st = structs[io.returnStruct];
         s = s.replace(/\breturn\s+([^;]+);/g, (_, expr) => {
            const tmp = 'webgpu_ret';
            const lines = [st.name + ' ' + tmp + ' = ' + expr.trim() + ';'];
            for (const f of st.fields) {
               if (f.builtin === 'position') {
                  lines.push('{ vec4 webgpu_clip = ' + tmp + '.' + f.name + '; gl_Position = vec4(webgpu_clip.x, webgpu_clip.y * webgpu_flip_y, webgpu_clip.z * 2.0 - webgpu_clip.w, webgpu_clip.w); }');
               } else if (f.location !== undefined) lines.push((f._outName || f.name) + ' = ' + tmp + '.' + f.name + ';');
            }
            lines.push('return;');
            return lines.join(' ');
         });
      }
      return s;
   }

   function splitTopLevel(src, sep) {
      const parts = [];
      let cur = '', depth = 0, angles = 0;
      for (let i = 0; i < src.length; i++) {
         const ch = src[i];
         if (ch === '(' || ch === '[' || ch === '{') depth++;
         else if (ch === ')' || ch === ']' || ch === '}') depth--;
         else if (ch === '<') angles++;
         else if (ch === '>') angles--;
         if (ch === sep && depth === 0 && angles === 0) {
            if (cur.trim()) parts.push(cur.trim());
            cur = '';
         } else cur += ch;
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
   }

   function alignUp(n, a) { return a ? Math.ceil(n / a) * a : n; }

   function typeSizeAlign(type, structs) {
      type = (type || '').replace(/\s+/g, '');
      const gl = mapWgslType(type);
      const scalars = {
         float: [4, 4], int: [4, 4], uint: [4, 4], bool: [4, 4],
         vec2: [8, 8], vec3: [12, 16], vec4: [16, 16],
         ivec2: [8, 8], ivec3: [12, 16], ivec4: [16, 16],
         uvec2: [8, 8], uvec3: [12, 16], uvec4: [16, 16],
         mat2: [32, 8], mat3: [48, 16], mat4: [64, 16],
      };
      if (scalars[gl]) return { size: scalars[gl][0], align: scalars[gl][1], gl };
      const arrN = type.match(/^array<(.+),(\d+)>$/);
      if (arrN) {
         const e = typeSizeAlign(arrN[1], structs);
         const stride = alignUp(e.size, e.align);
         const n = parseInt(arrN[2], 10);
         return { size: stride * n, align: e.align, gl, array: n, elem: e };
      }
      const arrU = type.match(/^array<(.+)>$/);
      if (arrU) {
         const e = typeSizeAlign(arrU[1], structs);
         return { size: alignUp(e.size, e.align), align: e.align, gl, runtime: true, elem: e };
      }
      if (structs[type]) {
         let off = 0, maxA = 4;
         const fields = [];
         for (const f of structs[type].fields) {
            const e = typeSizeAlign(f.type, structs);
            off = alignUp(off, e.align);
            fields.push(Object.assign({ name: f.name, offset: off }, e));
            off += e.size;
            maxA = Math.max(maxA, e.align);
         }
         return { size: alignUp(off, maxA), align: maxA, gl: type, struct: true, fields };
      }
      return { size: 16, align: 16, gl };
   }

   function rewriteIoFields(src, maps) {
      if (!maps || !maps.length) return src;
      let out = src;
      for (const m of maps) {
         out = out.replace(new RegExp('\\b' + m.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), m.to);
      }
      return out;
   }

   function replaceIndexed(src, name, replacer) {
      const token = name + '[';
      let out = '', i = 0;
      while (i < src.length) {
         if ((i === 0 || !/\w/.test(src[i - 1])) && src.startsWith(token, i)) {
            let d = 1, j = i + token.length;
            while (j < src.length && d) {
               if (src[j] === '[') d++;
               else if (src[j] === ']') d--;
               j++;
            }
            const idx = src.slice(i + token.length, j - 1);
            out += replacer(idx);
            i = j;
         } else {
            out += src[i++];
         }
      }
      return out;
   }

   function parseWgslStructs(src) {
      const structs = {};
      const re = /struct\s+(\w+)\s*\{/g;
      let m;
      while ((m = re.exec(src))) {
         const name = m[1];
         const open = src.indexOf('{', m.index);
         const close = matchBraces(src, open);
         const inner = src.slice(open + 1, close);
         const fields = [];
         splitTopLevel(inner, ',').forEach(part => {
            const am = part.match(/^((?:@\w+(?:\([^)]*\))?\s*)*)(\w+)\s*:\s*(.+)$/);
            if (!am) return;
            const attrs = parseAttrs(am[1]);
            fields.push({
               name: am[2],
               type: am[3].replace(/\s+/g, ''),
               location: attrs.location ? parseInt(attrs.location[0], 10) : undefined,
               builtin: attrs.builtin ? attrs.builtin[0] : undefined,
            });
         });
         structs[name] = { name, fields };
      }
      return structs;
   }

   function parseWgslBindings(src) {
      const bindings = [];
      const re = /((?:@\w+(?:\([^)]*\))?\s*)*)var\s*(?:<([^>]*)>)?\s+(\w+)\s*:\s*([^;]+);/g;
      let m;
      while ((m = re.exec(src))) {
         const attrs = parseAttrs(m[1]);
         if (attrs.group === undefined) continue;
         const addr = (m[2] || '').split(',').map(s => s.trim());
         bindings.push({
            group: parseInt(attrs.group[0], 10),
            binding: parseInt(attrs.binding[0], 10),
            name: m[3],
            type: m[4].replace(/\s+/g, ''),
            address: addr[0] || '',
            access: addr[1] || 'read',
         });
      }
      return bindings;
   }

   function parseWgslModuleConsts(src) {
      const consts = [];
      const isWord = (j, word) => src.startsWith(word, j) && (j === 0 || !/\w/.test(src[j - 1])) && !/\w/.test(src[j + word.length] || '');
      let i = 0;
      while (i < src.length) {
         if (src[i] === '@') {
            i++;
            while (i < src.length && /\w/.test(src[i])) i++;
            if (src[i] === '(') {
               const e = matchPair(src, i, '(', ')');
               i = e < 0 ? i + 1 : e + 1;
            }
            continue;
         }
         if (isWord(i, 'struct') || isWord(i, 'fn')) {
            const brace = src.indexOf('{', i);
            if (brace < 0) break;
            const close = matchBraces(src, brace);
            i = close < 0 ? src.length : close + 1;
            continue;
         }
         if (isWord(i, 'const') || isWord(i, 'override')) {
            const semi = src.indexOf(';', i);
            if (semi < 0) break;
            const stmt = src.slice(i, semi);
            const m = stmt.match(/^(?:const|override)\s+(\w+)(?:\s*:\s*([^=]+))?\s*=\s*([\s\S]+)$/);
            if (m) consts.push({ name: m[1], type: (m[2] || '').replace(/\s+/g, ''), value: m[3].trim() });
            i = semi + 1;
            continue;
         }
         i++;
      }
      return consts;
   }

   function parseWgslWorkgroupVars(src) {
      const vars = [];
      const re = /var\s*<workgroup>\s+(\w+)\s*:\s*([^;]+);/g;
      let m;
      while ((m = re.exec(src))) {
         vars.push({ name: m[1], type: m[2].replace(/\s+/g, '') });
      }
      return vars;
   }

   function parseWgslFns(src) {
      const fns = [];
      const re = /((?:@\w+(?:\([^)]*\))?\s*)*)fn\s+(\w+)\s*\(/g;
      let m;
      while ((m = re.exec(src))) {
         let i = m.index + m[0].length;
         let depth = 1, params = '';
         while (i < src.length && depth) {
            const ch = src[i++];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            if (depth) params += ch;
         }
         while (i < src.length && /\s/.test(src[i])) i++;
         let ret = '';
         if (src[i] === '-' && src[i + 1] === '>') {
            i += 2;
            const arrow = i;
            while (i < src.length && src[i] !== '{') i++;
            ret = src.slice(arrow, i).trim();
         }
         while (i < src.length && src[i] !== '{') i++;
         const close = matchBraces(src, i);
         fns.push({
            attrs: parseAttrs(m[1]),
            name: m[2],
            params,
            ret,
            body: close > i ? src.slice(i + 1, close) : '',
         });
         re.lastIndex = close > 0 ? close + 1 : i + 1;
      }
      return fns;
   }

   function parseParams(paramStr, structs) {
      const params = [];
      if (!paramStr.trim()) return params;
      // split on commas not inside <> or ()
      let cur = '', depth = 0;
      const parts = [];
      for (const ch of paramStr) {
         if (ch === '<' || ch === '(') depth++;
         if (ch === '>' || ch === ')') depth--;
         if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
         else cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      for (const part of parts) {
         const am = part.trim().match(/^((?:@\w+(?:\([^)]*\))?\s*)*)(\w+)\s*:\s*(.+)$/);
         if (!am) continue;
         const attrs = parseAttrs(am[1]);
         params.push({
            name: am[2],
            type: am[3].replace(/\s+/g, ''),
            location: attrs.location ? parseInt(attrs.location[0], 10) : undefined,
            builtin: attrs.builtin ? attrs.builtin[0] : undefined,
         });
      }
      return params;
   }

   function emitStructGlsl(st) {
      const lines = ['struct ' + st.name + ' {'];
      for (const f of st.fields) {
         lines.push('  ' + mapWgslType(f.type) + ' ' + f.name + ';');
      }
      lines.push('};');
      return lines.join('\n');
   }

   function compileWgsl(code, stage, entryPoint) {
      const src = stripWgslComments(code);
      const structs = parseWgslStructs(src);
      const bindings = parseWgslBindings(src);
      const fns = parseWgslFns(src);
      const fn = fns.find(f => f.name === entryPoint) ||
         fns.find(f => f.attrs[stage]) ||
         fns[0];
      VALIDATE(fn, 'WGSL entry point "' + entryPoint + '" not found.');

      let workgroupSize = [1, 1, 1];
      if (fn.attrs.workgroup_size) {
         workgroupSize = fn.attrs.workgroup_size.map(x => parseInt(x, 10) || 1);
         while (workgroupSize.length < 3) workgroupSize.push(1);
      }

      const params = parseParams(fn.params, structs);
      let retType = fn.ret.replace(/@\w+(?:\([^)]*\))?/g, '').trim();
      const retAttrs = parseAttrs((fn.ret.match(/(@\w+(?:\([^)]*\))?\s*)+/) || [''])[0]);

      const io = { varyings: [], inputs: [], outputs: [] };
      const header = [];
      header.push('#version 300 es');
      header.push('precision highp float;');
      header.push('precision highp int;');
      header.push('precision highp sampler2D;');
      header.push('precision highp isampler2D;');
      header.push('precision highp usampler2D;');
      header.push('precision highp samplerCube;');
      header.push('precision highp sampler3D;');
      header.push('precision highp sampler2DArray;');
      header.push('precision highp sampler2DShadow;');
      header.push('precision highp sampler2DArrayShadow;');
      header.push('precision highp samplerCubeShadow;');
      if (stage === 'vertex') {
         header.push('#define dFdx(x) ((x) * 0.0)');
         header.push('#define dFdy(x) ((x) * 0.0)');
         header.push('#define fwidth(x) ((x) * 0.0)');
         header.push('invariant gl_Position;');
         header.push('uniform uint webgpu_first_instance;');
         header.push('uniform float webgpu_flip_y;');
      }

      const moduleConsts = parseWgslModuleConsts(src);
      const workgroupVars = parseWgslWorkgroupVars(src);
      const emittedConst = {};
      for (let ci = 0; ci < moduleConsts.length; ci++) {
         const c = moduleConsts[ci];
         const val = rewriteWgslExpr(c.value);
         const gt = c.type ? mapWgslType(c.type) : (inferExprType(val, {}) || 'float');
         header.push('const ' + glslDecl(gt, c.name) + ' = ' + coerceToType(val, gt) + ';');
         emittedConst[c.name] = gt;
      }

      const usedStructs = {};
      const ioFieldMap = [];

      function considerType(t) {
         t = (t || '').replace(/\s+/g, '');
         if (structs[t]) usedStructs[t] = structs[t];
      }

      function mapIoField(from, to, glType) {
         ioFieldMap.push({ from: from, to: to, glType: glType });
      }

      for (const p of params) {
         considerType(p.type);
         if (p.builtin === 'position' && stage === 'fragment') {
            mapIoField(p.name, 'gl_FragCoord', 'vec4');
         } else if (p.builtin === 'vertex_index') {
            mapIoField(p.name, 'uint(gl_VertexID)', 'uint');
         } else if (p.builtin === 'instance_index') {
            mapIoField(p.name, '(uint(gl_InstanceID) + webgpu_first_instance)', 'uint');
         } else if (p.builtin === 'front_facing') {
            mapIoField(p.name, 'gl_FrontFacing', 'bool');
         } else if (p.builtin === 'global_invocation_id') {
            header.push('uniform uvec3 webgpu_global_invocation_base;');
            header.push('uniform uvec3 webgpu_workgroup_size;');
            header.push('uniform uvec3 webgpu_num_workgroups;');
            header.push('uniform uvec2 webgpu_storage_size;');
            header.push('uvec3 webgpu_invocation_id() {');
            header.push('  uint linear = uint(gl_FragCoord.x - 0.5) + uint(gl_FragCoord.y - 0.5) * webgpu_storage_size.x');
            header.push('    + webgpu_global_invocation_base.z * webgpu_storage_size.x * webgpu_storage_size.y;');
            header.push('  uint sx = max(1u, webgpu_num_workgroups.x * webgpu_workgroup_size.x);');
            header.push('  uint sy = max(1u, webgpu_num_workgroups.y * webgpu_workgroup_size.y);');
            header.push('  return uvec3(linear % sx, (linear / sx) % sy, linear / (sx * sy));');
            header.push('}');
            mapIoField(p.name, 'webgpu_invocation_id()', 'uvec3');
         } else if (p.builtin === 'local_invocation_id') {
            mapIoField(p.name, 'uvec3(0u)', 'uvec3');
         } else if (p.builtin === 'local_invocation_index') {
            mapIoField(p.name, '0u', 'uint');
         } else if (p.builtin === 'workgroup_id') {
            mapIoField(p.name, 'uvec3(0u)', 'uvec3');
         } else if (p.builtin === 'num_workgroups') {
            mapIoField(p.name, 'webgpu_num_workgroups', 'uvec3');
         } else if (p.location !== undefined) {
            if (stage === 'vertex') {
               header.push('layout(location = ' + p.location + ') in ' + mapWgslType(p.type) + ' ' + safeGlslIdent(p.name) + ';');
            } else {
               const vname = 'webgpu_loc' + p.location;
               header.push('in ' + mapWgslType(p.type) + ' ' + vname + ';');
               mapIoField(p.name, vname, mapWgslType(p.type));
            }
            io.inputs.push(p);
         } else if (structs[p.type]) {
            // Flatten stage-IO struct params. Never emit a GLSL ident named `in`.
            for (const f of structs[p.type].fields) {
               if (f.builtin === 'position' && stage === 'fragment') {
                  mapIoField(p.name + '.' + f.name, 'gl_FragCoord', 'vec4');
               } else if (f.location !== undefined) {
                  const vname = 'webgpu_loc' + f.location;
                  header.push((stage === 'vertex' ? 'layout(location = ' + f.location + ') in ' : 'in ') + mapWgslType(f.type) + ' ' + vname + ';');
                  mapIoField(p.name + '.' + f.name, vname, mapWgslType(f.type));
               }
            }
         }
      }

      const retStructName = retType;
      if (retAttrs.builtin && retAttrs.builtin[0] === 'position') {
         io.returnMode = 'position';
      } else if (retAttrs.location) {
         io.returnMode = 'frag';
         io.fragOutName = 'webgpu_frag_out_' + retAttrs.location[0];
         header.push('layout(location = ' + retAttrs.location[0] + ') out ' + mapWgslType(retType) + ' ' + io.fragOutName + ';');
      } else if (structs[retStructName]) {
         io.returnMode = 'struct';
         io.returnStruct = retStructName;
         usedStructs[retStructName] = structs[retStructName];
         for (const f of structs[retStructName].fields) {
            if (f.builtin === 'position') continue;
            if (f.location !== undefined) {
               if (stage === 'fragment') {
                  f._outName = 'webgpu_frag_out_' + f.location;
                  header.push('layout(location = ' + f.location + ') out ' + mapWgslType(f.type) + ' ' + f._outName + ';');
               } else {
                  f._outName = 'webgpu_loc' + f.location;
                  header.push('out ' + mapWgslType(f.type) + ' ' + f._outName + ';');
               }
            }
         }
      } else if (stage === 'fragment' && retType) {
         io.returnMode = 'frag';
         io.fragOutName = 'webgpu_frag_out_0';
         header.push('layout(location = 0) out ' + mapWgslType(retType) + ' ' + io.fragOutName + ';');
      } else if (stage === 'vertex' && retType) {
         io.returnMode = 'position';
      }

      for (const f of fns) {
         if (f.ret) considerType(f.ret.replace(/@\w+(?:\([^)]*\))?/g, '').trim());
         const pr = parseParams(f.params, structs);
         for (let pi = 0; pi < pr.length; pi++) considerType(pr[pi].type);
      }

      const storageMeta = [];
      for (const b of bindings) {
         const t = (b.type || '').replace(/\s+/g, '');
         if (b.address === 'storage') {
            const rawElem = arrayElemType(t).elem;
            if (structs[rawElem]) usedStructs[rawElem] = structs[rawElem];
         } else if (b.address === 'uniform' && structs[t]) {
            usedStructs[t] = structs[t];
         }
      }
      for (const name in usedStructs) {
         header.push(emitStructGlsl(usedStructs[name]));
      }

      const compareTex = {};
      src.replace(/\btextureSampleCompare(?:Level)?\s*\(\s*([A-Za-z_]\w*)/g, function (_, name) {
         compareTex[name] = 1;
         return _;
      });

      for (const b of bindings) {
         const uname = 'webgpu_g' + b.group + '_b' + b.binding;
         if (b.address === 'uniform') {
            const t = b.type.replace(/\s+/g, '');
            if (structs[t]) {
               usedStructs[t] = structs[t];
               header.push('layout(std140) uniform ' + uname + ' {');
               for (const f of structs[t].fields) {
                  header.push('  ' + mapWgslType(f.type) + ' ' + f.name + ';');
               }
               header.push('} ' + b.name + ';');
            } else {
               header.push('layout(std140) uniform ' + uname + ' {');
               header.push('  ' + mapWgslType(t) + ' _value;');
               header.push('} ' + b.name + '_block;');
               header.push('#define ' + b.name + ' ' + b.name + '_block._value');
            }
         } else if (b.address === 'storage') {
            const rawElem = arrayElemType(b.type).elem;
            const info = typeSizeAlign(rawElem, structs);
            if (structs[rawElem]) usedStructs[rawElem] = structs[rawElem];
            const isUint = info.gl === 'uint' || info.gl === 'uvec4';
            const isInt = info.gl === 'int' || info.gl === 'ivec4';
            const texelsPer = Math.max(1, Math.ceil(info.size / 16) || (isUint || isInt || info.gl === 'float' ? 1 : Math.ceil(info.size / 16)));
            const scalar = (info.gl === 'uint' || info.gl === 'int' || info.gl === 'float') && !info.struct;
            // Vertex texture fetches are unreliable on some GL drivers; feed the
            // VS from a std140 UBO instead. Fragment/compute keep the texture path.
            if (stage === 'vertex') {
               const elemStride = scalar ? 16 : Math.max(16, info.size);
               const maxItems = Math.max(1, Math.min(128, Math.floor(65008 / elemStride)));
               header.push('layout(std140) uniform ' + uname + ' {');
               header.push('  ' + info.gl + ' ' + b.name + '_items[' + maxItems + '];');
               header.push('};');
               header.push(info.gl + ' ' + b.name + '_load(uint i) {');
               header.push('  return ' + b.name + '_items[min(i, ' + (maxItems - 1) + 'u)];');
               header.push('}');
               storageMeta.push({
                  group: b.group, binding: b.binding, name: b.name, elem: info.gl,
                  access: b.access, uname, texelsPer: scalar ? 1 : texelsPer,
                  pack: isUint ? 'uint' : isInt ? 'int' : 'float4',
                  path: 'ubo', elemStride, maxItems, scalar, info,
               });
            } else {
            const samplerType = isUint ? 'usampler2D' : isInt ? 'isampler2D' : 'sampler2D';
            const fetchType = isUint ? 'uvec4' : isInt ? 'ivec4' : 'vec4';
            header.push('uniform ' + samplerType + ' ' + uname + '_in;');
            header.push('uniform uvec2 ' + uname + '_size;');
            header.push('ivec2 ' + b.name + '_coord(uint i) {');
            header.push('  ivec2 sz = textureSize(' + uname + '_in, 0);');
            header.push('  int w = max(max(sz.x, int(' + uname + '_size.x)), 1);');
            header.push('  return ivec2(int(i) % w, int(i) / w);');
            header.push('}');
            header.push(fetchType + ' ' + b.name + '_fetch(uint i) {');
            header.push('  ivec2 c = ' + b.name + '_coord(i);');
            header.push('  ivec2 sz = textureSize(' + uname + '_in, 0);');
            header.push('  int w = max(sz.x, 1);');
            header.push('  int h = max(sz.y, 1);');
            header.push('  vec2 uv = (vec2(c) + 0.5) / vec2(float(w), float(h));');
            header.push('  return textureLod(' + uname + '_in, uv, 0.0);');
            header.push('}');
            header.push(info.gl + ' ' + b.name + '_load(uint i) {');
            if (scalar) {
               header.push('  return ' + b.name + '_fetch(i).r;');
            } else if (info.gl === 'mat4') {
               header.push('  uint b = i * 4u;');
               header.push('  return mat4(' + b.name + '_fetch(b), ' + b.name + '_fetch(b+1u), ' + b.name + '_fetch(b+2u), ' + b.name + '_fetch(b+3u));');
            } else if (info.struct) {
               header.push('  uint b = i * ' + texelsPer + 'u;');
               header.push('  ' + info.gl + ' s;');
               for (const f of info.fields) {
                  const base = f.offset / 16;
                  if (f.gl === 'mat4') {
                     header.push('  s.' + f.name + ' = mat4(' + b.name + '_fetch(b+' + base + 'u), ' + b.name + '_fetch(b+' + (base+1) + 'u), ' + b.name + '_fetch(b+' + (base+2) + 'u), ' + b.name + '_fetch(b+' + (base+3) + 'u));');
                  } else if (f.array) {
                     for (let ai = 0; ai < f.array; ai++) {
                        header.push('  s.' + f.name + '[' + ai + '] = ' + b.name + '_fetch(b+' + (base + ai) + 'u);');
                     }
                  } else if (f.gl === 'float' || f.gl === 'uint' || f.gl === 'int') {
                     header.push('  s.' + f.name + ' = ' + b.name + '_fetch(b+' + Math.floor(f.offset / 16) + 'u).r;');
                  } else {
                     header.push('  s.' + f.name + ' = ' + b.name + '_fetch(b+' + Math.floor(f.offset / 16) + 'u)' + (f.gl === 'vec3' ? '.xyz' : f.gl === 'vec2' ? '.xy' : '') + ';');
                  }
               }
               header.push('  return s;');
            } else {
               header.push('  return ' + b.name + '_fetch(i);');
            }
            header.push('}');
            storageMeta.push({
               group: b.group, binding: b.binding, name: b.name, elem: info.gl,
               access: b.access, uname, texelsPer: scalar ? 1 : texelsPer,
               pack: isUint ? 'uint' : isInt ? 'int' : 'float4',
               path: 'tex', info,
            });
            }
         } else if (b.type.indexOf('texture_') === 0) {
            header.push('uniform ' + mapTextureUniform(b.type, compareTex[b.name]) + ' ' + b.name + ';');
         } else if (b.type === 'sampler' || b.type === 'sampler_comparison') {
            // Combined in WebGL: sampler object is bound beside the texture.
         } else {
            header.push('uniform ' + mapWgslType(b.type) + ' ' + b.name + ';');
         }
      }

      for (let wi = 0; wi < workgroupVars.length; wi++) {
         const w = workgroupVars[wi];
         header.push(glslDecl(mapWgslType(w.type), w.name) + ';');
      }

      if (stage === 'compute') {
         const outs = storageMeta.filter(s => s.access !== 'read');
         if (outs.length) {
            const o = outs[0];
            const outType = (o.elem === 'uint') ? 'uvec4' : (o.elem === 'int') ? 'ivec4' : 'vec4';
            header.push('layout(location = 0) out ' + outType + ' webgpu_storage_out;');
         } else {
            header.push('layout(location = 0) out vec4 webgpu_storage_out;');
         }
      }

      let body = rewriteIoFields(fn.body, ioFieldMap);
      for (const p of params) {
         const safe = safeGlslIdent(p.name);
         if (safe !== p.name) body = body.replace(new RegExp('\\b' + p.name + '\\b', 'g'), safe);
      }
      const loaders = {};
      storageMeta.forEach(sm => { loaders[sm.name] = sm.elem; });
      for (const sm of storageMeta) {
         body = replaceIndexed(body, sm.name, (idx) => sm.name + '_load(uint(' + idx + '))');
      }

      const scalarTex = {};
      for (const b of bindings) {
         if ((b.type || '').indexOf('texture_depth') === 0 && !compareTex[b.name]) scalarTex[b.name] = 1;
      }
      const fnRets = {};
      for (let fi = 0; fi < fns.length; fi++) {
         const r = fns[fi].ret ? mapWgslType(fns[fi].ret.replace(/@\w+(?:\([^)]*\))?/g, '').trim()) : '';
         if (r && r !== 'void') fnRets[fns[fi].name] = r;
      }

      function seedBindingTypes(types) {
         for (let bi = 0; bi < bindings.length; bi++) {
            const b = bindings[bi];
            const t = (b.type || '').replace(/\s+/g, '');
            if (structs[t]) types[b.name] = t;
            else types[b.name] = mapWgslType(t);
         }
         for (let wi = 0; wi < workgroupVars.length; wi++) {
            types[workgroupVars[wi].name] = mapWgslType(workgroupVars[wi].type);
         }
         for (let ii = 0; ii < ioFieldMap.length; ii++) {
            const m = ioFieldMap[ii];
            if (m.glType && /^[A-Za-z_]\w*$/.test(m.to)) types[m.to] = m.glType;
         }
         return types;
      }

      const otherFns = fns.filter(f => f !== fn && !f.attrs.vertex && !f.attrs.fragment && !f.attrs.compute);
      let extra = '';
      for (const ofn of otherFns) {
         const pr = parseParams(ofn.params);
         const args = pr.map(p => mapWgslType(p.type) + ' ' + safeGlslIdent(p.name)).join(', ');
         const ret = ofn.ret ? mapWgslType(ofn.ret.replace(/@\w+(?:\([^)]*\))?/g, '').trim()) : 'void';
         const env = { types: seedBindingTypes(Object.assign({}, emittedConst)), loaders, scalarTex, fnRets, structs };
         pr.forEach(p => { env.types[safeGlslIdent(p.name)] = mapWgslType(p.type); });
         let ob = ofn.body;
         for (const p of pr) {
            if (safeGlslIdent(p.name) !== p.name) {
               ob = ob.replace(new RegExp('\\b' + p.name + '\\b', 'g'), safeGlslIdent(p.name));
            }
         }
         for (const sm of storageMeta) {
            ob = replaceIndexed(ob, sm.name, (idx) => sm.name + '_load(uint(' + idx + '))');
         }
         extra += ret + ' ' + ofn.name + '(' + args + ') {\n' + rewriteWgslBody(ob, structs, null, env) + '\n}\n';
      }

      const env = { types: seedBindingTypes(Object.assign({}, emittedConst)), loaders, scalarTex, fnRets, structs };
      params.forEach(p => { env.types[safeGlslIdent(p.name)] = mapWgslType(p.type); });
      body = rewriteWgslBody(body, structs, io, env);

      if (stage === 'compute') {
         const sm = storageMeta.find(s => s.access !== 'read');
         if (sm) {
            const token = sm.name + '_load(';
            let nb = '', i = 0;
            while (i < body.length) {
               if ((i === 0 || !/\w/.test(body[i - 1])) && body.startsWith(token, i)) {
                  let d = 1, j = i + token.length;
                  while (j < body.length && d) {
                     if (body[j] === '(') d++;
                     else if (body[j] === ')') d--;
                     j++;
                  }
                  const idx = body.slice(i + token.length, j - 1);
                  let k = j;
                  while (k < body.length && /\s/.test(body[k])) k++;
                  if (body[k] === '=') {
                     k++;
                     while (k < body.length && /\s/.test(body[k])) k++;
                     const start = k;
                     while (k < body.length && body[k] !== ';') k++;
                     const expr = body.slice(start, k);
                     const pack = (sm.elem === 'uint') ? 'uvec4(' + expr + ', 0u, 0u, 1u)' :
                        (sm.elem === 'int') ? 'ivec4(' + expr + ', 0, 0, 1)' :
                        'vec4(' + expr + ', 0.0, 0.0, 1.0)';
                     nb += 'if (int(' + idx + ') == int(gl_FragCoord.x - 0.5) + int(gl_FragCoord.y - 0.5) * int(' + sm.uname + '_size.x)) { webgpu_storage_out = ' + pack + '; }';
                     i = k + 1;
                     continue;
                  }
               }
               nb += body[i++];
            }
            body = nb;
         }
      }

      if (/\bPI\b/.test(extra + body) && !emittedConst.PI) {
         header.push('const float PI = 3.141592653589793;');
         emittedConst.PI = 'float';
      }

      header.push(extra);
      header.push('void main() {');
      header.push(body);
      header.push('}');

      return {
         glsl: header.join('\n'),
         bindings,
         storageMeta,
         workgroupSize,
         stage,
         entryPoint: fn.name,
      };
   }

   // ---------------------------------------------------------------------------
   // GPU objects
   // ---------------------------------------------------------------------------

   class GPUSupportedFeatures {
      constructor(list) {
         this._set = new Set(list);
      }
      has(f) { return this._set.has(f); }
      keys() { return this._set.values(); }
      values() { return this._set.values(); }
      entries() { return this._set.entries(); }
      forEach(fn, thisArg) { this._set.forEach(fn, thisArg); }
      get size() { return this._set.size; }
      [Symbol.iterator]() { return this._set[Symbol.iterator](); }
   }

   class GPUBuffer {
      constructor(device, desc) {
         this.device = device;
         this.desc = {
            size: desc.size | 0,
            usage: desc.usage | 0,
            mappedAtCreation: !!desc.mappedAtCreation,
            label: desc.label || '',
         };
         VALIDATE(this.desc.size >= 0, 'GPUBufferDescriptor.size must be >= 0.');
         VALIDATE(this.desc.usage, 'GPUBufferDescriptor.usage required.');
         const maxBuf = (device.limits && device.limits.maxBufferSize) || (256 * 1024 * 1024);
         if (this.desc.size > maxBuf) {
            throw new PolyfillOOMError('GPUBuffer size ' + this.desc.size + ' exceeds device limit ' + maxBuf);
         }
         this.label = this.desc.label;
         this._mapState = 'unmapped';
         this._mapRange = null;
         this._mapOffset = 0;
         this._mapSize = 0;
         try {
            this._cpu = new ArrayBuffer(this.desc.size);
         } catch (e) {
            throw new PolyfillOOMError('Failed to allocate GPUBuffer of size ' + this.desc.size);
         }
         this._cpuU8 = new Uint8Array(this._cpu);
         this._gl = null;
         this._destroyed = false;
         this._cpuGen = 1;

         if (this.desc.mappedAtCreation) {
            this._mapState = 'mapped';
            this._mapOffset = 0;
            this._mapSize = this.desc.size;
            this._mapRange = this._cpu;
         }
      }

      get size() { return this.desc.size; }
      get usage() { return this.desc.usage; }
      get mapState() { return this._mapState; }

      _ensureGl() {
         if (this._gl || this._destroyed) return this._gl;
         const gl = this.device.gl;
         this._gl = gl.createBuffer();
         if (this.desc.usage & GPUBufferUsage.UNIFORM) this._target = GL.UNIFORM_BUFFER;
         else if (this.desc.usage & GPUBufferUsage.INDEX) this._target = GL.ELEMENT_ARRAY_BUFFER;
         else this._target = GL.ARRAY_BUFFER;
         gl.bindBuffer(this._target, this._gl);
         let err = gl.getError();
         gl.bufferData(this._target, this.desc.size, GL.DYNAMIC_DRAW);
         err = gl.getError();
         if (err === GL.OUT_OF_MEMORY) {
            while (gl.getError()) {}
               throw new PolyfillOOMError('bufferData OUT_OF_MEMORY');
         }
         if (this._mapState !== 'mapped') {
            gl.bufferSubData(this._target, 0, this._cpuU8);
         }
         gl.bindBuffer(this._target, null);
         return this._gl;
      }

      _flushToGl() {
         const gl = this.device.gl;
         this._cpuGen = (this._cpuGen || 0) + 1;
         this._ensureGl();
         gl.bindBuffer(this._target, this._gl);
         gl.bufferSubData(this._target, 0, this._cpuU8);
         gl.bindBuffer(this._target, null);
      }

      _pullFromGl() {
         const gl = this.device.gl;
         if (!this._gl) return;
         gl.bindBuffer(this._target, this._gl);
         gl.getBufferSubData(this._target, 0, this._cpuU8);
         gl.bindBuffer(this._target, null);
      }

      _ensureStorageTex(pack) {
         const gl = this.device.gl;
         this._storageTex = this._storageTex || {};
         let rec = this._storageTex[pack];
         if (!rec) {
            rec = { id: gl.createTexture(), w: 1, h: 1, gen: -1 };
            this._storageTex[pack] = rec;
         }
         const gen = this._cpuGen || 0;
         if (rec.gen === gen && rec.uploaded) {
            gl.bindTexture(GL.TEXTURE_2D, rec.id);
            return rec;
         }
         gl.bindTexture(GL.TEXTURE_2D, rec.id);
         gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
         gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
         gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
         gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
         rec.gen = gen;
         rec.uploaded = true;
         if (pack === 'uint' || pack === 'int') {
            const count = Math.max(1, Math.ceil(this.desc.size / 4));
            rec.w = Math.min(4096, count);
            rec.h = Math.ceil(count / rec.w);
            const pixels = new Uint32Array(rec.w * rec.h);
            pixels.set(new Uint32Array(this._cpu, 0, Math.min(count, pixels.length)));
            gl.texImage2D(GL.TEXTURE_2D, 0, pack === 'uint' ? GL.R32UI : GL.R32I, rec.w, rec.h, 0,
               GL.RED_INTEGER, pack === 'uint' ? GL.UNSIGNED_INT : GL.INT, pixels);
         } else {
            const count = Math.max(1, Math.ceil(this.desc.size / 16));
            rec.w = Math.min(4096, count);
            rec.h = Math.ceil(count / rec.w);
            const pixels = new Float32Array(rec.w * rec.h * 4);
            const src = new Float32Array(this._cpu, 0, Math.min((this.desc.size / 4) | 0, pixels.length));
            pixels.set(src);
            gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA32F, rec.w, rec.h, 0, GL.RGBA, GL.FLOAT, pixels);
         }
         return rec;
      }

      _ensureStorageUbo(meta) {
         const gl = this.device.gl;
         const stride = meta.elemStride || 16;
         const n = meta.maxItems || 1;
         const bytes = n * stride;
         this._storageUbo = this._storageUbo || {};
         let rec = this._storageUbo[meta.uname] || this._storageUbo._default;
         if (!rec) {
            rec = { id: gl.createBuffer(), size: 0, gen: -1 };
            this._storageUbo[meta.uname] = rec;
         }
         const gen = this._cpuGen || 0;
         if (rec.gen === gen && rec.size === bytes) return rec;
         const packed = new Uint8Array(bytes);
         if (meta.scalar) {
            const src = new Uint32Array(this._cpu);
            const dst = new Uint32Array(packed.buffer);
            const count = Math.min(n, src.length);
            for (let i = 0; i < count; i++) dst[i * 4] = src[i];
         } else {
            packed.set(this._cpuU8.subarray(0, Math.min(this._cpuU8.length, bytes)));
         }
         gl.bindBuffer(GL.UNIFORM_BUFFER, rec.id);
         if (rec.size !== bytes) {
            gl.bufferData(GL.UNIFORM_BUFFER, packed, GL.DYNAMIC_DRAW);
            rec.size = bytes;
         } else {
            gl.bufferSubData(GL.UNIFORM_BUFFER, 0, packed);
         }
         gl.bindBuffer(GL.UNIFORM_BUFFER, null);
         rec.gen = gen;
         return rec;
      }

      mapAsync(mode, offset, size) {
         try {
            VALIDATE(!this._destroyed, 'Buffer is destroyed.');
            VALIDATE(this._mapState === 'unmapped', 'Buffer is already mapped.');
            offset = offset || 0;
            size = size === undefined ? this.desc.size - offset : size;
            if (mode & GPUMapMode.READ) {
               VALIDATE(this.desc.usage & GPUBufferUsage.MAP_READ, 'Missing GPUBufferUsage.MAP_READ.');
            }
            if (mode & GPUMapMode.WRITE) {
               VALIDATE(this.desc.usage & GPUBufferUsage.MAP_WRITE, 'Missing GPUBufferUsage.MAP_WRITE.');
            }
            this._mapState = 'pending';
            return this.device._afterSubmitted().then(() => {
               if (mode & GPUMapMode.READ) this._pullFromGl();
               this._mapState = 'mapped';
               this._mapOffset = offset;
               this._mapSize = size;
               this._mapRange = this._cpu;
               return undefined;
            });
         } catch (e) {
            this.device._catch(e);
            return Promise.reject(e);
         }
      }

      getMappedRange(offset, size) {
         VALIDATE(this._mapState === 'mapped', 'Buffer must be mapped.');
         return this._cpu;
      }

      unmap() {
         try {
            VALIDATE(!this._destroyed, 'Buffer is destroyed.');
            VALIDATE(this._mapState === 'mapped', 'Buffer is not mapped.');
            if (this.device._gl) this._flushToGl();
            this._mapState = 'unmapped';
            this._mapRange = null;
         } catch (e) { this.device._catch(e); }
      }

      destroy() {
         this._destroyed = true;
         if (this._gl && this.device._gl) {
            this.device._gl.deleteBuffer(this._gl);
            this._gl = null;
         }
      }
   }

   class GPUSampler {
      constructor(device, desc) {
         this.device = device;
         desc = Object.assign({
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            lodMinClamp: 0,
            lodMaxClamp: 32,
            compare: undefined,
            maxAnisotropy: 1,
            label: '',
         }, desc || {});
         this.desc = desc;
         this.label = desc.label;
         const gl = device.gl;
         this._gl = gl.createSampler();
         gl.samplerParameteri(this._gl, GL.TEXTURE_WRAP_S, WRAP_MODE[desc.addressModeU]);
         gl.samplerParameteri(this._gl, GL.TEXTURE_WRAP_T, WRAP_MODE[desc.addressModeV]);
         gl.samplerParameteri(this._gl, GL.TEXTURE_WRAP_R, WRAP_MODE[desc.addressModeW]);
         gl.samplerParameteri(this._gl, GL.TEXTURE_MAG_FILTER, FILTER_MODE[desc.magFilter] || GL.NEAREST);
         const minKey = (desc.minFilter === 'linear' ? 'LINEAR' : 'NEAREST') + '_MIPMAP_' +
            (desc.mipmapFilter === 'linear' ? 'LINEAR' : 'NEAREST');
         gl.samplerParameteri(this._gl, GL.TEXTURE_MIN_FILTER, GL[minKey]);
         gl.samplerParameterf(this._gl, GL.TEXTURE_MIN_LOD, desc.lodMinClamp);
         gl.samplerParameterf(this._gl, GL.TEXTURE_MAX_LOD, desc.lodMaxClamp);
         if (desc.compare) {
            gl.samplerParameteri(this._gl, GL.TEXTURE_COMPARE_FUNC, COMPARE_FUNC[desc.compare]);
            gl.samplerParameteri(this._gl, GL.TEXTURE_COMPARE_MODE, GL.COMPARE_REF_TO_TEXTURE);
            // Shadow maps are a single mip. LINEAR_MIPMAP_* makes the
            // texture incomplete, so compare always returns 0 and volume
            // light has no occlusion (haze everywhere, no arch shafts).
            gl.samplerParameteri(this._gl, GL.TEXTURE_MIN_FILTER, FILTER_MODE[desc.minFilter] || GL.LINEAR);
            gl.samplerParameteri(this._gl, GL.TEXTURE_MAG_FILTER, FILTER_MODE[desc.magFilter] || GL.LINEAR);
            gl.samplerParameterf(this._gl, GL.TEXTURE_MIN_LOD, 0);
            gl.samplerParameterf(this._gl, GL.TEXTURE_MAX_LOD, 0);
         }
         applyAniso(gl, this._gl, desc.maxAnisotropy || 1);
      }
   }

   class GPUTextureView {
      constructor(tex, desc) {
         this.texture = tex;
         this.tex = tex;
         const d = tex.desc;
         this.desc = Object.assign({
            format: d.format,
            dimension: d.dimension === '3d' ? '3d' : (d.dimension === '1d' ? '1d' : '2d'),
            aspect: 'all',
            baseMipLevel: 0,
            mipLevelCount: d.mipLevelCount,
            baseArrayLayer: 0,
            arrayLayerCount: d.size.depthOrArrayLayers,
         }, desc || {});
         this._depth = !!(TEX_FORMAT_INFO[d.format] && TEX_FORMAT_INFO[d.format].depth);
         this._stencil = !!(TEX_FORMAT_INFO[d.format] && TEX_FORMAT_INFO[d.format].stencil);
      }

      _bindTexture() {
         const gl = this.tex.device.gl;
         const obj = this.tex._ensureGl();
         this.tex._ensureMips();
         gl.bindTexture(obj.target, obj);
      }

      _attach(fbTarget, attachment) {
         const gl = this.tex.device.gl;
         const obj = this.tex._ensureGl();
         if (obj.target === GL.RENDERBUFFER) {
            gl.framebufferRenderbuffer(fbTarget, attachment, GL.RENDERBUFFER, obj);
         } else if (obj.target === GL.TEXTURE_2D) {
            gl.framebufferTexture2D(fbTarget, attachment, GL.TEXTURE_2D, obj, this.desc.baseMipLevel);
         } else if (obj.target === GL.TEXTURE_CUBE_MAP) {
            gl.framebufferTexture2D(fbTarget, attachment, GL.TEXTURE_CUBE_MAP_POSITIVE_X + this.desc.baseArrayLayer, obj, this.desc.baseMipLevel);
         } else {
            gl.framebufferTextureLayer(fbTarget, attachment, obj, this.desc.baseMipLevel, this.desc.baseArrayLayer);
         }
      }
   }

   class GPUTexture {
      constructor(device, desc, swapchain) {
         this.device = device;
         const size = asExtent3D(desc.size);
         this.desc = {
            size,
            format: desc.format,
            usage: desc.usage,
            dimension: desc.dimension || '2d',
            mipLevelCount: desc.mipLevelCount || 1,
            sampleCount: desc.sampleCount || 1,
            label: desc.label || '',
         };
         this.label = this.desc.label;
         this._swapchain = swapchain || null;
         this._gl = null;
         VALIDATE(TEX_FORMAT_INFO[this.desc.format], 'Unsupported texture format ' + this.desc.format);
         if (!this._swapchain) this._ensureGl();
      }

      get width() { return this.desc.size.width; }
      get height() { return this.desc.size.height; }
      get depthOrArrayLayers() { return this.desc.size.depthOrArrayLayers; }
      get format() { return this.desc.format; }
      get usage() { return this.desc.usage; }
      get mipLevelCount() { return this.desc.mipLevelCount; }
      get sampleCount() { return this.desc.sampleCount; }
      get dimension() { return this.desc.dimension; }

      _ensureGl() {
         if (this._gl) return this._gl;
         const gl = this.device.gl;
         const d = this.desc;
         const info = TEX_FORMAT_INFO[d.format];
         if (info.depth || info.stencil) {
            const sampled = (d.usage & GPUTextureUsage.TEXTURE_BINDING) && d.sampleCount === 1;
            if (!sampled) {
               this._gl = gl.createRenderbuffer();
               this._gl.target = GL.RENDERBUFFER;
               gl.bindRenderbuffer(GL.RENDERBUFFER, this._gl);
               if (d.sampleCount !== 1) {
                  gl.renderbufferStorageMultisample(GL.RENDERBUFFER, d.sampleCount, info.format, d.size.width, d.size.height);
               } else {
                  gl.renderbufferStorage(GL.RENDERBUFFER, info.format, d.size.width, d.size.height);
               }
               return this._gl;
            }
         }
         if (d.sampleCount !== 1) {
            this._gl = gl.createRenderbuffer();
            this._gl.target = GL.RENDERBUFFER;
            gl.bindRenderbuffer(GL.RENDERBUFFER, this._gl);
            gl.renderbufferStorageMultisample(GL.RENDERBUFFER, d.sampleCount, info.format, d.size.width, d.size.height);
            return this._gl;
         }
         this._gl = gl.createTexture();
         let target = GL.TEXTURE_2D;
         if (d.dimension === '3d') target = GL.TEXTURE_3D;
         else if (d.size.depthOrArrayLayers === 6 && (d.usage & GPUTextureUsage.TEXTURE_BINDING)) target = GL.TEXTURE_CUBE_MAP;
         else if (d.size.depthOrArrayLayers > 1) target = GL.TEXTURE_2D_ARRAY;
         this._gl.target = target;
         gl.bindTexture(target, this._gl);
         gl.texParameteri(target, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
         gl.texParameteri(target, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
         gl.texParameteri(target, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
         gl.texParameteri(target, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
         gl.texParameteri(target, GL.TEXTURE_BASE_LEVEL, 0);
         gl.texParameteri(target, GL.TEXTURE_MAX_LEVEL, Math.max(0, (d.mipLevelCount || 1) - 1));
         if (target === GL.TEXTURE_3D) {
            gl.texStorage3D(target, d.mipLevelCount, info.format, d.size.width, d.size.height, d.size.depthOrArrayLayers);
         } else if (target === GL.TEXTURE_2D_ARRAY) {
            gl.texStorage3D(target, d.mipLevelCount, info.format, d.size.width, d.size.height, d.size.depthOrArrayLayers);
         } else {
            gl.texStorage2D(target, d.mipLevelCount, info.format, d.size.width, d.size.height);
         }
         gl.bindTexture(target, null);
         return this._gl;
      }

      _ensureMips() {}

      createView(desc) {
         return new GPUTextureView(this, desc);
      }

      destroy() {
         if (this._gl && this.device._gl) {
            if (this._gl.target === GL.RENDERBUFFER) this.device._gl.deleteRenderbuffer(this._gl);
            else this.device._gl.deleteTexture(this._gl);
            this._gl = null;
         }
      }
   }

   class GPUBindGroupLayout {
      constructor(device, desc) {
         this.device = device;
         const entries = desc.entries || desc.bindings || [];
         this.desc = { entries: entries.map((e, i) => normalizeBGLEntry(e, i)), label: desc.label || '' };
         this.label = this.desc.label;
         this._byBinding = {};
         for (const e of this.desc.entries) this._byBinding[e.binding] = e;
      }
   }

   function normalizeBGLEntry(e) {
      const out = { binding: e.binding, visibility: e.visibility };
      if (e.buffer || e.type === 'uniform-buffer' || e.type === 'storage-buffer' || e.type === 'readonly-storage-buffer') {
         const b = e.buffer || {};
         out.kind = 'buffer';
         out.buffer = {
            type: b.type || (e.type === 'storage-buffer' ? 'storage' : e.type === 'readonly-storage-buffer' ? 'read-only-storage' : 'uniform'),
            hasDynamicOffset: !!(b.hasDynamicOffset || e.dynamic),
            minBindingSize: b.minBindingSize || 0,
         };
      } else if (e.sampler || e.type === 'sampler') {
         out.kind = 'sampler';
         out.sampler = e.sampler || { type: 'filtering' };
      } else if (e.texture || e.type === 'sampled-texture') {
         out.kind = 'texture';
         out.texture = Object.assign({ sampleType: 'float', viewDimension: e.textureDimension || '2d', multisampled: !!e.multisample }, e.texture || {});
      } else if (e.storageTexture || e.type === 'storage-texture') {
         out.kind = 'storageTexture';
         out.storageTexture = e.storageTexture || {};
      } else {
         VALIDATE(false, 'Unknown bind group layout entry.');
      }
      return out;
   }

   class GPUPipelineLayout {
      constructor(device, desc) {
         this.device = device;
         this.desc = { bindGroupLayouts: (desc.bindGroupLayouts || []).slice(), label: desc.label || '' };
         this.label = this.desc.label;
         // Offsets live on the pipeline layout, not the shared bind-group layout.
         // Using max(binding)+1 keeps holes from colliding across groups.
         this._bindingOffsets = [];
         let off = 0;
         for (const l of this.desc.bindGroupLayouts) {
            this._bindingOffsets.push(off);
            let span = l.desc.entries.length;
            for (const e of l.desc.entries) span = Math.max(span, (e.binding || 0) + 1);
            off += span;
         }
      }
      bindingSlot(group, binding) {
         return (this._bindingOffsets[group] || 0) + binding;
      }
   }

   class GPUBindGroup {
      constructor(device, desc) {
         this.device = device;
         VALIDATE(desc.layout instanceof GPUBindGroupLayout, 'GPUBindGroupDescriptor.layout required.');
         const entries = desc.entries || desc.bindings || [];
         this.desc = { layout: desc.layout, entries: entries.map(normalizeBGEntry), label: desc.label || '' };
         this.label = this.desc.label;
         for (const e of this.desc.entries) {
            const layout = desc.layout._byBinding[e.binding];
            VALIDATE(layout, 'Binding ' + e.binding + ' not in layout.');
            e._layout = layout;
         }
      }
   }

   function normalizeBGEntry(e) {
      const r = e.resource;
      const out = { binding: e.binding };
      if (r instanceof GPUSampler) out.sampler = r;
      else if (r instanceof GPUTextureView) out.textureView = r;
      else if (r && r.buffer) out.buffer = { buffer: r.buffer, offset: r.offset || 0, size: r.size };
      else VALIDATE(false, 'Invalid GPUBindingResource.');
      return out;
   }

   class GPUShaderModule {
      constructor(device, desc) {
         this.device = device;
         VALIDATE(desc && typeof desc.code === 'string', 'GPUShaderModuleDescriptor.code required.');
         this.desc = { code: desc.code, label: desc.label || '' };
         this.label = this.desc.label;
         this._code = desc.code;
      }

      compile(stage, entryPoint) {
         const key = stage + ':' + entryPoint;
         this._cache = this._cache || {};
         if (!this._cache[key]) this._cache[key] = compileWgsl(this._code, stage, entryPoint);
         return this._cache[key];
      }

      getCompilationInfo() {
         return Promise.resolve({ messages: [] });
      }
   }

   function compileGlProgram(gl, vsSrc, fsSrc) {
      const prog = gl.createProgram();
      function compile(type, src) {
         const s = gl.createShader(type);
         gl.shaderSource(s, src);
         gl.compileShader(s);
         if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(s);
            const kind = type === gl.VERTEX_SHADER ? 'VS' : 'FS';
            if (typeof global !== 'undefined') {
               global.__webgpuLastShaderError = { kind: kind, log: log, src: src };
            }
            console.error(kind + ' compile error: ' + log + '\n' + src);
            throw new Error('Shader compile failed: ' + log);
         }
         gl.attachShader(prog, s);
         return s;
      }
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      gl.linkProgram(prog);
      const ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
      if (!ok) {
         const log = gl.getProgramInfoLog(prog);
         console.error('Program link error:\n', log);
         throw new global.GPUValidationError('Program link failed: ' + log);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return prog;
   }

   function autoLayoutFromBindings(device, bindingLists) {
      const groups = [];
      const merged = {};
      for (const list of bindingLists) {
         for (const b of list) {
            const k = b.group + ':' + b.binding;
            merged[k] = b;
         }
      }
      const byGroup = {};
      for (const k in merged) {
         const b = merged[k];
         (byGroup[b.group] = byGroup[b.group] || []).push(b);
      }
      const maxG = Math.max(-1, ...Object.keys(byGroup).map(Number));
      for (let g = 0; g <= maxG; g++) {
         const list = (byGroup[g] || []).sort((a, b) => a.binding - b.binding);
         const entries = list.filter(b => b.type !== 'sampler' && b.type !== 'sampler_comparison').map(b => {
            if (b.address === 'uniform') {
               return { binding: b.binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } };
            }
            if (b.address === 'storage') {
               return { binding: b.binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: b.access === 'read' ? 'read-only-storage' : 'storage' } };
            }
            if (b.type.indexOf('texture_') === 0) {
               return { binding: b.binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } };
            }
            return { binding: b.binding, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } };
         });
         // include samplers
         for (const b of list) {
            if (b.type === 'sampler' || b.type === 'sampler_comparison') {
               entries.push({ binding: b.binding, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } });
            }
         }
         groups[g] = new GPUBindGroupLayout(device, { entries });
      }
      return new GPUPipelineLayout(device, { bindGroupLayouts: groups });
   }

   class GPURenderPipeline {
      constructor(device, desc) {
         this.device = device;
         VALIDATE(desc.vertex && desc.vertex.module, 'GPURenderPipelineDescriptor.vertex.module required.');
         const vEntry = desc.vertex.entryPoint || 'main';
         const fEntry = desc.fragment ? (desc.fragment.entryPoint || 'main') : 'main';
         const vs = desc.vertex.module.compile('vertex', vEntry);
         const fs = desc.fragment ? desc.fragment.module.compile('fragment', fEntry) : null;

         let layout = desc.layout;
         if (!layout || layout === 'auto') {
            layout = autoLayoutFromBindings(device, [vs.bindings, fs ? fs.bindings : []]);
         }
         this.layout = layout;
         this.desc = desc;
         this._vs = vs;
         this._fs = fs;

         const primitive = Object.assign({ topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none' }, desc.primitive || {});
         this.primitive = primitive;
         this.depthStencil = desc.depthStencil || null;
         this.multisample = Object.assign({ count: 1, alphaToCoverageEnabled: false }, desc.multisample || {});
         const targets = (desc.fragment && desc.fragment.targets) || [];
         this.targets = targets;
         this.vertexBuffers = desc.vertex.buffers || [];

         const gl = device.gl;
         this.prog = compileGlProgram(gl, vs.glsl, fs ? fs.glsl : EMPTY_FS_NOCOLOR);
         this.vao = gl.createVertexArray();
         gl.bindVertexArray(this.vao);
         this.vertexBuffers.forEach((bufDesc, slot) => {
            const stride = bufDesc.arrayStride !== undefined ? bufDesc.arrayStride : bufDesc.stride;
            const step = bufDesc.stepMode || 'vertex';
            const attrs = bufDesc.attributes || bufDesc.attributeSet || [];
            for (const attr of attrs) {
               const loc = attr.shaderLocation !== undefined ? attr.shaderLocation : attr.shaderLocation;
               const format = VERTEX_FORMAT[attr.format];
               VALIDATE(format, 'Unknown vertex format ' + attr.format);
               gl.enableVertexAttribArray(loc);
               gl.vertexAttribDivisor(loc, step === 'instance' ? 1 : 0);
               attr._format = format;
               attr._stride = stride;
               attr._slot = slot;
            }
         });
         gl.bindVertexArray(null);

         this._assignUniformBindings(gl);
      }

      _assignUniformBindings(gl) {
         gl.useProgram(this.prog);
         const nBlocks = gl.getProgramParameter(this.prog, GL.ACTIVE_UNIFORM_BLOCKS);
         for (let i = 0; i < nBlocks; i++) {
            const name = gl.getActiveUniformBlockName(this.prog, i);
            const m = name && name.match(/webgpu_g(\d+)_b(\d+)/);
            if (!m) continue;
            const group = parseInt(m[1], 10);
            const binding = parseInt(m[2], 10);
            gl.uniformBlockBinding(this.prog, i, this.layout.bindingSlot(group, binding));
         }
         const nUni = gl.getProgramParameter(this.prog, GL.ACTIVE_UNIFORMS);
         for (let i = 0; i < nUni; i++) {
            const info = gl.getActiveUniform(this.prog, i);
            if (!info) continue;
            const loc = gl.getUniformLocation(this.prog, info.name);
            const m = info.name.match(/webgpu_g(\d+)_b(\d+)/);
            if (m && loc && SAMPLER_UNIFORM_TYPES[info.type]) {
               const group = parseInt(m[1], 10);
               const binding = parseInt(m[2], 10);
               gl.uniform1i(loc, this.layout.bindingSlot(group, binding));
            }
         }
         gl.useProgram(null);
      }

      getBindGroupLayout(index) {
         return this.layout.desc.bindGroupLayouts[index];
      }

      _setVertexBuffers(gl, slots, firstInstance, baseVertex) {
         firstInstance = firstInstance || 0;
         baseVertex = baseVertex || 0;
         gl.bindVertexArray(this.vao);
         this.vertexBuffers.forEach((bufDesc, slot) => {
            const set = slots[slot];
            if (!set) return;
            const step = bufDesc.stepMode || 'vertex';
            const attrs = bufDesc.attributes || bufDesc.attributeSet || [];
            for (const attr of attrs) {
               const format = attr._format;
               gl.bindBuffer(GL.ARRAY_BUFFER, set.buffer._ensureGl());
               const extra = step === 'instance'
                  ? firstInstance * (attr._stride || 0)
                  : baseVertex * (attr._stride || 0);
               const offset = (set.offset || 0) + (attr.offset || 0) + extra;
               if (format.float) {
                  gl.vertexAttribPointer(attr.shaderLocation, format.channels, format.type, format.norm, attr._stride, offset);
               } else {
                  gl.vertexAttribIPointer(attr.shaderLocation, format.channels, format.type, attr._stride, offset);
               }
            }
         });
      }

      _setup(gl, fb, colorAttachments, ds, flipY) {
         gl.useProgram(this.prog);
         gl.bindVertexArray(this.vao);
         const rast = this.primitive;
         let front = rast.frontFace === 'cw' ? GL.CW : GL.CCW;
         if (flipY) front = front === GL.CW ? GL.CCW : GL.CW;
         gl.frontFace(front);
         if (!rast.cullMode || rast.cullMode === 'none') gl.disable(GL.CULL_FACE);
         else {
            gl.enable(GL.CULL_FACE);
            gl.cullFace(rast.cullMode === 'back' ? GL.BACK : GL.FRONT);
         }

         const t0 = this.targets[0];
         if (t0 && t0.blend) {
            gl.enable(GL.BLEND);
            const c = Object.assign({ srcFactor: 'one', dstFactor: 'zero', operation: 'add' }, t0.blend.color || {});
            const a = Object.assign({ srcFactor: 'one', dstFactor: 'zero', operation: 'add' }, t0.blend.alpha || {});
            gl.blendEquationSeparate(BLEND_EQUATION[c.operation], BLEND_EQUATION[a.operation]);
            gl.blendFuncSeparate(BLEND_FUNC[c.srcFactor], BLEND_FUNC[c.dstFactor], BLEND_FUNC[a.srcFactor], BLEND_FUNC[a.dstFactor]);
         } else {
            gl.disable(GL.BLEND);
         }
         const mask = (t0 && t0.writeMask !== undefined) ? t0.writeMask : GPUColorWrite.ALL;
         gl.colorMask(!!(mask & 1), !!(mask & 2), !!(mask & 4), !!(mask & 8));

         const dsDesc = this.depthStencil;
         if (dsDesc) {
            const needDepth = dsDesc.depthWriteEnabled || dsDesc.depthCompare !== 'always';
            if (needDepth) {
               gl.enable(GL.DEPTH_TEST);
               gl.depthMask(!!dsDesc.depthWriteEnabled);
               // WebGL cannot keep bit-exact positions across two programs, so a
               // depth-prepass + compare-equal main pass rejects every fragment.
               // GEQUAL still honors reverse-Z occlusion with a 1-ULP tolerance.
               let cmp = dsDesc.depthCompare || 'always';
               if (cmp === 'equal' && !dsDesc.depthWriteEnabled) cmp = 'greater-equal';
               gl.depthFunc(COMPARE_FUNC[cmp]);
            } else {
               gl.disable(GL.DEPTH_TEST);
            }
            const front = dsDesc.stencilFront || {};
            const back = dsDesc.stencilBack || {};
            const stencilUsed = (front.compare && front.compare !== 'always') || (back.compare && back.compare !== 'always') ||
               (dsDesc.stencilWriteMask && dsDesc.stencilWriteMask !== 0);
            if (stencilUsed) {
               gl.enable(GL.STENCIL_TEST);
               gl.stencilOpSeparate(GL.FRONT, STENCIL_OP[front.failOp || 'keep'], STENCIL_OP[front.depthFailOp || 'keep'], STENCIL_OP[front.passOp || 'keep']);
               gl.stencilOpSeparate(GL.BACK, STENCIL_OP[back.failOp || 'keep'], STENCIL_OP[back.depthFailOp || 'keep'], STENCIL_OP[back.passOp || 'keep']);
               gl.stencilMask(dsDesc.stencilWriteMask !== undefined ? dsDesc.stencilWriteMask : 0xffffffff);
            } else {
               gl.disable(GL.STENCIL_TEST);
            }
         } else {
            gl.disable(GL.DEPTH_TEST);
            gl.disable(GL.STENCIL_TEST);
         }

         if (this.multisample.alphaToCoverageEnabled) gl.enable(GL.SAMPLE_ALPHA_TO_COVERAGE);
         else gl.disable(GL.SAMPLE_ALPHA_TO_COVERAGE);

         if (!this.targets.length) {
            gl.drawBuffers([GL.NONE]);
         } else {
            const drawBufs = [];
            for (let i = 0; i < this.targets.length; i++) {
               drawBufs.push(fb ? (GL.COLOR_ATTACHMENT0 + i) : GL.BACK);
            }
            gl.drawBuffers(drawBufs);
         }
      }
   }

   const FULLSCREEN_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;
   const FULLSCREEN_FS_EMPTY = `#version 300 es
precision highp float;
layout(location=0) out vec4 c;
void main() { c = vec4(0.0); }`;
   const EMPTY_FS_NOCOLOR = `#version 300 es
void main() {}`;

   class GPUComputePipeline {
      constructor(device, desc) {
         this.device = device;
         VALIDATE(desc.compute && desc.compute.module, 'GPUComputePipelineDescriptor.compute.module required.');
         const entry = desc.compute.entryPoint || 'main';
         const cs = desc.compute.module.compile('compute', entry);
         this._cs = cs;
         this.workgroupSize = cs.workgroupSize;
         let layout = desc.layout;
         if (!layout || layout === 'auto') {
            layout = autoLayoutFromBindings(device, [cs.bindings]);
         }
         this.layout = layout;
         this.desc = desc;
         const gl = device.gl;
         this.prog = compileGlProgram(gl, FULLSCREEN_VS, cs.glsl);
         this._quad = gl.createBuffer();
         gl.bindBuffer(GL.ARRAY_BUFFER, this._quad);
         gl.bufferData(GL.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), GL.STATIC_DRAW);
         this.vao = gl.createVertexArray();
         gl.bindVertexArray(this.vao);
         gl.enableVertexAttribArray(0);
         gl.vertexAttribPointer(0, 2, GL.FLOAT, false, 0, 0);
         gl.bindVertexArray(null);
         gl.useProgram(this.prog);
         const nBlocks = gl.getProgramParameter(this.prog, GL.ACTIVE_UNIFORM_BLOCKS);
         for (let i = 0; i < nBlocks; i++) {
            const name = gl.getActiveUniformBlockName(this.prog, i);
            const m = name && name.match(/webgpu_g(\d+)_b(\d+)/);
            if (!m) continue;
            const group = parseInt(m[1], 10);
            const binding = parseInt(m[2], 10);
            gl.uniformBlockBinding(this.prog, i, this.layout.bindingSlot(group, binding));
         }
         gl.useProgram(null);
      }

      getBindGroupLayout(index) {
         return this.layout.desc.bindGroupLayouts[index];
      }
   }

      function applyAniso(gl, sampler, amount) {
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (!ext || !sampler) return;
      const want = Math.max(1, amount || 1);
      if (want <= 1) return;
      const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 16;
      gl.samplerParameterf(sampler, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(want, max));
   }

      function isAutoMipColor(tex) {
      if (!tex || tex.desc.mipLevelCount <= 1 || !tex._gl) return false;
      if (tex._gl.target === GL.RENDERBUFFER) return false;
      const info = TEX_FORMAT_INFO[tex.desc.format];
      if (!info || info.depth || info.stencil || info.integer) return false;
      return true;
   }

      function skipGeneratedMipWrite(tex, mipLevel) {
      if ((mipLevel || 0) <= 0 || !tex) return false;
      const info = TEX_FORMAT_INFO[tex.desc.format];
      if (!info || info.depth || info.stencil || info.integer) return false;
      return tex.desc.mipLevelCount > 1;
   }

      function generateColorMips(tex) {
      if (!tex || tex._mipsReady || !isAutoMipColor(tex)) return;
      const gl = tex.device.gl;
      const prevFb = gl.getParameter(GL.FRAMEBUFFER_BINDING);
      const prevPbo = gl.getParameter(GL.PIXEL_UNPACK_BUFFER_BINDING);
      gl.bindFramebuffer(GL.FRAMEBUFFER, null);
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, null);
      gl.bindTexture(tex._gl.target, tex._gl);
      while (gl.getError()) {}
      gl.generateMipmap(tex._gl.target);
      if (!gl.getError()) tex._mipsReady = true;
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, prevPbo);
      gl.bindFramebuffer(GL.FRAMEBUFFER, prevFb);
   }

      function markTextureLevel0(tex) {
      tex._level0Written = true;
      queueMipRebuild(tex);
   }

      function queueMipRebuild(tex) {
      if (!tex || tex._mipQueued) return;
      tex._mipQueued = true;
      tex._mipsVerified = false;
      const d = tex.device;
      d._pendingMips = d._pendingMips || [];
      d._pendingMips.push(tex);
   }

      function rebuildPendingMips(device) {
      const list = device._pendingMips;
      if (!list || !list.length) return;
      device._pendingMips = [];
      for (let i = 0; i < list.length; i++) {
         const tex = list[i];
         tex._mipQueued = false;
         rebuildMipsFromGpu(tex);
         tex._mipsVerified = true;
      }
   }

      function rebuildMipsFromGpu(tex) {
      if (!isAutoMipColor(tex)) return;
      const gl = tex.device.gl;
      const fmt = tex.desc.format;
      if (fmt !== 'rgba8unorm' && fmt !== 'rgba8unorm-srgb' && fmt !== 'bgra8unorm' && fmt !== 'bgra8unorm-srgb') {
         generateColorMips(tex);
         return;
      }
      const w = tex.desc.size.width, h = tex.desc.size.height;
      const prevFb = gl.getParameter(GL.FRAMEBUFFER_BINDING);
      const prevPack = gl.getParameter(GL.PIXEL_PACK_BUFFER_BINDING);
      const prevUnpack = gl.getParameter(GL.PIXEL_UNPACK_BUFFER_BINDING);
      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, null);
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex._gl, 0);
      if (gl.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
         gl.bindFramebuffer(GL.FRAMEBUFFER, prevFb);
         gl.bindBuffer(GL.PIXEL_PACK_BUFFER, prevPack);
         gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, prevUnpack);
         gl.deleteFramebuffer(fb);
         return;
      }
      gl.drawBuffers([GL.COLOR_ATTACHMENT0]);
      gl.readBuffer(GL.COLOR_ATTACHMENT0);
      const pix = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, GL.RGBA, GL.UNSIGNED_BYTE, pix);
      gl.bindFramebuffer(GL.FRAMEBUFFER, prevFb);
      gl.deleteFramebuffer(fb);
      let any = false;
      for (let i = 0; i < pix.length; i += 4) if (pix[i] | pix[i + 1] | pix[i + 2]) { any = true; break; }
      if (any) cpuUploadMipChain(tex, packedRgba8(pix, w, h, w * 4, 0), w, h);
      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, prevPack);
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, prevUnpack);
   }

      function packedRgba8(u8, width, height, bytesPerRow, offset) {
      offset = offset || 0;
      const stride = bytesPerRow || (width * 4);
      const out = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
         out.set(u8.subarray(offset + y * stride, offset + y * stride + width * 4), y * width * 4);
      }
      let anyA = false;
      for (let i = 3; i < out.length; i += 4) if (out[i]) { anyA = true; break; }
      if (!anyA) for (let i = 3; i < out.length; i += 4) out[i] = 255;
      return out;
   }

      function cpuUploadMipChain(tex, rgba, width, height) {
      if (!isAutoMipColor(tex) || !rgba) return false;
      const gl = tex.device.gl;
      const info = TEX_FORMAT_INFO[tex.desc.format];
      const prevPbo = gl.getParameter(GL.PIXEL_UNPACK_BUFFER_BINDING);
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, null);
      gl.bindTexture(tex._gl.target, tex._gl);
      gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 0);
      let src = rgba, w = width, h = height;
      const maxLod = tex.desc.mipLevelCount;
      for (let lod = 1; lod < maxLod; lod++) {
         const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
         const dst = new Uint8Array(nw * nh * 4);
         for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
               const x0 = Math.min(x * 2, w - 1), x1 = Math.min(x * 2 + 1, w - 1);
               const y0 = Math.min(y * 2, h - 1), y1 = Math.min(y * 2 + 1, h - 1);
               let r = 0, g = 0, b = 0, a = 0, n = 0;
               const coords = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
               for (let c = 0; c < 4; c++) {
                  const i = (coords[c][1] * w + coords[c][0]) * 4;
                  r += src[i]; g += src[i + 1]; b += src[i + 2];
                  a += src[i + 3] || 255;
                  n++;
               }
               const o = (y * nw + x) * 4;
               dst[o] = r / n; dst[o + 1] = g / n; dst[o + 2] = b / n; dst[o + 3] = a / n;
            }
         }
         gl.texSubImage2D(tex._gl.target, lod, 0, 0, nw, nh, info.unpack, info.type, dst);
         src = dst; w = nw; h = nh;
      }
      gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, prevPbo);
      tex._level0Written = true;
      tex._mipsReady = true;
      tex._alphaMipsOk = true;
      tex._mipsGood = mipLodHasColor(tex, 1);
      return tex._mipsGood;
   }

      function mipLodHasColor(tex, lod) {
      if (!tex || !tex._gl || lod >= tex.desc.mipLevelCount) return false;
      const gl = tex.device.gl;
      const prevFb = gl.getParameter(GL.FRAMEBUFFER_BINDING);
      const prevPack = gl.getParameter(GL.PIXEL_PACK_BUFFER_BINDING);
      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, tex._gl.target, tex._gl, lod);
      if (gl.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
         gl.bindFramebuffer(GL.FRAMEBUFFER, prevFb);
         gl.bindBuffer(GL.PIXEL_PACK_BUFFER, prevPack);
         gl.deleteFramebuffer(fb);
         return false;
      }
      const p = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, p);
      gl.bindFramebuffer(GL.FRAMEBUFFER, prevFb);
      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, prevPack);
      gl.deleteFramebuffer(fb);
      return !!(p[0] | p[1] | p[2]);
   }

      function forceOpaqueAlphaIfEmpty(tex) {
      if (!tex || !tex._gl) return;
      const fmt = tex.desc.format;
      if (fmt !== 'rgba8unorm' && fmt !== 'rgba8unorm-srgb' && fmt !== 'bgra8unorm' && fmt !== 'bgra8unorm-srgb') return;
      if (tex._gl.target !== GL.TEXTURE_2D) return;
      const gl = tex.device.gl;
      const prev = gl.getParameter(GL.FRAMEBUFFER_BINDING);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex._gl, 0);
      if (gl.checkFramebufferStatus(GL.FRAMEBUFFER) !== GL.FRAMEBUFFER_COMPLETE) {
         gl.bindFramebuffer(GL.FRAMEBUFFER, prev);
         gl.deleteFramebuffer(fb);
         return;
      }
      gl.drawBuffers([GL.COLOR_ATTACHMENT0]);
      gl.readBuffer(GL.COLOR_ATTACHMENT0);
      const w = tex.desc.size.width, h = tex.desc.size.height;
      const pix = new Uint8Array(4);
      const pts = [[0, 0], [Math.max(0, w - 1), 0], [0, Math.max(0, h - 1)], [w >> 1, h >> 1], [w >> 2, h >> 2]];
      let saw = false;
      for (let i = 0; i < pts.length; i++) {
         gl.readPixels(pts[i][0], pts[i][1], 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, pix);
         if (pix[3]) { saw = true; break; }
      }
      if (!saw) {
         const scissor = gl.isEnabled(GL.SCISSOR_TEST);
         if (scissor) gl.disable(GL.SCISSOR_TEST);
         gl.colorMask(false, false, false, true);
         gl.clearBufferfv(GL.COLOR, 0, [0, 0, 0, 1]);
         gl.colorMask(true, true, true, true);
         if (scissor) gl.enable(GL.SCISSOR_TEST);
      }
      gl.bindFramebuffer(GL.FRAMEBUFFER, prev);
      gl.deleteFramebuffer(fb);
   }

      function rgba8AllAlphaZero(u8, offset, byteLength) {
      const end = Math.min(u8.length, (offset || 0) + byteLength);
      if (end - (offset || 0) < 4) return false;
      for (let i = (offset || 0) + 3; i < end; i += 4) if (u8[i]) return false;
      return true;
   }

      function fillRgba8Alpha(u8, offset, byteLength, alpha) {
      const end = Math.min(u8.length, (offset || 0) + byteLength);
      for (let i = (offset || 0) + 3; i < end; i += 4) u8[i] = alpha;
   }

      function withOpaqueAlphaIfMissing(src, info) {
      if (!info || info.bpp !== 4 || info.type !== GL.UNSIGNED_BYTE || !src) return src;
      const u8 = src instanceof Uint8Array ? src : new Uint8Array(src.buffer || src, src.byteOffset || 0, src.byteLength || src.length);
      if (!rgba8AllAlphaZero(u8, 0, u8.length)) return src;
      const out = new Uint8Array(u8);
      fillRgba8Alpha(out, 0, out.length, 255);
      return out;
   }

      function colorSamplerFor(device, samp, tex) {
      if (!samp) return null;
      // Same as v6: never use LINEAR_MIPMAP_*. App mip uploads leave
      // higher levels black, which desaturates anything not nearby.
      device._colorSamplers = device._colorSamplers || {};
      const key = (samp.desc.minFilter || 'nearest') + ':' + (samp.desc.magFilter || 'nearest') + ':' +
         (samp.desc.addressModeU || 'clamp-to-edge') + ':' + (samp.desc.addressModeV || 'clamp-to-edge');
      if (device._colorSamplers[key]) return device._colorSamplers[key];
      const gl = device.gl;
      const s = gl.createSampler();
      gl.samplerParameteri(s, GL.TEXTURE_MIN_FILTER, samp.desc.minFilter === 'linear' ? GL.LINEAR : GL.NEAREST);
      gl.samplerParameteri(s, GL.TEXTURE_MAG_FILTER, samp.desc.magFilter === 'linear' ? GL.LINEAR : GL.NEAREST);
      gl.samplerParameteri(s, GL.TEXTURE_WRAP_S, WRAP_MODE[samp.desc.addressModeU] || GL.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, GL.TEXTURE_WRAP_T, WRAP_MODE[samp.desc.addressModeV] || GL.CLAMP_TO_EDGE);
      applyAniso(gl, s, 16);
      device._colorSamplers[key] = s;
      return s;
   }

      function depthNearestSampler(device) {
      if (!device._depthNearestSampler) {
         const gl = device.gl;
         const s = gl.createSampler();
         gl.samplerParameteri(s, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
         gl.samplerParameteri(s, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
         gl.samplerParameteri(s, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
         gl.samplerParameteri(s, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
         gl.samplerParameteri(s, GL.TEXTURE_COMPARE_MODE, GL.NONE);
         device._depthNearestSampler = s;
      }
      return device._depthNearestSampler;
   }

      function textureIsCompareUse(pipeline, name) {
      if (!name) return false;
      const src = ((pipeline._fs && pipeline._fs.glsl) || '') + ((pipeline._vs && pipeline._vs.glsl) || '') + ((pipeline._cs && pipeline._cs.glsl) || '');
      return new RegExp('sampler2D(?:Array)?Shadow\\s+' + name + '\\b').test(src);
   }

      function storageNearestSampler(device) {
      if (!device._storageSampler) {
         const gl = device.gl;
         const s = gl.createSampler();
         gl.samplerParameteri(s, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
         gl.samplerParameteri(s, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
         gl.samplerParameteri(s, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
         gl.samplerParameteri(s, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
         device._storageSampler = s;
      }
      return device._storageSampler;
   }

      function applyBindGroup(gl, pipeline, index, bindGroup, dynamicOffsets) {
      if (!bindGroup) return;
      const dyn = (dynamicOffsets || []).slice();
      let filterSampler = null;
      let compareSampler = null;
      for (const e of bindGroup.desc.entries) {
         if (!e.sampler) continue;
         if (e.sampler.desc && e.sampler.desc.compare) compareSampler = e.sampler;
         else filterSampler = e.sampler;
      }
      for (const e of bindGroup.desc.entries) {
         const loc = pipeline.layout.bindingSlot(index, e.binding);
         if (e.sampler) {
            continue;
         } else if (e.textureView) {
            gl.activeTexture(GL.TEXTURE0 + loc);
            e.textureView._bindTexture();
            const isDepth = !!(e.textureView._depth || (e._layout && e._layout.texture && e._layout.texture.sampleType === 'depth'));
            const texName = findTextureUniformName(pipeline, index, e.binding);
            if (isDepth) {
               const compareUse = textureIsCompareUse(pipeline, texName);
               gl.bindSampler(loc, compareUse && compareSampler
                  ? compareSampler._gl
                  : depthNearestSampler(pipeline.device));
            } else {
               gl.bindSampler(loc, colorSamplerFor(pipeline.device, filterSampler, e.textureView.tex));
            }
            gl.uniform1i(gl.getUniformLocation(pipeline.prog, 'webgpu_g' + index + '_b' + e.binding), loc);
            if (texName) gl.uniform1i(gl.getUniformLocation(pipeline.prog, texName), loc);
         } else if (e.buffer) {
            const isStorage = e._layout && e._layout.kind === 'buffer' && e._layout.buffer.type !== 'uniform';
            if (isStorage) {
               const metas = [];
               [pipeline._vs, pipeline._fs, pipeline._cs].filter(Boolean).forEach(c => {
                  const hit = (c.storageMeta || []).find(s => s.group === index && s.binding === e.binding);
                  if (hit) metas.push(hit);
               });
               if (!metas.length) metas.push({ pack: 'float4', uname: 'webgpu_g' + index + '_b' + e.binding, path: 'tex' });
               for (const meta of metas) {
                  if (meta.path === 'ubo') {
                     const ubo = e.buffer.buffer._ensureStorageUbo(meta);
                     gl.bindBufferRange(GL.UNIFORM_BUFFER, loc, ubo.id, 0, ubo.size);
                  } else {
                     const pack = meta.pack || 'float4';
                     const tex = e.buffer.buffer._ensureStorageTex(pack);
                     gl.activeTexture(GL.TEXTURE0 + loc);
                     gl.bindTexture(GL.TEXTURE_2D, tex.id);
                     gl.bindSampler(loc, storageNearestSampler(pipeline.device));
                     const uname = meta.uname || ('webgpu_g' + index + '_b' + e.binding);
                     const uloc = gl.getUniformLocation(pipeline.prog, uname + '_in');
                     if (uloc) gl.uniform1i(uloc, loc);
                     const sl = gl.getUniformLocation(pipeline.prog, uname + '_size');
                     if (sl) gl.uniform2ui(sl, tex.w, tex.h);
                  }
               }
            } else {
               let offset = e.buffer.offset || 0;
               if (e._layout && e._layout.buffer && e._layout.buffer.hasDynamicOffset) {
                  VALIDATE(dyn.length, 'Missing dynamic offset.');
                  offset += dyn.shift();
               }
               const size = e.buffer.size || (e.buffer.buffer.desc.size - offset);
               e.buffer.buffer._ensureGl();
               gl.bindBufferRange(GL.UNIFORM_BUFFER, loc, e.buffer.buffer._gl, offset, size);
            }
         }
      }
   }

   function findTextureUniformName(pipeline, group, binding) {
      const compiled = pipeline._vs || pipeline._cs;
      const lists = [pipeline._vs, pipeline._fs, pipeline._cs].filter(Boolean);
      for (const c of lists) {
         const b = c.bindings.find(x => x.group === group && x.binding === binding);
         if (b && b.address !== 'uniform' && b.address !== 'storage') return b.name;
      }
      return null;
   }

   class GPUCommandBuffer {
      constructor(device, cmds) {
         this.device = device;
         this.cmds = cmds;
      }
   }

   class GPURenderPassEncoder {
      constructor(encoder, desc) {
         this.encoder = encoder;
         this.device = encoder.device;
         this._ended = false;
         this._pipeline = null;
         this._bindGroups = [];
         this._dyn = [];
         this._vbufs = [];
         this._index = null;
         this._stencilRef = 0;
         const colors = (desc.colorAttachments || []).filter(a => a && (a.view || a.attachment)).map(a => ({
            view: a.view || a.attachment,
            resolveTarget: a.resolveTarget || null,
            loadOp: a.loadOp,
            storeOp: a.storeOp || 'store',
            clearValue: asColor(a.clearValue || a.clearColor),
         }));
         this._colors = colors;
         this._ds = desc.depthStencilAttachment || null;
         VALIDATE(colors.length || this._ds, 'Render pass needs a color or depth attachment.');
         const sizeView = colors[0] ? colors[0].view : (this._ds.view || this._ds.attachment);
         VALIDATE(sizeView && sizeView.tex, 'Render pass attachment is missing a texture view.');
         this._size = {
            width: sizeView.tex.desc.size.width,
            height: sizeView.tex.desc.size.height,
         };
         this._fb = null;
         const direct = colors.length === 1 && colors[0].view.tex._swapchain && !colors[0].resolveTarget;
         this._direct = !!direct;
         this._flipY = !direct && !colors.some(c => c.view && c.view.tex && c.view.tex._swapchain);
         encoder._add(() => this._beginGL());
         this.setViewport(0, 0, this._size.width, this._size.height, 0, 1);
         this.setScissorRect(0, 0, this._size.width, this._size.height);
      }

      _beginGL() {
         const gl = this.device.gl;
         if (!this._direct) {
            this._fb = gl.createFramebuffer();
            gl.bindFramebuffer(GL.FRAMEBUFFER, this._fb);
            this._colors.forEach((c, i) => {
               if (c.view.tex._swapchain) c.view.tex._ensureGl();
               c.view._attach(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0 + i);
            });
            if (this._ds) {
               const v = this._ds.view || this._ds.attachment;
               if (v._depth && v._stencil) v._attach(GL.FRAMEBUFFER, GL.DEPTH_STENCIL_ATTACHMENT);
               else if (v._depth) v._attach(GL.FRAMEBUFFER, GL.DEPTH_ATTACHMENT);
               else if (v._stencil) v._attach(GL.FRAMEBUFFER, GL.STENCIL_ATTACHMENT);
            }
            // Depth-only FBOs are incomplete unless the default COLOR_ATTACHMENT0
            // draw/read buffers are disabled.
            if (!this._colors.length) {
               gl.drawBuffers([GL.NONE]);
               gl.readBuffer(GL.NONE);
            } else {
               const bufs = [];
               for (let i = 0; i < this._colors.length; i++) bufs.push(GL.COLOR_ATTACHMENT0 + i);
               gl.drawBuffers(bufs);
            }
            const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
            if (status !== GL.FRAMEBUFFER_COMPLETE) {
               console.warn('webgpu-js: framebuffer incomplete 0x' + status.toString(16) + '; falling back to the default backbuffer.');
               gl.deleteFramebuffer(this._fb);
               gl.bindFramebuffer(GL.FRAMEBUFFER, null);
               this._fb = null;
               this._direct = true;
               this._flipY = false;
            }
         } else {
            gl.bindFramebuffer(GL.FRAMEBUFFER, null);
         }
         this._colors.forEach((c, i) => {
            if (c.loadOp === 'clear') {
               const col = [c.clearValue.r, c.clearValue.g, c.clearValue.b, c.clearValue.a];
               if (this._direct) {
                  gl.colorMask(true, true, true, true);
                  gl.clearColor(col[0], col[1], col[2], col[3]);
                  gl.clear(GL.COLOR_BUFFER_BIT);
               } else {
                  gl.clearBufferfv(GL.COLOR, i, col);
               }
            }
         });
         if (this._ds) {
            const ds = this._ds;
            const clearDepth = ds.depthLoadOp === 'clear' || ds.depthLoadOp === undefined;
            const depthVal = ds.depthClearValue !== undefined ? ds.depthClearValue : (ds.clearDepth !== undefined ? ds.clearDepth : 1);
            if (clearDepth && ds.depthLoadOp !== 'load') {
               gl.depthMask(true);
               if (this._direct) {
                  gl.clearDepth(depthVal);
                  gl.clear(GL.DEPTH_BUFFER_BIT);
               } else {
                  gl.clearBufferfv(GL.DEPTH, 0, [depthVal]);
               }
            }
         }
         gl.viewport(0, 0, this._size.width, this._size.height);
         gl.enable(GL.SCISSOR_TEST);
         gl.scissor(0, 0, this._size.width, this._size.height);
      }

      setPipeline(p) { this._pipeline = p; }
      setBindGroup(i, bg, offsets) {
         this._bindGroups[i] = bg;
         this._dyn[i] = offsets || [];
      }
      setVertexBuffer(slot, buffer, offset, size) {
         this._vbufs[slot] = { buffer, offset: offset || 0, size };
      }
      setIndexBuffer(buffer, format, offset, size) {
         this._index = { buffer, format: format || 'uint16', offset: offset || 0, size };
      }
      setViewport(x, y, w, h, min, max) {
         this.encoder._add(() => {
            const gl = this.device.gl;
            gl.viewport(x, y, w, h);
            gl.depthRange(min, max);
         });
      }
      setScissorRect(x, y, w, h) {
         this.encoder._add(() => {
            const gl = this.device.gl;
            gl.enable(GL.SCISSOR_TEST);
            gl.scissor(x, y, w, h);
         });
      }
      setBlendConstant(color) {
         const c = asColor(color);
         this.encoder._add(() => this.device.gl.blendColor(c.r, c.g, c.b, c.a));
      }
      setStencilReference(ref) { this._stencilRef = ref; }

      _preDraw(firstInstance, baseVertex) {
         const pipe = this._pipeline;
         VALIDATE(pipe, 'setPipeline required before draw.');
         const gl = this.device.gl;
         const colors = this._colors;
         const ds = this._ds;
         const vbufs = this._vbufs.slice();
         const groups = this._bindGroups.slice();
         const dyn = this._dyn.map(d => (d || []).slice());
         const stencilRef = this._stencilRef;
         firstInstance = firstInstance || 0;
         baseVertex = baseVertex || 0;
         this.encoder._add(() => {
            const fb = this._fb;
            gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
            pipe._setup(gl, fb, colors, ds, this._flipY);
            pipe._setVertexBuffers(gl, vbufs, firstInstance, baseVertex);
            const fi = gl.getUniformLocation(pipe.prog, 'webgpu_first_instance');
            if (fi) gl.uniform1ui(fi, firstInstance);
            const fy = gl.getUniformLocation(pipe.prog, 'webgpu_flip_y');
            if (fy) gl.uniform1f(fy, this._flipY ? -1 : 1);
            groups.forEach((bg, i) => applyBindGroup(gl, pipe, i, bg, dyn[i]));
            if (pipe.depthStencil) {
               const dsDesc = pipe.depthStencil;
               const front = (dsDesc.stencilFront && dsDesc.stencilFront.compare) || 'always';
               const back = (dsDesc.stencilBack && dsDesc.stencilBack.compare) || 'always';
               const read = dsDesc.stencilReadMask !== undefined ? dsDesc.stencilReadMask : 0xffffffff;
               gl.stencilFuncSeparate(GL.FRONT, COMPARE_FUNC[front], stencilRef, read);
               gl.stencilFuncSeparate(GL.BACK, COMPARE_FUNC[back], stencilRef, read);
            }
         });
      }

      draw(vertexCount, instanceCount, firstVertex, firstInstance) {
         instanceCount = instanceCount === undefined ? 1 : instanceCount;
         firstVertex = firstVertex || 0;
         firstInstance = firstInstance || 0;
         this._preDraw(firstInstance, 0);
         const pipe = this._pipeline;
         this.encoder._add(() => {
            const gl = this.device.gl;
            gl.drawArraysInstanced(PRIM_TOPO[pipe.primitive.topology], firstVertex, vertexCount, instanceCount);
         });
      }

      drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance) {
         instanceCount = instanceCount === undefined ? 1 : instanceCount;
         firstIndex = firstIndex || 0;
         baseVertex = baseVertex || 0;
         firstInstance = firstInstance || 0;
         VALIDATE(this._index, 'setIndexBuffer required.');
         this._preDraw(firstInstance, baseVertex);
         const pipe = this._pipeline;
         const index = this._index;
         this.encoder._add(() => {
            const gl = this.device.gl;
            const fmt = INDEX_FORMAT[index.format];
            gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, index.buffer._ensureGl());
            const offset = index.offset + firstIndex * fmt.size;
            gl.drawElementsInstanced(PRIM_TOPO[pipe.primitive.topology], indexCount, fmt.type, offset, instanceCount);
         });
      }

      end() {
         if (this._ended) return;
         this._ended = true;
         this.encoder._add(() => {
            const gl = this.device.gl;
            this._colors.forEach((c, i) => {
               if (c.storeOp === 'store' && this._fb && c.view.tex._swapchain) {
                  gl.disable(GL.SCISSOR_TEST);
                  gl.bindFramebuffer(GL.READ_FRAMEBUFFER, this._fb);
                  gl.readBuffer(GL.COLOR_ATTACHMENT0 + i);
                  gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
                  const w = this._size.width, h = this._size.height;
                  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, GL.COLOR_BUFFER_BIT, GL.NEAREST);
               }
            });
            if (this._fb) gl.deleteFramebuffer(this._fb);
         });
         this.encoder._endPass();
      }
      endPass() { this.end(); }
   }

   class GPUComputePassEncoder {
      constructor(encoder, desc) {
         this.encoder = encoder;
         this.device = encoder.device;
         this._pipeline = null;
         this._bindGroups = [];
         this._dyn = [];
         this._ended = false;
      }
      setPipeline(p) { this._pipeline = p; }
      setBindGroup(i, bg, offsets) {
         this._bindGroups[i] = bg;
         this._dyn[i] = offsets || [];
      }
      dispatchWorkgroups(x, y, z) {
         x = x || 1; y = y || 1; z = z || 1;
         const pipe = this._pipeline;
         VALIDATE(pipe, 'setPipeline required before dispatch.');
         const groups = this._bindGroups.slice();
         const dyn = this._dyn.map(d => (d || []).slice());
         this.encoder._add(() => dispatchComputeGL(this.device, pipe, groups, dyn, x, y, z));
      }
      dispatchWorkgroupsIndirect(buffer, offset) {
         buffer._pullFromGl();
         const u32 = new Uint32Array(buffer._cpu, offset || 0, 3);
         this.dispatchWorkgroups(u32[0] || 1, u32[1] || 1, u32[2] || 1);
      }
      end() {
         if (this._ended) return;
         this._ended = true;
         this.encoder._endPass();
      }
      endPass() { this.end(); }
   }

   function storageTexelLayout(byteSize, bpp) {
      const count = Math.max(1, Math.ceil(byteSize / bpp));
      const w = Math.min(4096, count);
      const h = Math.ceil(count / w);
      return { w, h, count, bpp };
   }

   function dispatchComputeGL(device, pipe, groups, dyn, gx, gy, gz) {
      const gl = device.gl;
      const cs = pipe._cs;
      const sx = pipe.workgroupSize[0], sy = pipe.workgroupSize[1], sz = pipe.workgroupSize[2];
      const totalX = gx * sx;
      const totalY = gy * sy;
      const totalZ = gz * sz;

      // Find first writable storage buffer
      let storeBuf = null, storeEntry = null, storeMeta = cs.storageMeta && cs.storageMeta[0];
      groups.forEach((bg) => {
         if (!bg) return;
         for (const e of bg.desc.entries) {
            if (e.buffer && e._layout && e._layout.kind === 'buffer' && e._layout.buffer.type !== 'uniform') {
               if (!storeBuf) { storeBuf = e.buffer.buffer; storeEntry = e; }
            }
         }
      });

      const bpp = 4;
      const bytes = storeBuf ? storeBuf.desc.size : totalX * totalY * 4;
      const layout = storageTexelLayout(bytes, bpp);
      const texW = layout.w, texH = layout.h;

      const inTex = gl.createTexture();
      gl.bindTexture(GL.TEXTURE_2D, inTex);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);

      if (storeBuf) {
         storeBuf._ensureGl();
         storeBuf._pullFromGl();
         const u32 = new Uint32Array(storeBuf._cpu);
         const pixels = new Uint32Array(texW * texH);
         pixels.set(u32.subarray(0, Math.min(u32.length, pixels.length)));
         gl.texImage2D(GL.TEXTURE_2D, 0, GL.R32UI, texW, texH, 0, GL.RED_INTEGER, GL.UNSIGNED_INT, pixels);
      } else {
         gl.texImage2D(GL.TEXTURE_2D, 0, GL.R32UI, texW, texH, 0, GL.RED_INTEGER, GL.UNSIGNED_INT, null);
      }

      const outTex = gl.createTexture();
      gl.bindTexture(GL.TEXTURE_2D, outTex);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
      gl.texImage2D(GL.TEXTURE_2D, 0, GL.R32UI, texW, texH, 0, GL.RED_INTEGER, GL.UNSIGNED_INT, null);

      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, outTex, 0);
      gl.drawBuffers([GL.COLOR_ATTACHMENT0]);

      gl.useProgram(pipe.prog);
      gl.bindVertexArray(pipe.vao);
      gl.viewport(0, 0, texW, texH);
      gl.disable(GL.BLEND);
      gl.disable(GL.DEPTH_TEST);
      gl.disable(GL.CULL_FACE);
      gl.colorMask(true, true, true, true);

      const locSize = gl.getUniformLocation(pipe.prog, 'webgpu_storage_size');
      if (locSize) gl.uniform2ui(locSize, texW, texH);
      const locBase = gl.getUniformLocation(pipe.prog, 'webgpu_global_invocation_base');
      const locWG = gl.getUniformLocation(pipe.prog, 'webgpu_workgroup_size');
      const locNW = gl.getUniformLocation(pipe.prog, 'webgpu_num_workgroups');
      if (locWG) gl.uniform3ui(locWG, sx, sy, sz);
      if (locNW) gl.uniform3ui(locNW, gx, gy, gz);

      groups.forEach((bg, i) => applyBindGroup(gl, pipe, i, bg, dyn[i]));

      // Bind storage input texture(s)
      (cs.storageMeta || []).forEach((sm, si) => {
         const unit = 8 + si;
         gl.activeTexture(GL.TEXTURE0 + unit);
         gl.bindTexture(GL.TEXTURE_2D, inTex);
         const loc = gl.getUniformLocation(pipe.prog, sm.uname + '_in');
         if (loc) gl.uniform1i(loc, unit);
         const sl = gl.getUniformLocation(pipe.prog, sm.uname + '_size');
         if (sl) gl.uniform2ui(sl, texW, texH);
      });

      for (let z = 0; z < totalZ; z++) {
         if (locBase) gl.uniform3ui(locBase, 0, 0, z);
         gl.drawArrays(GL.TRIANGLES, 0, 3);
      }

      const out = new Uint32Array(texW * texH);
      gl.readPixels(0, 0, texW, texH, GL.RED_INTEGER, GL.UNSIGNED_INT, out);
      if (storeBuf) {
         const dst = new Uint32Array(storeBuf._cpu);
         const n = Math.min(dst.length, out.length);
         dst.set(out.subarray(0, n));
         storeBuf._flushToGl();
      }

      gl.deleteFramebuffer(fb);
      gl.deleteTexture(inTex);
      gl.deleteTexture(outTex);
      gl.bindFramebuffer(GL.FRAMEBUFFER, null);
   }

   class GPUCommandEncoder {
      constructor(device, desc) {
         this.device = device;
         this.label = (desc && desc.label) || '';
         this.cmds = [];
         this._inPass = false;
         this._finished = false;
      }
      _add(fn) { this.cmds.push(fn); }
      _endPass() { this._inPass = false; }

      beginRenderPass(desc) {
         VALIDATE(!this._inPass, 'Pass already active.');
         VALIDATE(!this._finished, 'Encoder finished.');
         this._inPass = true;
         return new GPURenderPassEncoder(this, desc);
      }
      beginComputePass(desc) {
         VALIDATE(!this._inPass, 'Pass already active.');
         VALIDATE(!this._finished, 'Encoder finished.');
         this._inPass = true;
         return new GPUComputePassEncoder(this, desc || {});
      }

      copyBufferToBuffer(src, srcOff, dst, dstOff, size) {
         this._add(() => {
            src._ensureGl(); dst._ensureGl();
            const gl = this.device.gl;
            gl.bindBuffer(GL.COPY_READ_BUFFER, src._gl);
            gl.bindBuffer(GL.COPY_WRITE_BUFFER, dst._gl);
            gl.copyBufferSubData(GL.COPY_READ_BUFFER, GL.COPY_WRITE_BUFFER, srcOff, dstOff, size);
            gl.bindBuffer(GL.COPY_READ_BUFFER, null);
            gl.bindBuffer(GL.COPY_WRITE_BUFFER, null);
            dst._cpuU8.set(src._cpuU8.subarray(srcOff, srcOff + size), dstOff);
            dst._cpuGen = (dst._cpuGen || 0) + 1;
         });
      }

      copyBufferToTexture(src, dst, size) {
         this._add(() => {
            const tex = dst.texture;
            if (skipGeneratedMipWrite(tex, dst.mipLevel)) return;
            const gl = this.device.gl;
            const buf = src.buffer;
            const origin = asOrigin3D(dst.origin);
            const ext = asExtent3D(size);
            const info = TEX_FORMAT_INFO[tex.desc.format];
            const offset = src.offset || 0;
            buf._ensureGl();
            tex._ensureGl();
            if (info.bpp === 4 && info.type === GL.UNSIGNED_BYTE) {
               const start = offset;
               const bytes = (src.bytesPerRow || (ext.width * 4)) * ext.height;
               if (rgba8AllAlphaZero(buf._cpuU8, start, bytes)) {
                  fillRgba8Alpha(buf._cpuU8, start, bytes, 255);
                  buf._flushToGl();
               }
            }
            gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, buf._gl);
            gl.bindTexture(tex._gl.target, tex._gl);
            if (tex._gl.target === GL.TEXTURE_2D) {
               gl.texSubImage2D(GL.TEXTURE_2D, dst.mipLevel || 0, origin.x, origin.y,
                  ext.width, ext.height, info.unpack, info.type, offset);
            } else {
               gl.texSubImage3D(tex._gl.target, dst.mipLevel || 0, origin.x, origin.y, origin.z || dst.aspect || 0,
                  ext.width, ext.height, ext.depthOrArrayLayers, info.unpack, info.type, offset);
            }
            if ((dst.mipLevel || 0) === 0) markTextureLevel0(tex);
            gl.bindTexture(tex._gl.target, null);
            gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, null);
         });
      }

      copyTextureToBuffer(src, dst, size) {
         this._add(() => {
            const gl = this.device.gl;
            const tex = src.texture;
            const ext = asExtent3D(size);
            const info = TEX_FORMAT_INFO[tex.desc.format];
            tex._ensureGl();
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(GL.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, tex._gl.target, tex._gl, src.mipLevel || 0);
            const bpp = info.bpp || 4;
            const row = dst.bytesPerRow || (ext.width * bpp);
            const tmp = new Uint8Array(row * ext.height);
            gl.readPixels(0, 0, ext.width, ext.height, info.unpack, info.type, tmp);
            const out = dst.buffer._cpuU8;
            const off = dst.offset || 0;
            out.set(tmp.subarray(0, Math.min(tmp.length, out.length - off)), off);
            dst.buffer._flushToGl();
            gl.deleteFramebuffer(fb);
         });
      }

      copyTextureToTexture(src, dst, size) {
         this._add(() => {
            if (skipGeneratedMipWrite(dst.texture, dst.mipLevel)) return;
            const gl = this.device.gl;
            const ext = asExtent3D(size);
            src.texture._ensureGl();
            dst.texture._ensureGl();
            const read = gl.createFramebuffer();
            const draw = gl.createFramebuffer();
            gl.bindFramebuffer(GL.READ_FRAMEBUFFER, read);
            gl.framebufferTexture2D(GL.READ_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, src.texture._gl.target, src.texture._gl, src.mipLevel || 0);
            gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, draw);
            gl.framebufferTexture2D(GL.DRAW_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, dst.texture._gl.target, dst.texture._gl, dst.mipLevel || 0);
            gl.blitFramebuffer(0, 0, ext.width, ext.height, 0, 0, ext.width, ext.height, GL.COLOR_BUFFER_BIT, GL.NEAREST);
            gl.deleteFramebuffer(read);
            gl.deleteFramebuffer(draw);
            if ((dst.mipLevel || 0) === 0) markTextureLevel0(dst.texture);
         });
      }

      finish(desc) {
         VALIDATE(!this._inPass, 'end() not called on pass.');
         VALIDATE(!this._finished, 'Already finished.');
         this._finished = true;
         return new GPUCommandBuffer(this.device, this.cmds);
      }
   }

   class GPUQueue {
      constructor(device) {
         this.device = device;
         this.label = '';
         this._pending = Promise.resolve();
      }
      submit(buffers) {
         try {
            VALIDATE(!this.device._lost, 'Device is lost.');
            for (const cb of buffers) {
               for (const fn of cb.cmds) fn();
            }
            rebuildPendingMips(this.device);
            this._kick();
         } catch (e) { this.device._catch(e); }
      }
      _kick() {
         const gl = this.device._gl;
         if (!gl) return;
         this._pending = this._pending.then(() => new Promise(resolve => {
            try {
               gl.finish();
            } catch (e) {}
            setTimeout(resolve, 0);
         }));
      }
      onSubmittedWorkDone() {
         const gl = this.device._gl;
         if (gl) {
            try { gl.finish(); } catch (e) {}
         }
         return this._pending;
      }
      writeBuffer(buffer, bufferOffset, data, dataOffset, size) {
         const src = data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
         const off = (dataOffset || 0) * (data.BYTES_PER_ELEMENT || 1);
         const count = size !== undefined ? size * (data.BYTES_PER_ELEMENT || 1) : (src.byteLength - off);
         buffer._cpuU8.set(src.subarray(off, off + count), bufferOffset || 0);
         if (this.device._gl) buffer._flushToGl();
      }
      writeTexture(dest, data, dataLayout, size) {
         const tex = dest.texture;
         if (skipGeneratedMipWrite(tex, dest.mipLevel)) return;
         const gl = this.device.gl;
         const origin = asOrigin3D(dest.origin);
         const ext = asExtent3D(size);
         const info = TEX_FORMAT_INFO[tex.desc.format];
         tex._ensureGl();
         const layout = dataLayout || {};
         const src = withOpaqueAlphaIfMissing(typedViewForTexel(info.type, data, layout.offset || 0), info);
         gl.bindTexture(tex._gl.target, tex._gl);
         gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
         gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
         if (layout.bytesPerRow) {
            gl.pixelStorei(GL.UNPACK_ROW_LENGTH, Math.floor(layout.bytesPerRow / info.bpp));
         }
         if (tex._gl.target === GL.TEXTURE_2D || tex._gl.target === GL.TEXTURE_CUBE_MAP) {
            const tgt = tex._gl.target === GL.TEXTURE_CUBE_MAP
               ? (GL.TEXTURE_CUBE_MAP_POSITIVE_X + (origin.z || 0))
               : tex._gl.target;
            gl.texSubImage2D(tgt, dest.mipLevel || 0, origin.x, origin.y,
               ext.width, ext.height, info.unpack, info.type, src);
         } else {
            gl.texSubImage3D(tex._gl.target, dest.mipLevel || 0, origin.x, origin.y, origin.z,
               ext.width, ext.height, ext.depthOrArrayLayers, info.unpack, info.type, src);
         }
         gl.pixelStorei(GL.UNPACK_ROW_LENGTH, 0);
         gl.pixelStorei(GL.UNPACK_ALIGNMENT, 4);
         if ((dest.mipLevel || 0) === 0) markTextureLevel0(tex);
         rebuildPendingMips(this.device);
         gl.bindTexture(tex._gl.target, null);
      }
      copyExternalImageToTexture(src, dest, size) {
         const tex = dest.texture;
         if (skipGeneratedMipWrite(tex, dest.mipLevel)) return;
         const gl = this.device.gl;
         tex._ensureGl();
         const source = src.source;
         gl.bindTexture(tex._gl.target, tex._gl);
         gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, src.flipY ? 1 : 0);
         gl.texSubImage2D(tex._gl.target, dest.mipLevel || 0, 0, 0, GL.RGBA, GL.UNSIGNED_BYTE, source);
         gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 0);
         if ((dest.mipLevel || 0) === 0) markTextureLevel0(tex);
         rebuildPendingMips(this.device);
         gl.bindTexture(tex._gl.target, null);
      }
   }

   class GPUDevice extends EventTarget {
      constructor(adapter, desc) {
         super();
         this._adapter = adapter;
         this.label = (desc && desc.label) || '';
         this._gl = null;
         this._lost = false;
         this._lostResolve = null;
         this.lost = new Promise(r => { this._lostResolve = r; });
         this.queue = new GPUQueue(this);
         this._errorScopes = [];
         this.features = new GPUSupportedFeatures(adapter.features && [...adapter.features] || []);
         this.limits = adapter.limits;
      }

      get adapter() { return this._adapter; }

      _ensureGl(canvas) {
         if (this._gl) return this._gl;
         const gl = this._adapter.makeGl(canvas);
         if (!gl) {
            this._lose('unknown', 'Failed to create WebGL2 context.');
            return null;
         }
         gl.getExtension('EXT_color_buffer_float');
         gl.getExtension('EXT_color_buffer_half_float');
         gl.getExtension('EXT_texture_filter_anisotropic');
         this._gl = gl;
         gl.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this._lose('unknown', 'WebGL context lost.');
         });
         return gl;
      }
      get gl() { return this._ensureGl(); }

      _lose(reason, message) {
         this._lost = true;
         this._lostResolve({ reason: reason || 'unknown', message: message || 'Device lost.' });
      }

      destroy() {
         if (this._gl) {
            const ext = this._gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
         }
         this._lose('destroyed', 'GPUDevice.destroy()');
      }

      _afterSubmitted() { return this.queue.onSubmittedWorkDone(); }

      _catch(error) {
         if (!IS_GPU_ERROR[error.name]) throw error;
         for (const scope of this._errorScopes) {
            if (error.name === scope.filter && !scope.error) {
               scope.error = error;
               return;
            }
         }
         const ev = new global.GPUUncapturedErrorEvent('uncapturederror', { error });
         if (this.dispatchEvent(ev)) console.error(error);
      }

      pushErrorScope(filter) {
         const map = { validation: 'GPUValidationError', 'out-of-memory': 'GPUOutOfMemoryError', internal: 'GPUInternalError' };
         this._errorScopes.unshift({ filter: map[filter] || filter, error: null });
      }
      popErrorScope() {
         return new Promise((yes, no) => {
            if (this._lost) return no(new global.GPUValidationError('Device lost.'));
            if (!this._errorScopes.length) return no(new global.GPUValidationError('Error scope stack is empty.'));
            yes(this._errorScopes.shift().error);
         });
      }

      createBuffer(desc) {
         try {
            VALIDATE(!this._lost, 'Device is lost.');
            return new GPUBuffer(this, desc);
         } catch (e) { this._catch(e); return new GPUBuffer(this, { size: 4, usage: GPUBufferUsage.COPY_DST }); }
      }
      createTexture(desc) {
         try {
            VALIDATE(!this._lost, 'Device is lost.');
            if (this._gl) return new GPUTexture(this, desc);
            this._ensureGl();
            return new GPUTexture(this, desc);
         } catch (e) { this._catch(e); throw e; }
      }
      createSampler(desc) {
         if (!this._gl) this._ensureGl();
         return new GPUSampler(this, desc || {});
      }
      createBindGroupLayout(desc) { return new GPUBindGroupLayout(this, desc); }
      createPipelineLayout(desc) { return new GPUPipelineLayout(this, desc); }
      createBindGroup(desc) { return new GPUBindGroup(this, desc); }
      createShaderModule(desc) { return new GPUShaderModule(this, desc); }
      createRenderPipeline(desc) {
         try {
            this._ensureGl();
            return new GPURenderPipeline(this, desc);
         } catch (e) { this._catch(e); throw e; }
      }
      createComputePipeline(desc) {
         try {
            this._ensureGl();
            return new GPUComputePipeline(this, desc);
         } catch (e) { this._catch(e); throw e; }
      }
      createRenderPipelineAsync(desc) { return Promise.resolve(this.createRenderPipeline(desc)); }
      createComputePipelineAsync(desc) { return Promise.resolve(this.createComputePipeline(desc)); }
      createCommandEncoder(desc) { return new GPUCommandEncoder(this, desc || {}); }
      getQueue() { return this.queue; }
   }

   class GPUAdapter {
      constructor(glInfo, desc, makeGl) {
         this._info = glInfo;
         this.desc = desc;
         this.makeGl = makeGl;
         this.features = new GPUSupportedFeatures([]);
         this.limits = {
            maxTextureDimension1D: 8192,
            maxTextureDimension2D: 8192,
            maxTextureDimension3D: 2048,
            maxTextureArrayLayers: 256,
            maxBindGroups: 4,
            maxBindGroupsPlusVertexBuffers: 24,
            maxBindingsPerBindGroup: 1000,
            maxDynamicUniformBuffersPerPipelineLayout: 8,
            maxDynamicStorageBuffersPerPipelineLayout: 4,
            maxSampledTexturesPerShaderStage: 16,
            maxSamplersPerShaderStage: 16,
            maxStorageBuffersPerShaderStage: 8,
            maxStorageTexturesPerShaderStage: 4,
            maxUniformBuffersPerShaderStage: 12,
            maxUniformBufferBindingSize: 65536,
            maxStorageBufferBindingSize: 128 * 1024 * 1024,
            minUniformBufferOffsetAlignment: 256,
            minStorageBufferOffsetAlignment: 256,
            maxVertexBuffers: 8,
            maxBufferSize: 256 * 1024 * 1024,
            maxVertexAttributes: 16,
            maxVertexBufferArrayStride: 2048,
            maxInterStageShaderVariables: 16,
            maxColorAttachments: 8,
            maxColorAttachmentBytesPerSample: 32,
            maxComputeWorkgroupStorageSize: 16384,
            maxComputeInvocationsPerWorkgroup: 256,
            maxComputeWorkgroupSizeX: 256,
            maxComputeWorkgroupSizeY: 256,
            maxComputeWorkgroupSizeZ: 64,
            maxComputeWorkgroupsPerDimension: 65535,
         };
         this.info = {
            vendor: 'webgpu-js',
            architecture: 'webgl2',
            device: glInfo.name,
            description: glInfo.name,
            subgroupMinSize: 1,
            subgroupMaxSize: 1,
            isFallbackAdapter: true,
         };
         this.isFallbackAdapter = true;
      }
      get name() { return this._info.name; }
      get extensions() { return this._info.extensions; }

      requestAdapterInfo() { return Promise.resolve(this.info); }

      requestDevice(desc) {
         desc = desc || {};
         return new Promise((yes, no) => {
            if (desc.requiredFeatures && desc.requiredFeatures.length) {
               for (const f of desc.requiredFeatures) {
                  if (!this.features.has(f)) return no(new TypeError('Unsupported required feature: ' + f));
               }
            }
            yes(new GPUDevice(this, desc));
         });
      }
   }

   function probeGlInfo(gl) {
      let pname = gl.RENDERER;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) pname = ext.UNMASKED_RENDERER_WEBGL;
      return {
         name: 'WebGPU.js on ' + gl.getParameter(pname),
         extensions: { anisotropicFiltering: !!(gl.getSupportedExtensions() || []).includes('EXT_texture_filter_anisotropic') },
         limits: { maxBindGroups: 4 },
      };
   }

   function makeGl(canvas, powerPreference) {
      let c = canvas;
      if (!c) {
         c = document.createElement('canvas');
         c.width = 1;
         c.height = 1;
      }
      return ORIG_GET_CONTEXT.call(c, 'webgl2', {
         antialias: false,
         alpha: true,
         depth: true,
         stencil: true,
         premultipliedAlpha: false,
         preserveDrawingBuffer: true,
         powerPreference: powerPreference || 'default',
      });
   }

   class GPU {
      requestAdapter(desc) {
         desc = Object.assign({ powerPreference: 'undefined' }, desc || {});
         return new Promise((yes, no) => {
            const gl = makeGl(null, desc.powerPreference === 'undefined' ? 'default' : desc.powerPreference);
            if (!gl) return yes(null);
            const info = probeGlInfo(gl);
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
            yes(new GPUAdapter(info, desc, (canvas) => makeGl(canvas, desc.powerPreference === 'undefined' ? 'default' : desc.powerPreference)));
         });
      }
      getPreferredCanvasFormat() { return 'rgba8unorm'; }
      get wgslLanguageFeatures() { return new GPUSupportedFeatures([]); }
   }

   class GPUCanvasContext {
      constructor(canvas) {
         this.canvas = canvas;
         this._config = null;
         this._current = null;
      }
      configure(desc) {
         VALIDATE(desc && desc.device instanceof GPUDevice, 'GPUCanvasConfiguration.device required.');
         this._config = Object.assign({
            format: 'rgba8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            alphaMode: 'opaque',
         }, desc);
         desc.device._ensureGl(this.canvas);
         if (desc.device._gl && desc.device._gl.canvas !== this.canvas) {
            console.warn('webgpu-js: device GL context is not this canvas; presentation uses a blit/slow path.');
         }
         this._current = null;
      }
      unconfigure() {
         this._config = null;
         this._current = null;
      }
      getCurrentTexture() {
         VALIDATE(this._config, 'GPUCanvasContext is not configured.');
         if (!this._current) {
            const canvas = this.canvas;
            const device = this._config.device;
            const same = device._gl && device._gl.canvas === canvas;
            this._current = new GPUTexture(device, {
               size: [canvas.width || canvas.clientWidth || 300, canvas.height || canvas.clientHeight || 150, 1],
               format: this._config.format,
               usage: this._config.usage | GPUTextureUsage.RENDER_ATTACHMENT,
            }, same ? this : null);
         }
         return this._current;
      }
      getPreferredFormat() { return 'rgba8unorm'; }

      // Early-proposal aliases used by nothing in the new examples.
      configureSwapChain(desc) {
         this.configure(desc);
         const ctx = this;
         return {
            getCurrentTexture() { return ctx.getCurrentTexture(); },
         };
      }
   }

   const gpu_js = new GPU();
   gpu_js.compileWgsl = compileWgsl;

   HTMLCanvasElement.prototype.getContext = function (type) {
      const want = (type === 'webgpu' || type === 'gpu');
      if (this._webgpu_js) {
         if (!want) return ORIG_GET_CONTEXT.apply(this, arguments);
         return this._webgpu_js;
      }
      if (want) {
         this._webgpu_js = new GPUCanvasContext(this);
         return this._webgpu_js;
      }
      return ORIG_GET_CONTEXT.apply(this, arguments);
   };

   function installNavigatorGpu() {
      const native = (typeof navigator !== 'undefined') ? navigator.gpu : undefined;
      const wrapper = {
         gpu_js,
         getPreferredCanvasFormat() {
            if (!forcePolyfill() && native && native.getPreferredCanvasFormat)
               return 'rgba8unorm';
            return gpu_js.getPreferredCanvasFormat();
         },
         get wgslLanguageFeatures() {
            return gpu_js.wgslLanguageFeatures;
         },
         async requestAdapter(options) {
            if (!forcePolyfill() && native && native.requestAdapter) {
               try {
                  const a = await native.requestAdapter(options);
                  if (a) return a;
               } catch (e) {}
            }
            return gpu_js.requestAdapter(options);
         },
      };
      try {
         Object.defineProperty(navigator, 'gpu', { configurable: true, enumerable: true, writable: true, value: wrapper });
      } catch (e) {
         try { navigator.gpu = wrapper; } catch (e2) {}
      }
      navigator.gpu_js = gpu_js;
   }

   installNavigatorGpu();
   global.webgpu_js = gpu_js;
})(typeof window !== 'undefined' ? window : globalThis);
