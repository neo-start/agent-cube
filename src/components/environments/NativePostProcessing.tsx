/**
 * Native Three.js post-processing for React Three Fiber.
 * Replaces @react-three/postprocessing which crashes on v3.0.4 / postprocessing 6.39.0.
 *
 * Uses Three.js examples modules directly:
 *   - EffectComposer + RenderPass (base pipeline)
 *   - UnrealBloomPass (soft glow)
 *   - ShaderPass + custom color grading (warm cinematic look)
 *   - FXAAPass (anti-aliasing)
 */

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import * as THREE from 'three';

// ── Color grading shader: warm tint + vignette + contrast ──
const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    warmth: { value: 0.08 },
    contrast: { value: 1.1 },
    saturation: { value: 1.15 },
    vignetteStrength: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float warmth;
    uniform float contrast;
    uniform float saturation;
    uniform float vignetteStrength;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 color = tex.rgb;

      // Warm tint — push reds up, blues down slightly
      color.r += warmth;
      color.b -= warmth * 0.5;

      // Contrast
      color = (color - 0.5) * contrast + 0.5;

      // Saturation
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(lum), color, saturation);

      // Vignette
      vec2 uv = vUv * 2.0 - 1.0;
      float vig = 1.0 - dot(uv, uv) * vignetteStrength;
      color *= vig;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), tex.a);
    }
  `,
};

interface NativePostProcessingProps {
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
}

export function NativePostProcessing({
  bloomStrength = 0.25,
  bloomRadius = 0.4,
  bloomThreshold = 0.82,
}: NativePostProcessingProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);

  useEffect(() => {
    const composer = new EffectComposer(gl);

    // 1. Render scene
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // 2. Bloom
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      bloomStrength,
      bloomRadius,
      bloomThreshold,
    );
    composer.addPass(bloomPass);

    // 3. Color grading
    const colorPass = new ShaderPass(ColorGradingShader);
    composer.addPass(colorPass);

    // 4. FXAA
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms['resolution'].value.set(1 / size.width, 1 / size.height);
    composer.addPass(fxaaPass);

    composerRef.current = composer;

    return () => {
      composer.dispose();
    };
  }, [gl, scene, camera, size, bloomStrength, bloomRadius, bloomThreshold]);

  // Update camera if it changes (e.g. orbit controls)
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const renderPass = composer.passes[0] as RenderPass;
    if (renderPass) renderPass.camera = camera;
  }, [camera]);

  // Resize handling
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.setSize(size.width, size.height);
    const fxaaPass = composer.passes[3] as ShaderPass;
    if (fxaaPass?.uniforms?.['resolution']) {
      fxaaPass.uniforms['resolution'].value.set(1 / size.width, 1 / size.height);
    }
  }, [size]);

  // Take over rendering
  useFrame(() => {
    composerRef.current?.render();
  }, 1); // priority 1 = runs after default scene updates

  return null;
}
