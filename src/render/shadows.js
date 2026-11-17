// render/shadows.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

// 首次修补时缓存的三原生 shadowmap_pars_fragment 源码：必须只备份一次，才能在补丁失效或需要降级时无损还原
var stockShadowChunk = null;

/**
 * 注入软阴影 chunk 时打上的 GLSL 注释标记，用于在着色器编译失败时识别「错误来自软阴影补丁」，从而回退到原生 PCF
 */
export var SALTLINE_SHADOW_MARKER = '// SALTLINE_SHADOW';

/**
 * 运行时替换 three 的 getShadow：注入 Vogel 盘 blocker search + 半影随遮挡距离增长的 PCSS（米制视锥常量换算 UV、接收面斜率偏置、贴图边缘淡出）；chunk 结构与预期不符则告警并保留原生 PCF
 */
export function installSoftShadows(
  frustum,
  { taps: filterTaps = 16, searchTaps: searchTapCount = 8 } = {},
) {
  let stockChunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  stockShadowChunk === null && (stockShadowChunk = stockChunk);
  let chunkSource = stockShadowChunk,
    getShadowStart = chunkSource.indexOf('float getShadow('),
    cubeToUVStart = chunkSource.indexOf('vec2 cubeToUV'),
    injectAt = chunkSource.lastIndexOf('// cubeToUV()', cubeToUVStart);
  if (
    (injectAt < getShadowStart && (injectAt = cubeToUVStart),
    getShadowStart < 0 || cubeToUVStart < 0 || cubeToUVStart < getShadowStart)
  )
    return (
      console.warn(
        '[render] soft shadows: unexpected Three shader chunk layout, keeping stock PCF',
      ),
      !1
    );
  let patchedChunk = `
	${SALTLINE_SHADOW_MARKER}
	const vec2 SL_FRUSTUM = vec2( ${frustum.width.toFixed(3)}, ${frustum.height.toFixed(3)} );   // metres across the shadow map
	const float SL_DEPTH = ${frustum.depth.toFixed(3)};                                       // metres across the depth range
	float slIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
	vec2 slVogel( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float th = float( i ) * 2.39996323 + phi;
		return r * vec2( cos( th ), sin( th ) );
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		shadowCoord.xyz /= shadowCoord.w;
		vec3 sc = shadowCoord.xyz;
		vec3 dx = dFdx( sc ), dy = dFdy( sc );
		bool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;
		if ( ! ( inFrustum && sc.z <= 1.0 ) ) return 1.0;
		// receiver plane depth bias: depth gradient of the receiver in shadow-map uv space
		float det = dx.x * dy.y - dx.y * dy.x;
		vec2 dz = vec2( 0.0 );
		if ( abs( det ) > 1e-12 ) dz = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
		vec2 texel = 1.0 / shadowMapSize;
		float maxSlope = 0.0030 / max( texel.x, texel.y );      // never bias more than ~0.6 m per kernel
		dz = clamp( dz, vec2( - maxSlope ), vec2( maxSlope ) );
		float zr = sc.z + shadowBias - ( abs( dz.x ) * texel.x + abs( dz.y ) * texel.y ) * 0.35;
		float phi = slIGN( gl_FragCoord.xy ) * 6.2831853;
		// --- blocker search ---
		vec2 searchR = ( 0.55 * shadowRadius ) / SL_FRUSTUM;     // metres -> uv
		float blk = 0.0, nb = 0.0;
		for ( int i = 0; i < ${searchTapCount}; i ++ ) {
			vec2 o = slVogel( i, ${searchTapCount}, phi ) * searchR;
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) );
			float z = zr + dot( o, dz );
			if ( d < z ) { blk += d; nb += 1.0; }
		}
		if ( nb < 0.5 ) return 1.0;
		float avg = blk / nb;
		// --- penumbra: grows with blocker distance (sun half-angle scaled up for look) ---
		float distM = max( zr - avg, 0.0 ) * SL_DEPTH;
		float penM = clamp( distM * 0.022 * shadowRadius, 0.012 * shadowRadius, 0.60 * shadowRadius );
		vec2 filtR = max( vec2( penM ) / SL_FRUSTUM, texel * 1.25 );
		float lit = 0.0;
		for ( int i = 0; i < ${filterTaps}; i ++ ) {
			vec2 o = slVogel( i, ${filterTaps}, phi + 1.7 ) * filtR;
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) );
			lit += step( zr + dot( o, dz ), d );
		}
		lit /= float( ${filterTaps} );
		// fade to lit at the very edge of the map so the frustum border never shows
		vec2 e = min( sc.xy, 1.0 - sc.xy );
		lit = mix( 1.0, lit, smoothstep( 0.0, 0.02, min( e.x, e.y ) ) );
		return mix( 1.0, lit, shadowIntensity );
	}

	`;
  return (
    (THREE.ShaderChunk.shadowmap_pars_fragment =
      chunkSource.slice(0, getShadowStart) + patchedChunk + chunkSource.slice(injectAt)),
    !0
  );
}

/**
 * 把缓存的原始 shadowmap chunk 写回 three，用于软阴影补丁失效或降级时恢复原生 PCF
 */
export function restoreStockShadowChunk() {
  stockShadowChunk !== null && (THREE.ShaderChunk.shadowmap_pars_fragment = stockShadowChunk);
}
